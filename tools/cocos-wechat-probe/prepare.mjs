import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareProbeProject } from '../cocos-probe/lib/prepareProject.mjs';

/** The profile, public runtime entry and BuildId role are fixed by the producer. */
export async function prepareWechatProbe({ rootDir, outputDir, appId } = {}) {
  return await prepareProbeProject({ rootDir, outputDir, appId, profileName: 'wechat' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const args = process.argv.slice(2);
  try {
    for (let i = 0; i < args.length; i += 2) {
      const key = { '--output': 'outputDir', '--app-id': 'appId' }[args[i]];
      if (!key || !args[i + 1] || Object.hasOwn(options, key)) {
        throw new Error('Usage: prepare-wechat --output ABS_EMPTY_DIRECTORY --app-id PROJECT_APP_ID');
      }
      options[key] = args[i + 1];
    }
    const result = await prepareWechatProbe(options);
    console.log(JSON.stringify({ outputDir: result.outputDir, candidateIdentity: result.manifest.candidateIdentity,
      sourceDirty: result.manifest.sourceDirty, schemaCount: result.manifest.schemaCount,
      engineVerification: result.manifest.engineVerification }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
