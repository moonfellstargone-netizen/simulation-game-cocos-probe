import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';

export function rebuildDesignSnapshot(rootDir, { check = false } = {}) {
  const root = resolve(rootDir);
  const outputPath = resolve(root, 'generated/stage_1A_runtime_snapshot.json');
  const previousText = readFileSync(outputPath, 'utf8');
  const previous = JSON.parse(previousText);
  const documents = {};
  for (const path of Object.keys(previous.loaded_documents)) {
    const sourcePath = resolve(root, path);
    if (path.includes('\\') || path.split('/').includes('..') || !sourcePath.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error(`Invalid declared path: ${path}`);
    const raw = readFileSync(sourcePath, 'utf8');
    documents[path] = path.endsWith('.json') ? JSON.parse(raw) : parse(raw);
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  const hash = createHash('sha256').update(JSON.stringify(canonical(documents))).digest('hex');
  const next = { ...previous, source_config_hash_sha256: hash, loaded_documents: documents };
  const text = JSON.stringify(next, null, 2) + '\n';
  if (check) {
    if (JSON.stringify(canonical(previous)) !== JSON.stringify(canonical(next))) throw new Error('ERR_DESIGN_SNAPSHOT_STALE');
    console.log('Design snapshot matches all declared source documents and content hash.');
  } else {
    writeFileSync(outputPath, text);
    console.log(`Regenerated ${Object.keys(documents).length} declared documents; sha256=${hash}`);
  }
  return { documentCount: Object.keys(documents).length, sha256: hash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check')) throw new Error('Only --check is supported');
  rebuildDesignSnapshot(fileURLToPath(new URL('../design_snapshot/', import.meta.url)), { check: args.includes('--check') });
}
