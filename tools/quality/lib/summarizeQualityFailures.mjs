export function summarizeQualityFailures(tasks) {
  return tasks
    .filter((task) => task.status === 'failed' || task.status === 'timed_out')
    .map((task) => {
      const tailText = task.stderrTail || task.stdoutTail || 'no captured output';
      const exit = task.status === 'timed_out' ? `timed out after ${task.timeoutSeconds ?? 'unknown'}s` : `exit ${task.exitCode ?? 'unknown'}`;
      return `- ${task.id}: ${exit}\n  ${tailText.split('\n').slice(-6).join('\n  ')}`;
    })
    .join('\n');
}

export function tail(text, maxLines = 80) {
  const trimmed = String(text ?? '').trimEnd();
  if (!trimmed) return '';
  const lines = trimmed.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}
