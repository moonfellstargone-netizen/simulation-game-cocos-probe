import { spawn } from 'node:child_process';
import { tail } from './summarizeQualityFailures.mjs';
import { runLegacyArchitectureValidator } from '../plugins/legacy-architecture-validator.mjs';

function normalizeCommand(command) {
  return command;
}

function resolveSpawnConfig(task) {
  const args = task.args ?? [];
  // Node on Windows rejects direct spawn of npm.cmd without a shell (EINVAL).
  if (process.platform === 'win32' && task.command === 'python3') {
    return { command: 'python', args, shell: true };
  }
  if (process.platform === 'win32' && task.command === 'npm') {
    return { command: 'npm', args, shell: true };
  }
  return { command: normalizeCommand(task.command), args, shell: false };
}

export async function runQualityTask(task, options = {}) {
  if (task.plugin === 'legacy-architecture-validator') {
    return runLegacyArchitectureValidator(task, options);
  }
  return runCommandTask(task, options);
}

export function runCommandTask(task, { cwd = process.cwd(), stdio = 'pipe' } = {}) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const started = Date.now();
    const timeoutSeconds = Number(task.timeoutSeconds ?? 0);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const { command, args, shell } = resolveSpawnConfig(task);
    const child = spawn(command, args, {
      cwd,
      shell,
      stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe']
    });

    function baseResult(status, exitCode, stdoutText = stdout, stderrText = stderr) {
      const finishedAt = new Date();
      return {
        id: task.id,
        group: task.group ?? task.type ?? 'ungrouped',
        command: formatCommand(task),
        status,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: Date.now() - started,
        timeoutSeconds: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : null,
        exitCode,
        blocker: task.stability === 'blocker',
        stdoutTail: tail(stdoutText),
        stderrTail: tail(stderrText)
      };
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    }

    if (stdio !== 'inherit') {
      child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    }

    const timer = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? setTimeout(() => {
          timedOut = true;
          const timeoutMessage = `task timed out after ${timeoutSeconds}s`;
          stderr = stderr ? `${stderr}\n${timeoutMessage}` : timeoutMessage;
          try {
            child.kill('SIGTERM');
          } catch {
            // Keep the timeout result even if process termination is platform-specific.
          }
          finish(baseResult('timed_out', null));
        }, timeoutSeconds * 1000)
      : null;

    child.on('error', (error) => {
      finish(baseResult('failed', null, stdout, `${stderr}\nfailed to start: ${error.message}`));
    });

    child.on('close', (code) => {
      if (timedOut) return;
      finish(baseResult(code === 0 ? 'passed' : 'failed', code));
    });
  });
}


export function createPendingTaskResult(task) {
  return {
    id: task.id,
    group: task.group ?? task.type ?? 'ungrouped',
    command: formatCommand(task),
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    durationMs: 0,
    timeoutSeconds: task.timeoutSeconds ?? null,
    exitCode: null,
    blocker: task.stability === 'blocker',
    stdoutTail: '',
    stderrTail: ''
  };
}

export function createSkippedTaskResult(task, reason = 'not run because a blocker task failed') {
  return {
    ...createPendingTaskResult(task),
    status: 'skipped',
    skippedReason: reason
  };
}

export function createRunningTaskResult(task) {
  return {
    ...createPendingTaskResult(task),
    status: 'running',
    startedAt: new Date().toISOString()
  };
}

export function formatCommand(task) {
  return [task.command, ...(task.args ?? [])].join(' ');
}
