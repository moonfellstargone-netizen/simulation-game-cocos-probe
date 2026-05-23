import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function countByStatus(tasks, status) {
  return tasks.filter((task) => task.status === status).length;
}

export function normalizeAffectedReport(report) {
  const tasks = report.tasks ?? [];
  const selectedTasks = report.selectedTasks ?? [];
  const taskSelectionReasons = report.taskSelectionReasons ?? {};
  const skippedTaskReasons = report.skippedTaskReasons ?? {};
  const riskClassification = report.riskClassification ?? {};
  const minimumRequiredTasks = report.minimumRequiredTasks ?? [];
  const missingMinimumTasks = minimumRequiredTasks.filter((id) => !selectedTasks.includes(id));
  return {
    releaseAuthority: false,
    cacheMode: report.cache?.mode ?? 'disabled',
    ...report,
    riskClassification,
    fallbackLevel: report.fallbackLevel ?? report.fallback?.level ?? 'none',
    fallbackReason: report.fallbackReason ?? report.fallback?.reason ?? 'none',
    minimumRequiredTasks,
    missingMinimumTasks: report.missingMinimumTasks ?? missingMinimumTasks,
    taskSelectionReasons,
    skippedTaskReasons,
    warnings: report.warnings ?? ['q:affected is for local development feedback only and must not replace q:full, q:release, release:build, or release:check.'],
    summary: {
      passed: countByStatus(tasks, 'passed'),
      failed: countByStatus(tasks, 'failed'),
      timed_out: countByStatus(tasks, 'timed_out'),
      skipped: countByStatus(tasks, 'skipped'),
      running: countByStatus(tasks, 'running'),
      pending: countByStatus(tasks, 'pending'),
      blockerFailures: tasks.filter((task) => task.blocker && (task.status === 'failed' || task.status === 'timed_out')).length
    }
  };
}

function renderList(values) {
  if (!values || values.length === 0) return '- none';
  return values.map((value) => `- ${value}`).join('\n');
}

function renderOwningModules(owningModules) {
  const entries = Object.entries(owningModules ?? {});
  if (entries.length === 0) return '- none';
  return entries.map(([file, modules]) => `- ${file}: ${(modules ?? []).join(', ') || 'none'}`).join('\n');
}

function renderMap(map) {
  const entries = Object.entries(map ?? {});
  if (entries.length === 0) return '- none';
  return entries.map(([key, value]) => {
    const rendered = Array.isArray(value) ? value.join('; ') : String(value ?? '');
    return `- ${key}: ${rendered || 'none'}`;
  }).join('\n');
}

function renderNestedMap(map) {
  const entries = Object.entries(map ?? {});
  if (entries.length === 0) return '- none';
  return entries.map(([key, values]) => `- ${key}: ${(values ?? []).join(', ') || 'none'}`).join('\n');
}

function renderMarkdown(report) {
  return [
    '# Affected Quality Report',
    '',
    `- version: ${report.version}`,
    `- gate: ${report.gate}`,
    `- status: ${report.status}`,
    `- source: ${report.changedFilesSource ?? ''}`,
    `- fallbackLevel: ${report.fallbackLevel ?? report.fallback?.level ?? 'none'}`,
    `- fallbackReason: ${report.fallbackReason ?? report.fallback?.reason ?? 'none'}`,
    `- releaseAuthority: no`,
    `- warning: q:affected is for local development feedback only and must not replace q:full, q:release, release:build, or release:check.`,
    '',
    '## Warnings',
    renderList(report.warnings),
    '',
    '## Changed Files',
    renderList(report.changedFiles),
    '',
    '## File Risk Classification',
    renderMap(report.riskClassification),
    '',
    '## Owning Modules',
    renderOwningModules(report.owningModules),
    '',
    '## Affected Modules',
    renderList(report.affectedModules),
    '',
    '## Reverse Dependency Expansion',
    renderList(report.affectedModules),
    '',
    '## Module To Task Map',
    renderNestedMap(report.moduleToTaskMap),
    '',
    '## Selected Tasks',
    renderList(report.selectedTasks),
    '',
    '## Task Selection Reasons',
    renderNestedMap(report.taskSelectionReasons),
    '',
    '## Skipped Tasks',
    renderList(report.skippedTasks),
    '',
    '## Skipped Task Reasons',
    renderMap(report.skippedTaskReasons),
    '',
    '## Minimum Required Tasks',
    renderList(report.minimumRequiredTasks),
    '',
    '## Missing Minimum Tasks',
    renderList(report.missingMinimumTasks),
    '',
    '## Fallback',
    `- used: ${report.fallback?.used ? 'yes' : 'no'}`,
    `- level: ${report.fallbackLevel ?? report.fallback?.level ?? 'none'}`,
    `- reason: ${report.fallbackReason ?? report.fallback?.reason ?? 'none'}`,
    '',
    '## Cache Probe',
    `- enabled: ${report.cache?.enabled ? 'yes' : 'no'}`,
    `- mode: ${report.cache?.mode ?? 'report-only'}`,
    `- hits: ${report.cache?.hits ?? 0}`,
    `- misses: ${report.cache?.misses ?? 0}`,
    `- disabledFor: ${(report.cache?.disabledFor ?? []).join(', ') || 'none'}`,
    '',
    '## Summary',
    `- passed: ${report.summary?.passed ?? 0}`,
    `- failed: ${report.summary?.failed ?? 0}`,
    `- timed_out: ${report.summary?.timed_out ?? 0}`,
    `- skipped: ${report.summary?.skipped ?? 0}`,
    `- blockerFailures: ${report.summary?.blockerFailures ?? 0}`
  ].join('\n') + '\n';
}

export async function writeAffectedReport(rootDir, reportDir, report) {
  const normalized = normalizeAffectedReport(report);
  const absDir = resolve(rootDir, reportDir);
  await mkdir(absDir, { recursive: true });
  const jsonPath = resolve(absDir, 'affected-latest.json');
  const mdPath = resolve(absDir, 'affected-latest.md');
  await writeFile(jsonPath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  await writeFile(mdPath, renderMarkdown(normalized), 'utf8');
  return { jsonPath, mdPath, report: normalized };
}
