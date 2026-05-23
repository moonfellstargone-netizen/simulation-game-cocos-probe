import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function readJsonFile(rootDir, relPath) {
  const abs = resolve(rootDir, relPath);
  const text = await readFile(abs, 'utf8');
  return JSON.parse(text);
}

export async function loadQualityConfig(rootDir = process.cwd()) {
  const config = await readJsonFile(rootDir, 'tools/quality/quality.config.json');
  const [moduleGraph, testRegistry, gatePolicy] = await Promise.all([
    readJsonFile(rootDir, config.moduleGraph),
    readJsonFile(rootDir, config.testRegistry),
    readJsonFile(rootDir, config.gatePolicy)
  ]);
  return { config, moduleGraph, testRegistry, gatePolicy };
}
