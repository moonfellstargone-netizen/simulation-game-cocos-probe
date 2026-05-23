// Compatibility shim: new quality plugins should import from tools/quality/plugin-runtime/*.
export { createFinding, addRequiredPhrase } from '../plugin-runtime/createFinding.mjs';
export { createPluginResult } from '../plugin-runtime/createPluginResult.mjs';
export { pluginCliMain, isMainModule } from '../plugin-runtime/pluginCliMain.mjs';
