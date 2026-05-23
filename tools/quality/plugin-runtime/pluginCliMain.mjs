import { fileURLToPath } from 'node:url';
import { createFinding } from './createFinding.mjs';
import { createPluginResult } from './createPluginResult.mjs';

export function isMainModule(importMetaUrl) {
  return process.argv[1] && fileURLToPath(importMetaUrl) === process.argv[1];
}

export async function pluginCliMain(importMetaUrl, runner, options = {}) {
  if (!isMainModule(importMetaUrl)) return;
  try {
    const result = await runner();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'passed' ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = createPluginResult(options.id ?? 'quality-plugin', [
      createFinding('error', 'PLUGIN_UNHANDLED_EXCEPTION', options.file ?? 'quality plugin', message)
    ]);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
}
