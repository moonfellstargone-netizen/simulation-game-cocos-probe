#!/usr/bin/env node
import { loadQualityConfig } from './lib/loadQualityConfig.mjs';
import { resolveGateTasks } from './lib/resolveGateTasks.mjs';
import { runQualityTask, createPendingTaskResult, createRunningTaskResult, createSkippedTaskResult } from './lib/runQualityTask.mjs';
import { writeQualityReport, normalizeReport } from './lib/writeQualityReport.mjs';
import { summarizeQualityFailures } from './lib/summarizeQualityFailures.mjs';
import { parseChangedFileArgs, resolveChangedFiles } from './affected/resolveChangedFiles.mjs';
import { resolveAffectedModules } from './affected/resolveAffectedModules.mjs';
import { resolveAffectedTasks } from './affected/resolveAffectedTasks.mjs';
import { getAffectedGatePolicy } from './affected/affectedPolicy.mjs';
import { writeAffectedReport } from './affected/writeAffectedReport.mjs';
import { isCacheAllowedForGate, probeTaskCache, storeTaskCacheResult } from './cache/qualityCache.mjs';

function parseArgs(argv) {
  const changed = parseChangedFileArgs(argv);
  const args = { gate: 'full', ...changed };
  const passThrough = changed.passThroughArgs ?? [];
  for (let i = 0; i < passThrough.length; i += 1) {
    if (passThrough[i] === '--gate') {
      args.gate = passThrough[i + 1];
      i += 1;
    } else if (passThrough[i] === '--help' || passThrough[i] === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${passThrough[i]}`);
    }
  }
  return args;
}

function printHelp() {
  console.log('Usage: node tools/quality/run-quality-gate.mjs --gate <tiny|fast|full|release|affected> [--changed-files a,b] [--changed-files-file file] [--base-ref REF] [--no-cache]');
}

function hasBlockerFailure(tasks) {
  return tasks.some((task) => task.blocker && (task.status === 'failed' || task.status === 'timed_out'));
}

function isFailureStatus(status) {
  return status === 'failed' || status === 'timed_out';
}

function groupLimitFor(task, policy, globalLimit) {
  const group = task.group ?? task.type ?? 'ungrouped';
  const configured = Number(policy.groupConcurrency?.[group] ?? globalLimit);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, globalLimit) : globalLimit;
}

function joinReasons(reasons) {
  return reasons.filter(Boolean).join('; ');
}

const startedAt = new Date();
const startedMs = Date.now();
let rootDir = process.cwd();
let reportDir = 'reports/quality';
let report;
let affectedReportState = null;
let flushing = Promise.resolve();

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const { config, moduleGraph, testRegistry, gatePolicy } = await loadQualityConfig(rootDir);
  reportDir = config.reportDir;
  if (!moduleGraph.modules || Object.keys(moduleGraph.modules).length === 0) {
    throw new Error('module graph is empty');
  }
  const gate = gatePolicy.gates[args.gate];
  if (!gate) throw new Error(`unknown quality gate: ${args.gate}`);

  let tasks;
  let affectedResolution = null;
  let cacheStats = { enabled: false, mode: 'disabled', hits: 0, misses: 0, disabledFor: [] };

  if (args.gate === 'affected') {
    getAffectedGatePolicy(gatePolicy);
    const changedResolution = await resolveChangedFiles(rootDir, args);
    const moduleResolution = changedResolution.fallback
      ? { owningModules: {}, affectedModules: [], unmatchedFiles: [], fallback: true, fallbackReason: changedResolution.fallbackReason }
      : resolveAffectedModules(changedResolution.changedFiles, moduleGraph);
    const taskResolution = resolveAffectedTasks({
      changedFiles: changedResolution.changedFiles,
      affectedModules: moduleResolution.affectedModules,
      fallback: changedResolution.fallback || moduleResolution.fallback,
      fallbackReason: joinReasons([changedResolution.fallbackReason, moduleResolution.fallbackReason]),
      changedFilesFallback: changedResolution.fallback,
      changedFilesFallbackReason: changedResolution.fallbackReason,
      moduleFallback: moduleResolution.fallback,
      moduleFallbackReason: moduleResolution.fallbackReason,
      gatePolicy,
      testRegistry
    });
    if (taskResolution.missingMinimumTasks?.length > 0) {
      throw new Error(`affected policy minimum tasks missing: ${taskResolution.missingMinimumTasks.join(', ')}`);
    }
    tasks = taskResolution.selectedTasks;
    const fallbackReason = joinReasons([changedResolution.fallbackReason, moduleResolution.fallbackReason, ...taskResolution.fallbackReasons]);
    affectedResolution = {
      changedResolution,
      moduleResolution,
      taskResolution,
      fallback: {
        used: taskResolution.fallbackLevel !== 'none' || Boolean(changedResolution.fallback || moduleResolution.fallback || taskResolution.fallbackReasons.length > 0),
        level: taskResolution.fallbackLevel,
        reason: fallbackReason || taskResolution.fallbackReason || 'none'
      }
    };
    cacheStats.enabled = isCacheAllowedForGate(args.gate, gate) && !args.noCache;
    cacheStats.mode = cacheStats.enabled ? 'report-only-probe' : 'disabled';
    if (!cacheStats.enabled) cacheStats.disabledFor.push(args.noCache ? 'cli --no-cache' : `${args.gate} gate`);
  } else {
    tasks = resolveGateTasks(args.gate, gatePolicy, testRegistry);
    cacheStats.enabled = isCacheAllowedForGate(args.gate, gate) && !args.noCache;
    cacheStats.mode = cacheStats.enabled ? 'report-only-probe' : 'disabled';
    if (!cacheStats.enabled) cacheStats.disabledFor.push(args.noCache ? 'cli --no-cache' : `${args.gate} gate`);
  }

  const taskState = new Map(tasks.map((task) => [task.id, createPendingTaskResult(task)]));
  const order = new Map(tasks.map((task, index) => [task.id, index]));
  const maxConcurrency = Number(gate.maxConcurrency ?? 4);

  function orderedResults() {
    return [...taskState.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  function buildAffectedReport(status = report.status) {
    if (!affectedResolution) return null;
    return {
      version: config.version,
      gate: 'affected',
      status,
      startedAt: startedAt.toISOString(),
      finishedAt: report.finishedAt,
      durationMs: Date.now() - startedMs,
      changedFilesSource: affectedResolution.changedResolution.source,
      changedFiles: affectedResolution.changedResolution.changedFiles,
      owningModules: affectedResolution.moduleResolution.owningModules,
      affectedModules: affectedResolution.moduleResolution.affectedModules,
      selectedTasks: affectedResolution.taskResolution.selectedTasks.map((task) => task.id),
      skippedTasks: affectedResolution.taskResolution.skippedTasks,
      riskClassification: affectedResolution.taskResolution.riskClassification,
      riskTypes: affectedResolution.taskResolution.riskTypes,
      fallbackLevel: affectedResolution.taskResolution.fallbackLevel,
      fallbackReason: affectedResolution.taskResolution.fallbackReason,
      minimumRequiredTasks: affectedResolution.taskResolution.minimumRequiredTasks,
      missingMinimumTasks: affectedResolution.taskResolution.missingMinimumTasks,
      taskSelectionReasons: affectedResolution.taskResolution.taskSelectionReasons,
      skippedTaskReasons: affectedResolution.taskResolution.skippedTaskReasons,
      moduleToTaskMap: affectedResolution.taskResolution.moduleToTaskMap,
      warnings: affectedResolution.taskResolution.warnings,
      fallback: affectedResolution.fallback,
      cache: cacheStats,
      tasks: orderedResults(),
      summary: {}
    };
  }

  report = {
    version: config.version,
    gate: args.gate,
    status: 'running',
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    durationMs: 0,
    interrupted: false,
    runnerError: null,
    policy: {
      allowCache: Boolean(gate.allowCache),
      blockOnFailure: gate.blockOnFailure ?? true,
      maxConcurrency,
      groupConcurrency: gatePolicy.groupConcurrency ?? {}
    },
    affected: affectedResolution ? {
      changedFiles: affectedResolution.changedResolution.changedFiles,
      changedFilesSource: affectedResolution.changedResolution.source,
      affectedModules: affectedResolution.moduleResolution.affectedModules,
      riskClassification: affectedResolution.taskResolution.riskClassification,
      fallbackLevel: affectedResolution.taskResolution.fallbackLevel,
      minimumRequiredTasks: affectedResolution.taskResolution.minimumRequiredTasks,
      missingMinimumTasks: affectedResolution.taskResolution.missingMinimumTasks,
      fallback: affectedResolution.fallback
    } : null,
    cache: cacheStats,
    tasks: orderedResults(),
    summary: {},
    slowTasks: [],
    failedTasks: [],
    timedOutTasks: []
  };

  async function flushReport(status = report.status) {
    report.status = status;
    report.durationMs = Date.now() - startedMs;
    report.tasks = orderedResults();
    report.cache = cacheStats;
    affectedReportState = buildAffectedReport(status);
    flushing = flushing.then(async () => {
      await writeQualityReport(rootDir, reportDir, report);
      if (affectedReportState) await writeAffectedReport(rootDir, reportDir, affectedReportState);
    });
    await flushing;
  }

  process.on('SIGINT', async () => {
    report.interrupted = true;
    report.finishedAt = new Date().toISOString();
    await flushReport('failed');
    process.exit(130);
  });
  process.on('SIGTERM', async () => {
    report.interrupted = true;
    report.finishedAt = new Date().toISOString();
    await flushReport('failed');
    process.exit(143);
  });

  console.log(`[quality] gate=${args.gate} version=${config.version} tasks=${tasks.length}`);
  if (affectedResolution) {
    console.log(`[quality] affected changedFiles=${affectedResolution.changedResolution.changedFiles.length} affectedModules=${affectedResolution.moduleResolution.affectedModules.join(',') || 'none'} fallback=${affectedResolution.fallback.used} fallbackLevel=${affectedResolution.taskResolution.fallbackLevel}`);
  }
  await flushReport('running');

  async function runOne(task) {
    taskState.set(task.id, createRunningTaskResult(task));
    await flushReport('running');
    if (cacheStats.enabled) {
      const probe = await probeTaskCache(rootDir, task, affectedResolution?.changedResolution.changedFiles ?? []);
      if (probe.hit) cacheStats.hits += 1;
      else cacheStats.misses += 1;
      console.log(`[quality] cache ${probe.hit ? 'hit' : 'miss'} ${task.id} key=${probe.key.slice(0, 12)} (report-only)`);
    }
    console.log(`[quality] start ${task.id}: ${task.command} ${(task.args ?? []).join(' ')}`.trim());
    const result = await runQualityTask(task, { cwd: rootDir });
    if (cacheStats.enabled) await storeTaskCacheResult(rootDir, task, affectedResolution?.changedResolution.changedFiles ?? [], result);
    taskState.set(task.id, result);
    console.log(`[quality] ${result.status} ${result.id} in ${result.durationMs}ms`);
    await flushReport('running');
    return result;
  }

  async function runConcurrent(queue, limit) {
    const completed = [];
    const runningByGroup = new Map();
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < queue.length) {
        let taskIndex = -1;
        for (let i = nextIndex; i < queue.length; i += 1) {
          const candidate = queue[i];
          const group = candidate.group ?? candidate.type ?? 'ungrouped';
          const groupRunning = runningByGroup.get(group) ?? 0;
          if (groupRunning < groupLimitFor(candidate, gatePolicy, limit)) {
            taskIndex = i;
            break;
          }
        }
        if (taskIndex === -1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }
        const [task] = queue.splice(taskIndex, 1);
        const group = task.group ?? task.type ?? 'ungrouped';
        runningByGroup.set(group, (runningByGroup.get(group) ?? 0) + 1);
        try {
          completed.push(await runOne(task));
        } finally {
          runningByGroup.set(group, Math.max(0, (runningByGroup.get(group) ?? 1) - 1));
        }
      }
    }

    const workers = Array.from({ length: Math.min(limit, queue.length) }, () => worker());
    await Promise.all(workers);
    return completed;
  }

  const regularTasks = tasks.filter((task) => task.type !== 'release' && task.group !== 'release');
  const releaseTasks = tasks.filter((task) => task.type === 'release' || task.group === 'release');
  const regularConcurrency = args.gate === 'release' ? Number(gatePolicy.gates.full?.maxConcurrency ?? maxConcurrency) : maxConcurrency;
  await runConcurrent([...regularTasks], Math.max(1, regularConcurrency));

  if (!hasBlockerFailure(orderedResults())) {
    for (const task of releaseTasks) {
      const result = await runOne(task);
      if (isFailureStatus(result.status) && (gate.blockOnFailure ?? true)) break;
    }
  } else {
    for (const task of releaseTasks) {
      taskState.set(task.id, createSkippedTaskResult(task, 'release task skipped because full gate blocker failed'));
      await flushReport('running');
    }
  }

  const finalTasks = orderedResults();
  const normalized = normalizeReport({ ...report, tasks: finalTasks });
  const failed = (gate.blockOnFailure ?? true)
    ? normalized.summary.blockerFailures > 0
    : normalized.summary.failed > 0 || normalized.summary.timed_out > 0;
  report.finishedAt = new Date().toISOString();
  await flushReport(failed ? 'failed' : 'passed');
  console.log(`[quality] wrote ${rootDir}/${reportDir}/latest.json`);
  console.log(`[quality] wrote ${rootDir}/${reportDir}/latest.md`);
  if (affectedResolution) {
    console.log(`[quality] wrote ${rootDir}/${reportDir}/affected-latest.json`);
    console.log(`[quality] wrote ${rootDir}/${reportDir}/affected-latest.md`);
  }

  if (failed) {
    console.error('[quality] failed tasks:');
    console.error(summarizeQualityFailures(orderedResults()));
    process.exit(1);
  }
  console.log('[quality] gate passed');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[quality] runner failed: ${message}`);
  if (report) {
    report.runnerError = message;
    report.finishedAt = new Date().toISOString();
    try {
      await writeQualityReport(rootDir, reportDir, { ...report, status: 'failed', durationMs: Date.now() - startedMs });
      if (affectedReportState) await writeAffectedReport(rootDir, reportDir, { ...affectedReportState, status: 'failed' });
    } catch {
      // Avoid hiding the original runner error.
    }
  }
  process.exit(1);
}
