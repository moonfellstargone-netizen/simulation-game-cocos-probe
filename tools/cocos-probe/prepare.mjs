import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareProbeProject, readPreparedProbeResources } from './lib/prepareProject.mjs';

export function readProbeResources(rootDir, inputs) {
  return readPreparedProbeResources(rootDir, inputs, 'web');
}

/** Web compatibility entry: fixed template, role and manifest format are retained. */
export async function prepareCocosProbe({ rootDir, outputDir } = {}) {
  return await prepareProbeProject({ rootDir, outputDir, profileName: 'web' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') {
    console.error('Usage: node tools/cocos-probe/prepare.mjs --output <absolute-empty-directory-outside-repository>');
    process.exitCode = 1;
  } else {
    try {
      const result = await prepareCocosProbe({ outputDir: args[1] });
      console.log(JSON.stringify({ outputDir: result.outputDir, sourceCommit: result.manifest.sourceCommit,
        sourceDirty: result.manifest.sourceDirty, schemaCount: result.manifest.schemaCount, engineVerification: result.manifest.engineVerification }));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
