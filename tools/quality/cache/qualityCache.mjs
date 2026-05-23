import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

export const QUALITY_CACHE_DIR = '.cache/quality';
const CORE_CONFIG_FILES = [
  'package-lock.json',
  'tools/quality/test-registry.json',
  'tools/quality/gate-policy.json',
  'tools/quality/module-graph.json',
  'tools/quality/rules/project-target.json',
  'tools/quality/rules/architecture-boundary.rules.json'
];

async function hashExistingFile(rootDir, relPath) {
  try {
    const data = await readFile(resolve(rootDir, relPath));
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return 'missing';
  }
}

export async function createQualityCacheKey(rootDir, task, changedFiles = []) {
  const coreHashes = {};
  for (const file of CORE_CONFIG_FILES) coreHashes[file] = await hashExistingFile(rootDir, file);
  const payload = {
    schema: 'quality-cache-probe-v1',
    taskId: task.id,
    command: task.command,
    args: task.args ?? [],
    timeoutSeconds: task.timeoutSeconds ?? null,
    changedFiles: [...changedFiles].sort(),
    coreHashes
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function isCacheAllowedForGate(gateName, gate) {
  if (gateName === 'release' || gateName === 'full') return false;
  return gate?.allowCache === true;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function probeTaskCache(rootDir, task, changedFiles = []) {
  const key = await createQualityCacheKey(rootDir, task, changedFiles);
  const path = resolve(rootDir, QUALITY_CACHE_DIR, `${key}.json`);
  return { key, path, hit: await exists(path) };
}

export async function storeTaskCacheResult(rootDir, task, changedFiles = [], result) {
  if (result.status !== 'passed') return null;
  const key = await createQualityCacheKey(rootDir, task, changedFiles);
  const dir = resolve(rootDir, QUALITY_CACHE_DIR);
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${key}.json`);
  const payload = {
    schema: 'quality-cache-probe-v1',
    taskId: task.id,
    status: result.status,
    storedAt: new Date().toISOString(),
    key
  };
  await writeFile(path, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { key, path };
}
