#!/usr/bin/env node
import { loadQualityRuleContext } from '../plugin-runtime/loadQualityRules.mjs';
import { createFinding } from '../plugin-runtime/createFinding.mjs';
import { createPluginResult } from '../plugin-runtime/createPluginResult.mjs';
import { readTextFile, pathExists } from '../plugin-runtime/readTextFile.mjs';
import { scanTextRules } from '../plugin-runtime/scanTextRules.mjs';
import { pluginCliMain } from '../plugin-runtime/pluginCliMain.mjs';

const PLUGIN_ID = 'context-doc-surface';
const root = process.cwd();

export function runContextDocSurfaceCheck() {
  const startedAt = Date.now();
  const findings = [];
  const { contextDocSurfaceRules } = loadQualityRuleContext(root, findings);
  const files = contextDocSurfaceRules.files ?? {};

  for (const [rel, rules] of Object.entries(files)) {
    if (!pathExists(root, rel)) {
      findings.push(createFinding('error', 'CONTEXT_DOC_MISSING', rel, 'required context document is missing'));
      continue;
    }
    const text = readTextFile(root, rel, findings);
    findings.push(...scanTextRules({ file: rel, text, rules }));
  }

  return createPluginResult(PLUGIN_ID, findings, startedAt);
}

pluginCliMain(import.meta.url, runContextDocSurfaceCheck, { id: PLUGIN_ID, file: 'tools/quality/plugins/context-doc-surface-check.mjs' });
