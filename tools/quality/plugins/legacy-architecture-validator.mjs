import { runCommandTask } from '../lib/runQualityTask.mjs';

export async function runLegacyArchitectureValidator(task, options = {}) {
  return runCommandTask({
    ...task,
    command: task.command || 'python3',
    args: task.args || ['tools/validate_code_architecture.py']
  }, options);
}
