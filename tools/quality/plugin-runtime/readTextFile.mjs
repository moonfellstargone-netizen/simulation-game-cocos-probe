import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFinding } from './createFinding.mjs';

export function resolveProjectPath(rootDir, relPath) {
  return resolve(rootDir, relPath);
}

export function pathExists(rootDir, relPath) {
  return existsSync(resolveProjectPath(rootDir, relPath));
}

export function readTextFile(rootDir, relPath, findings = [], options = {}) {
  const abs = resolveProjectPath(rootDir, relPath);
  if (!existsSync(abs)) {
    findings.push(createFinding('error', options.missingCode ?? 'TEXT_FILE_MISSING', relPath, options.missingMessage ?? 'required text file is missing'));
    return '';
  }
  try {
    return readFileSync(abs, 'utf8');
  } catch (error) {
    findings.push(createFinding('error', options.readCode ?? 'TEXT_READ_FAILED', relPath, `text read failed: ${error.message}`));
    return '';
  }
}
