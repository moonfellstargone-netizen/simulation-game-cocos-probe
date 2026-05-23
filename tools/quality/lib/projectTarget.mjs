import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULT_PROJECT_TARGET_REL = 'tools/quality/rules/project-target.json';

export function loadProjectTarget(rootDir = process.cwd(), relPath = DEFAULT_PROJECT_TARGET_REL) {
  const abs = resolve(rootDir, relPath);
  const raw = readFileSync(abs, 'utf8');
  return JSON.parse(raw);
}

export function projectTargetPath(rootDir = process.cwd(), relPath = DEFAULT_PROJECT_TARGET_REL) {
  return resolve(rootDir, relPath);
}
