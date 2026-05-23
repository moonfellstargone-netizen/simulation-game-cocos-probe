import { createFinding } from './createFinding.mjs';
import { readTextFile } from './readTextFile.mjs';

export function readJsonFile(rootDir, relPath, findings = [], options = {}) {
  const text = readTextFile(rootDir, relPath, findings, {
    missingCode: options.missingCode ?? 'JSON_FILE_MISSING',
    missingMessage: options.missingMessage ?? 'required JSON file is missing',
    readCode: options.readCode ?? 'JSON_READ_FAILED'
  });
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    findings.push(createFinding('error', options.parseCode ?? 'JSON_PARSE_FAILED', relPath, `JSON parse failed: ${error.message}`));
    return {};
  }
}
