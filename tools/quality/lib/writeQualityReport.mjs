import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizeQualityFailures } from './summarizeQualityFailures.mjs';

const STATUSES = ['pending', 'running', 'passed', 'failed', 'timed_out', 'skipped'];

export async function writeQualityReport(rootDir, reportDir, report) {
  const absDir = resolve(rootDir, reportDir);
  await mkdir(absDir, { recursive: true });
  const normalized = normalizeReport(report);
  const jsonPath = resolve(absDir, 'latest.json');
  const mdPath = resolve(absDir, 'latest.md');
  await writeFile(jsonPath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  await writeFile(mdPath, renderMarkdown(normalized), 'utf8');
  return { jsonPath, mdPath };
}

export function normalizeReport(report) {
  const tasks = report.tasks ?? [];
  const summary = Object.fromEntries(STATUSES.map((status) => [status, tasks.filter((task) => task.status === status).length]));
  summary.blockerFailures = tasks.filter((task) => task.blocker && (task.status === 'failed' || task.status === 'timed_out')).length;
  const completed = tasks.filter((task) => ['passed', 'failed', 'timed_out'].includes(task.status));
  const slowTasks = [...completed]
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, 5)
    .map(pickTaskSummary);
  const failedTasks = tasks.filter((task) => task.status === 'failed').map(pickTaskSummary);
  const timedOutTasks = tasks.filter((task) => task.status === 'timed_out').map(pickTaskSummary);
  return {
    ...report,
    summary,
    slowTasks,
    failedTasks,
    timedOutTasks
  };
}

function pickTaskSummary(task) {
  return {
    id: task.id,
    group: task.group ?? 'ungrouped',
    status: task.status,
    durationMs: task.durationMs ?? 0,
    timeoutSeconds: task.timeoutSeconds ?? null,
    exitCode: task.exitCode ?? null,
    blocker: Boolean(task.blocker),
    command: task.command
  };
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function renderTaskLocator(task) {
  return [
    `### ${task.id}`,
    '',
    `- group: ${task.group ?? 'ungrouped'}`,
    `- command: \`${task.command}\``,
    `- status: ${task.status}`,
    `- durationMs: ${task.durationMs ?? 0}`,
    `- timeoutSeconds: ${task.timeoutSeconds ?? ''}`,
    `- blocker: ${task.blocker ? 'yes' : 'no'}`,
    '',
    'stdoutTail:',
    '',
    '```text',
    task.stdoutTail || '',
    '```',
    '',
    'stderrTail:',
    '',
    '```text',
    task.stderrTail || '',
    '```'
  ].join('\n');
}

function renderMarkdown(report) {
  const failures = summarizeQualityFailures(report.tasks);
  const failedTasks = report.tasks.filter((task) => task.status === 'failed');
  const timedOutTasks = report.tasks.filter((task) => task.status === 'timed_out');
  const releaseBlockers = report.tasks.filter((task) => task.blocker && (task.status === 'failed' || task.status === 'timed_out'));
  const lines = [
    '# Quality Gate Report',
    '',
    '## Gate Summary',
    '',
    `- version: ${report.version}`,
    `- gate: ${report.gate}`,
    `- status: ${report.status}`,
    `- startedAt: ${report.startedAt ?? ''}`,
    `- finishedAt: ${report.finishedAt ?? ''}`,
    `- durationMs: ${report.durationMs ?? 0}`,
    `- pending: ${report.summary.pending}`,
    `- running: ${report.summary.running}`,
    `- passed: ${report.summary.passed}`,
    `- failed: ${report.summary.failed}`,
    `- timed_out: ${report.summary.timed_out}`,
    `- skipped: ${report.summary.skipped}`,
    `- blockerFailures: ${report.summary.blockerFailures}`,
    '',
    '## Task Table',
    '',
    '| id | group | status | durationMs | timeoutSeconds | exitCode | blocker | command |',
    '|---|---|---:|---:|---:|---:|---:|---|',
    ...report.tasks.map((task) => `| ${escapeCell(task.id)} | ${escapeCell(task.group ?? '')} | ${task.status} | ${task.durationMs ?? 0} | ${task.timeoutSeconds ?? ''} | ${task.exitCode ?? ''} | ${task.blocker ? 'yes' : 'no'} | \`${escapeCell(task.command)}\` |`),
    '',
    '## Failed Tasks',
    '',
    failedTasks.length > 0 ? failedTasks.map(renderTaskLocator).join('\n\n') : 'No failed task.',
    '',
    '## Timed Out Tasks',
    '',
    timedOutTasks.length > 0 ? timedOutTasks.map(renderTaskLocator).join('\n\n') : 'No timed out task.',
    '',
    '## Top Slow Tasks',
    '',
    report.slowTasks.length > 0
      ? report.slowTasks.map((task, index) => `${index + 1}. ${task.id} (${task.group}) ${task.durationMs}ms, timeout=${task.timeoutSeconds ?? ''}s`).join('\n')
      : 'No completed task yet.',
    '',
    '## Release Blocker Summary',
    '',
    releaseBlockers.length > 0 ? releaseBlockers.map((task) => `- ${task.id}: ${task.status}`).join('\n') : 'No release blocker failure.',
    '',
    '## Failure locator',
    '',
    failures || 'No failed or timed out task.',
    '',
    '## Follow-up Guidance',
    '',
    report.summary.blockerFailures > 0
      ? 'Start from the failed or timed_out blocker task id above. Do not lower gate strength, remove blocker tasks, or bypass release checks to make this report pass.'
      : 'All selected blocker tasks passed so far. Release zip still needs explicit release gate/check verification when shipping.'
  ];
  return lines.join('\n') + '\n';
}
