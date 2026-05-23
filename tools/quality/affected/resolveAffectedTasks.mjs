import { resolveGateTasks } from '../lib/resolveGateTasks.mjs';
import {
  BASELINE_TASK_IDS,
  classifyRiskForChangedFiles,
  minimumRequiredTasksForRisks,
  resolveFallbackLevel,
  taskMatchesRisk
} from './affectedPolicy.mjs';

function hasOverlap(left, right) {
  const rightSet = new Set(right ?? []);
  return (left ?? []).some((value) => rightSet.has(value));
}

function uniqueTaskList(tasks) {
  const seen = new Set();
  const ordered = [];
  for (const task of tasks) {
    if (!task || seen.has(task.id)) continue;
    seen.add(task.id);
    ordered.push(task);
  }
  return ordered;
}

function taskFromRegistry(id, registry) {
  const task = registry.tests?.[id];
  if (!task) throw new Error(`affected policy references unknown task: ${id}`);
  return { id, ...task };
}

function addReason(map, taskId, reason) {
  if (!map[taskId]) map[taskId] = [];
  if (reason && !map[taskId].includes(reason)) map[taskId].push(reason);
}

function taskIsReleaseOrReserved(task) {
  const tags = task.tags ?? [];
  return task.type === 'release'
    || task.group === 'release'
    || tags.includes('release')
    || tags.includes('nightly')
    || tags.includes('experimental')
    || tags.includes('quarantine');
}

function summarizeRisks(riskTypes) {
  return (riskTypes ?? []).join(', ') || 'none';
}

function reasonForSkippedTask(task, context) {
  const tags = task.tags ?? [];
  if (taskIsReleaseOrReserved(task)) return 'skipped because q:affected is not release authority and excludes release/nightly/experimental/quarantine tasks';
  if (context.minimumRequiredTasks.includes(task.id)) return 'missing from selected tasks even though it is minimum required';
  if (taskMatchesRisk(task, context.riskTypes)) return 'risk-related task was not selected because module ownership and fallback minimums did not require it';
  return `skipped because it does not cover affected modules [${(context.affectedModules ?? []).join(', ') || 'none'}] or active risk types [${summarizeRisks(context.riskTypes)}]`;
}

function mapModulesToTasks(tasks, affectedModules) {
  const result = {};
  for (const moduleId of affectedModules ?? []) result[moduleId] = [];
  for (const task of tasks) {
    for (const moduleId of affectedModules ?? []) {
      if ((task.covers ?? []).includes(moduleId) || (task.tags ?? []).includes(moduleId)) result[moduleId].push(task.id);
    }
  }
  return Object.fromEntries(Object.entries(result).map(([moduleId, ids]) => [moduleId, [...new Set(ids)]]));
}

export function resolveAffectedTasks({
  changedFiles,
  affectedModules,
  fallback,
  fallbackReason = '',
  changedFilesFallback = false,
  changedFilesFallbackReason = '',
  moduleFallback = fallback,
  moduleFallbackReason = fallbackReason,
  gatePolicy,
  testRegistry
}) {
  const risk = classifyRiskForChangedFiles(changedFiles);
  const selected = [];
  const taskSelectionReasons = {};
  const addTask = (id, reason) => {
    selected.push(taskFromRegistry(id, testRegistry));
    addReason(taskSelectionReasons, id, reason);
  };
  const addTasks = (tasks, reasonForTask) => {
    for (const task of tasks) {
      selected.push(task);
      addReason(taskSelectionReasons, task.id, typeof reasonForTask === 'function' ? reasonForTask(task) : reasonForTask);
    }
  };

  for (const id of BASELINE_TASK_IDS) addTask(id, 'baseline task required for every q:affected run');

  const fallbackInfo = resolveFallbackLevel(risk.riskTypes, {
    changedFilesFallback,
    changedFilesFallbackReason,
    moduleFallback,
    moduleFallbackReason
  });
  const minimumRequiredTasks = minimumRequiredTasksForRisks(risk.riskTypes);
  for (const id of minimumRequiredTasks) addTask(id, `minimum required task for risk types: ${summarizeRisks(risk.riskTypes)}`);

  if (fallbackInfo.fallbackLevel === 'full-recommended') {
    addTasks(resolveGateTasks('full', gatePolicy, testRegistry), (task) => `full-recommended fallback selected for risk types: ${summarizeRisks(risk.riskTypes)}; task ${task.id} is part of full gate`);
  } else if (fallbackInfo.fallbackLevel === 'release-surface') {
    for (const id of ['quality.releaseSurface', 'test.package-hygiene', 'quality.versionConsistency']) {
      if (testRegistry.tests?.[id]) addTask(id, `release-surface fallback selected for risk types: ${summarizeRisks(risk.riskTypes)}`);
    }
    addTasks(resolveGateTasks(gatePolicy.gates?.affected?.fallbackGate ?? 'fast', gatePolicy, testRegistry), (task) => `fast feedback retained under release-surface fallback; release build/check remain q:release only`);
  } else if (fallbackInfo.fallbackLevel === 'conservative') {
    addTasks(resolveGateTasks(gatePolicy.gates?.affected?.fallbackGate ?? 'fast', gatePolicy, testRegistry), (task) => `conservative fallback selected for risk types: ${summarizeRisks(risk.riskTypes)}; task ${task.id} is part of affected fallback gate`);
  } else if (fallbackInfo.fallbackLevel === 'fast') {
    addTasks(resolveGateTasks(gatePolicy.gates?.affected?.fallbackGate ?? 'fast', gatePolicy, testRegistry), (task) => `fast fallback selected for risk types: ${summarizeRisks(risk.riskTypes)}`);
  }

  for (const [id, task] of Object.entries(testRegistry.tests ?? {})) {
    if (taskIsReleaseOrReserved(task)) continue;
    const covers = task.covers ?? [];
    const tags = task.tags ?? [];
    if (hasOverlap(covers, affectedModules) || hasOverlap(tags, affectedModules)) {
      selected.push({ id, ...task });
      addReason(taskSelectionReasons, id, `task covers affected modules: ${covers.filter((cover) => (affectedModules ?? []).includes(cover)).join(', ') || tags.filter((tag) => (affectedModules ?? []).includes(tag)).join(', ')}`);
    } else if (taskMatchesRisk(task, risk.riskTypes)) {
      selected.push({ id, ...task });
      addReason(taskSelectionReasons, id, `task matches file risk types: ${summarizeRisks(risk.riskTypes)}`);
    }
  }

  const selectedTasks = uniqueTaskList(selected);
  const selectedIds = new Set(selectedTasks.map((task) => task.id));
  const normalizedReasons = {};
  for (const task of selectedTasks) normalizedReasons[task.id] = taskSelectionReasons[task.id] ?? ['selected by affected policy'];
  const missingMinimumTasks = minimumRequiredTasks.filter((id) => !selectedIds.has(id));
  const skippedTasks = Object.keys(testRegistry.tests ?? {}).filter((id) => !selectedIds.has(id)).sort();
  const skippedTaskReasons = Object.fromEntries(skippedTasks.map((id) => [id, reasonForSkippedTask(testRegistry.tests[id], {
    affectedModules,
    riskTypes: risk.riskTypes,
    minimumRequiredTasks
  })]));

  return {
    selectedTasks,
    skippedTasks,
    skippedTaskReasons,
    taskSelectionReasons: normalizedReasons,
    moduleToTaskMap: mapModulesToTasks(selectedTasks, affectedModules),
    minimumRequiredTasks,
    missingMinimumTasks,
    fallbackReasons: fallbackInfo.fallbackReason === 'none' ? [] : [fallbackInfo.fallbackReason],
    fallbackLevel: fallbackInfo.fallbackLevel,
    fallbackReason: fallbackInfo.fallbackReason,
    risk: risk.highestRisk,
    riskTypes: risk.riskTypes,
    riskClassification: risk.riskClassification,
    warnings: [
      'q:affected is for local development feedback only and must not replace q:full, q:release, release:build, or release:check.',
      fallbackInfo.fallbackLevel === 'full-recommended' ? 'q:full is recommended because the changed files touched config/global high-risk surfaces.' : '',
      fallbackInfo.fallbackLevel === 'release-surface' ? 'q:release is still required before delivery; q:affected does not run release.build/release.check.' : ''
    ].filter(Boolean)
  };
}
