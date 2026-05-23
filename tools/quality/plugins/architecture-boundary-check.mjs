#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative } from 'node:path';
import { createFinding } from '../plugin-runtime/createFinding.mjs';
import { createPluginResult } from '../plugin-runtime/createPluginResult.mjs';
import { readJsonFile } from '../plugin-runtime/readJsonFile.mjs';
import { readTextFile, pathExists } from '../plugin-runtime/readTextFile.mjs';
import { pluginCliMain } from '../plugin-runtime/pluginCliMain.mjs';

const PLUGIN_ID = 'architecture-boundary';
const DEFAULT_RULES_PATH = 'tools/quality/rules/architecture-boundary.rules.json';
const DEFAULT_MODULE_GRAPH_PATH = 'tools/quality/module-graph.json';
const DEFAULT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'reports']);
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const VALID_MODES = new Set(['authoritative', 'shadow', 'shadow_aligned']);
const VALID_SEVERITIES = new Set(['error', 'shadow_error']);

function toPosixPath(value) {
  return value.replaceAll('\\\\', '/').replaceAll('\\', '/');
}

function normalizeRel(value) {
  return toPosixPath(normalize(value));
}

function rootPrefix(pattern) {
  if (pattern.endsWith('/**')) return pattern.slice(0, -3);
  if (pattern.endsWith('**')) return pattern.slice(0, -2);
  if (pattern.endsWith('/')) return pattern.slice(0, -1);
  return pattern;
}

function matchesRoot(rel, pattern) {
  const normalizedRel = normalizeRel(rel);
  if (pattern.endsWith('/**') || pattern.endsWith('**') || pattern.endsWith('/')) {
    const prefix = rootPrefix(pattern);
    return normalizedRel === prefix || normalizedRel.startsWith(`${prefix}/`);
  }
  return normalizedRel === pattern;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern) {
  const normalized = normalizeRel(pattern);
  let out = '^';
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    const next = normalized[i + 1];
    if (ch === '*' && next === '*') {
      if (normalized[i + 2] === '/') {
        out += '(?:.*\/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
      continue;
    }
    if (ch === '*') {
      out += '[^/]*';
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    out += escapeRegExp(ch);
  }
  out += '$';
  return new RegExp(out, 'iu');
}

function matchesAnyPattern(rel, patterns = []) {
  if (!patterns.length) return false;
  const normalizedRel = normalizeRel(rel);
  const baseName = normalizedRel.split('/').at(-1) ?? normalizedRel;
  return patterns.some((pattern) => {
    const re = globToRegExp(pattern);
    return re.test(normalizedRel) || re.test(baseName);
  });
}

function fileIncludedByRule(rel, rule) {
  if (Array.isArray(rule.includeFiles) && rule.includeFiles.length > 0 && !matchesAnyPattern(rel, rule.includeFiles)) return false;
  if (Array.isArray(rule.excludeFiles) && rule.excludeFiles.length > 0 && matchesAnyPattern(rel, rule.excludeFiles)) return false;
  return true;
}

function listFiles(rootDir, roots, includeExtensions = [], rule = {}) {
  const extensions = includeExtensions.length > 0 ? new Set(includeExtensions) : DEFAULT_EXTENSIONS;
  const files = [];

  function visit(abs) {
    const rel = normalizeRel(relative(rootDir, abs));
    const isRoot = !rel || rel === '.';
    const name = isRoot ? '' : rel.split('/').at(-1);
    if (statSync(abs).isDirectory()) {
      if (!isRoot && IGNORED_DIRS.has(name)) return;
      for (const entry of readdirSync(abs)) visit(join(abs, entry));
      return;
    }
    if (isRoot) return;
    if (!extensions.has(extname(abs))) return;
    if (!roots.some((rootPattern) => matchesRoot(rel, rootPattern))) return;
    if (!fileIncludedByRule(rel, rule)) return;
    files.push(rel);
  }

  visit(rootDir);
  return files.sort();
}

function collectImports(text) {
  const imports = [];
  for (const match of text.matchAll(IMPORT_RE)) {
    const source = match[1] ?? match[2];
    if (!source) continue;
    imports.push({ source, index: match.index ?? 0 });
  }
  return imports;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function lineTextAt(text, line) {
  return text.split('\n')[Math.max(0, line - 1)] ?? '';
}

function resolveImportSource(file, source) {
  if (!source.startsWith('.')) return source;
  const resolved = normalizeRel(join(dirname(file), source));
  return resolved.replace(/\.(ts|tsx|js|mjs|cjs|json)$/u, '');
}

function matchesForbiddenImport(file, source, forbidden) {
  const resolved = resolveImportSource(file, source);
  const normalizedForbidden = normalizeRel(forbidden).replace(/\.(ts|tsx|js|mjs|cjs|json)$/u, '');
  if (normalizedForbidden.endsWith('/')) {
    const prefix = normalizedForbidden.slice(0, -1);
    return resolved === prefix || resolved.startsWith(`${prefix}/`) || source === prefix || source.startsWith(`${prefix}/`);
  }
  if (normalizedForbidden.startsWith('src/') || normalizedForbidden.startsWith('tools/')) {
    return resolved === normalizedForbidden || resolved.startsWith(`${normalizedForbidden}/`);
  }
  return source === normalizedForbidden || source.startsWith(`${normalizedForbidden}/`);
}

function ruleMode(rule, defaultMode) {
  return rule.mode ?? defaultMode ?? 'shadow';
}

function findingSeverity(rule, defaultMode) {
  const mode = ruleMode(rule, defaultMode);
  return mode === 'authoritative' ? 'error' : 'shadow_error';
}

function isShadowLikeMode(mode) {
  return mode === 'shadow' || mode === 'shadow_aligned';
}

function validateRuleShape(rule, groupName, defaultMode, findings) {
  const file = DEFAULT_RULES_PATH;
  for (const field of ['id', 'severity', 'description', 'mode']) {
    if (!rule[field]) findings.push(createFinding('error', 'ARCH_BOUNDARY_RULE_FIELD_MISSING', file, `${groupName} rule must declare ${field}`, { ruleId: rule.id ?? null, expected: field }));
  }
  const mode = ruleMode(rule, defaultMode);
  if (!VALID_MODES.has(mode)) {
    findings.push(createFinding('error', 'ARCH_BOUNDARY_RULE_MODE_INVALID', file, `${groupName} rule mode must be authoritative, shadow, or shadow_aligned`, { ruleId: rule.id ?? null, actual: mode }));
  }
  if (!VALID_SEVERITIES.has(rule.severity)) {
    findings.push(createFinding('error', 'ARCH_BOUNDARY_RULE_SEVERITY_INVALID', file, `${groupName} rule severity must be error or shadow_error`, { ruleId: rule.id ?? null, actual: rule.severity }));
  }
  if (mode === 'authoritative' && rule.severity !== 'error') {
    findings.push(createFinding('error', 'ARCH_BOUNDARY_AUTHORITATIVE_SEVERITY_INVALID', file, 'authoritative architecture boundary rules must use severity error', { ruleId: rule.id ?? null, actual: rule.severity }));
  }
  if (isShadowLikeMode(mode) && rule.severity !== 'shadow_error') {
    findings.push(createFinding('error', 'ARCH_BOUNDARY_SHADOW_SEVERITY_INVALID', file, 'shadow architecture boundary rules must use severity shadow_error', { ruleId: rule.id ?? null, actual: rule.severity }));
  }
  if (!Array.isArray(rule.roots) || rule.roots.length === 0) {
    findings.push(createFinding('error', 'ARCH_BOUNDARY_RULE_ROOTS_MISSING', file, `${groupName} rule must declare non-empty roots`, { ruleId: rule.id ?? null }));
  }
  if ((groupName === 'importBoundaries' || groupName === 'pathOwnership') && (!Array.isArray(rule.forbiddenImports) || rule.forbiddenImports.length === 0)) {
    findings.push(createFinding('error', 'ARCH_BOUNDARY_RULE_IMPORTS_MISSING', file, `${groupName} rule must declare forbiddenImports`, { ruleId: rule.id ?? null }));
  }
  if (groupName === 'tokenBoundaries') {
    if (!Array.isArray(rule.forbiddenTokens) || rule.forbiddenTokens.length === 0) {
      findings.push(createFinding('error', 'ARCH_BOUNDARY_RULE_TOKENS_MISSING', file, `${groupName} rule must declare forbiddenTokens`, { ruleId: rule.id ?? null }));
    }
    if (!Array.isArray(rule.includeFiles) || rule.includeFiles.length === 0) {
      findings.push(createFinding('error', 'ARCH_BOUNDARY_TOKEN_SCOPE_MISSING', file, 'token boundary rules must declare includeFiles for scope control', { ruleId: rule.id ?? null }));
    }
    if (!Array.isArray(rule.excludeFiles) || rule.excludeFiles.length === 0) {
      findings.push(createFinding('error', 'ARCH_BOUNDARY_TOKEN_EXCLUDE_MISSING', file, 'token boundary rules must declare excludeFiles for scope control', { ruleId: rule.id ?? null }));
    }
    if (!Array.isArray(rule.allowedPhrases) && !Array.isArray(rule.allowedContexts)) {
      findings.push(createFinding('error', 'ARCH_BOUNDARY_TOKEN_ALLOWED_CONTEXT_MISSING', file, 'token boundary rules must declare allowedPhrases or allowedContexts', { ruleId: rule.id ?? null }));
    }
  }
}

function validateRuleIds(ruleGroups, findings) {
  const ids = [];
  for (const rules of Object.values(ruleGroups)) {
    for (const rule of rules ?? []) ids.push(rule.id);
  }
  const seen = new Set();
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) findings.push(createFinding('error', 'ARCH_BOUNDARY_DUPLICATE_RULE_ID', DEFAULT_RULES_PATH, 'architecture boundary rule id must be unique', { ruleId: id }));
    seen.add(id);
  }
}

function scanImportLikeRule(rootDir, rule, groupName, defaultMode) {
  const findings = [];
  const mode = ruleMode(rule, defaultMode);
  const severity = findingSeverity(rule, defaultMode);
  const files = listFiles(rootDir, rule.roots ?? [], rule.includeExtensions ?? [], rule);
  for (const file of files) {
    const text = readTextFile(rootDir, file, findings);
    for (const entry of collectImports(text)) {
      for (const forbidden of rule.forbiddenImports ?? []) {
        if (matchesForbiddenImport(file, entry.source, forbidden)) {
          findings.push(createFinding(severity, 'ARCH_BOUNDARY_FORBIDDEN_IMPORT', file, `${rule.id}: forbidden import ${entry.source}`, {
            ruleId: rule.id,
            ruleType: groupName,
            mode,
            line: lineOf(text, entry.index),
            matchedImport: entry.source,
            forbiddenImport: forbidden,
            authoritative: mode === 'authoritative',
            shadowMode: isShadowLikeMode(mode)
          }));
        }
      }
    }
  }
  return { findings, metrics: { scannedFileCount: files.length } };
}

function sanitizeIgnoredSegments(text, ignore = {}) {
  if (!ignore.lineComments && !ignore.blockComments) return { sanitized: text, ignoredOccurrenceIndexes: new Set() };
  let sanitized = '';
  const ignoredOccurrenceIndexes = new Set();
  let i = 0;
  let inBlock = false;
  let inLine = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') {
        sanitized += '\n';
        inLine = false;
      } else {
        sanitized += ' ';
        ignoredOccurrenceIndexes.add(i);
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        sanitized += '  ';
        ignoredOccurrenceIndexes.add(i);
        ignoredOccurrenceIndexes.add(i + 1);
        i += 2;
        inBlock = false;
      } else {
        sanitized += ch === '\n' ? '\n' : ' ';
        ignoredOccurrenceIndexes.add(i);
        i += 1;
      }
      continue;
    }
    if (ignore.lineComments && ch === '/' && next === '/') {
      sanitized += '  ';
      ignoredOccurrenceIndexes.add(i);
      ignoredOccurrenceIndexes.add(i + 1);
      i += 2;
      inLine = true;
      continue;
    }
    if (ignore.blockComments && ch === '/' && next === '*') {
      sanitized += '  ';
      ignoredOccurrenceIndexes.add(i);
      ignoredOccurrenceIndexes.add(i + 1);
      i += 2;
      inBlock = true;
      continue;
    }
    sanitized += ch;
    i += 1;
  }
  return { sanitized, ignoredOccurrenceIndexes };
}

function allowedByPhrase(lineText, rule) {
  const allowedPhrases = [...(rule.allowedPhrases ?? []), ...(rule.allowedContexts ?? [])];
  return allowedPhrases.some((phrase) => phrase && lineText.includes(phrase));
}

function scanTokenRule(rootDir, rule, defaultMode) {
  const findings = [];
  const mode = ruleMode(rule, defaultMode);
  const severity = findingSeverity(rule, defaultMode);
  const files = listFiles(rootDir, rule.roots ?? [], rule.includeExtensions ?? [], rule);
  const metrics = { scannedFileCount: files.length, ignoredOccurrenceCount: 0, allowedOccurrenceCount: 0 };
  for (const file of files) {
    const text = readTextFile(rootDir, file, findings);
    const { sanitized, ignoredOccurrenceIndexes } = sanitizeIgnoredSegments(text, rule.ignore ?? {});
    for (const token of rule.forbiddenTokens ?? []) {
      const originalTokenRe = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'g');
      for (const originalMatch of text.matchAll(originalTokenRe)) {
        const index = originalMatch.index ?? 0;
        if (ignoredOccurrenceIndexes.has(index)) metrics.ignoredOccurrenceCount += 1;
      }
      const tokenRe = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'g');
      for (const match of sanitized.matchAll(tokenRe)) {
        const index = match.index ?? 0;
        const line = lineOf(text, index);
        const originalLine = lineTextAt(text, line);
        if (allowedByPhrase(originalLine, rule)) {
          metrics.allowedOccurrenceCount += 1;
          continue;
        }
        findings.push(createFinding(severity, 'ARCH_BOUNDARY_FORBIDDEN_TOKEN', file, `${rule.id}: forbidden token ${token}`, {
          ruleId: rule.id,
          ruleType: 'tokenBoundaries',
          mode,
          line,
          matchedToken: token,
          authoritative: mode === 'authoritative',
          shadowMode: isShadowLikeMode(mode),
          allowedByContext: false
        }));
      }
    }
  }
  return { findings, metrics };
}

function summarizeFindings(findings, rules, metrics) {
  const authoritativeViolations = findings.filter((finding) => finding.mode === 'authoritative' || finding.authoritative || finding.severity === 'error');
  const shadowFindings = findings.filter((finding) => isShadowLikeMode(finding.mode) || finding.shadowMode || finding.severity === 'shadow_error');
  const tokenRules = rules.rules?.tokenBoundaries ?? [];
  return {
    authoritativeViolationCount: authoritativeViolations.length,
    shadowFindingCount: shadowFindings.length,
    shadowAlignedRuleCount: tokenRules.filter((rule) => rule.mode === 'shadow_aligned').length,
    tokenRuleCount: tokenRules.length,
    tokenScannedFileCount: metrics.tokenScannedFileCount,
    tokenOccurrencesIgnoredCount: metrics.tokenOccurrencesIgnoredCount,
    tokenOccurrencesAllowedCount: metrics.tokenOccurrencesAllowedCount,
    ruleIds: [...new Set(findings.map((finding) => finding.ruleId).filter(Boolean))].sort(),
    tokenRulesRemainNonAuthoritative: tokenRules.every((rule) => rule.mode !== 'authoritative')
  };
}

export function runArchitectureBoundaryCheck(options = {}) {
  const startedAt = Date.now();
  const rootDir = options.rootDir ?? process.cwd();
  const findings = [];
  const metrics = { tokenScannedFileCount: 0, tokenOccurrencesIgnoredCount: 0, tokenOccurrencesAllowedCount: 0 };
  if (!pathExists(rootDir, DEFAULT_RULES_PATH)) {
    findings.push(createFinding('error', 'ARCH_BOUNDARY_RULES_MISSING', DEFAULT_RULES_PATH, 'architecture boundary rules file is missing'));
  }
  if (!pathExists(rootDir, DEFAULT_MODULE_GRAPH_PATH)) {
    findings.push(createFinding('error', 'MODULE_GRAPH_MISSING', DEFAULT_MODULE_GRAPH_PATH, 'module graph is missing'));
  }
  const rules = readJsonFile(rootDir, DEFAULT_RULES_PATH, findings, { missingCode: 'ARCH_BOUNDARY_RULES_MISSING' });
  const moduleGraph = readJsonFile(rootDir, DEFAULT_MODULE_GRAPH_PATH, findings, { missingCode: 'MODULE_GRAPH_MISSING' });
  const groups = rules.rules ?? {};
  const defaultMode = rules.defaultMode ?? rules.mode ?? 'shadow';
  if (!VALID_MODES.has(defaultMode)) {
    findings.push(createFinding('error', 'ARCH_BOUNDARY_DEFAULT_MODE_INVALID', DEFAULT_RULES_PATH, 'defaultMode must be authoritative, shadow, or shadow_aligned', { actual: defaultMode }));
  }
  if (!moduleGraph.modules || Object.keys(moduleGraph.modules).length === 0) {
    findings.push(createFinding('error', 'MODULE_GRAPH_EMPTY', DEFAULT_MODULE_GRAPH_PATH, 'module graph must expose project layers for architecture boundary checks'));
  }
  validateRuleIds(groups, findings);
  for (const groupName of ['importBoundaries', 'tokenBoundaries', 'pathOwnership']) {
    const groupRules = groups[groupName] ?? [];
    if (!Array.isArray(groupRules)) {
      findings.push(createFinding('error', 'ARCH_BOUNDARY_GROUP_NOT_ARRAY', DEFAULT_RULES_PATH, `${groupName} must be an array`));
      continue;
    }
    for (const rule of groupRules) validateRuleShape(rule, groupName, defaultMode, findings);
  }
  for (const rule of groups.importBoundaries ?? []) {
    const result = scanImportLikeRule(rootDir, rule, 'importBoundaries', defaultMode);
    findings.push(...result.findings);
  }
  for (const rule of groups.pathOwnership ?? []) {
    const result = scanImportLikeRule(rootDir, rule, 'pathOwnership', defaultMode);
    findings.push(...result.findings);
  }
  for (const rule of groups.tokenBoundaries ?? []) {
    const result = scanTokenRule(rootDir, rule, defaultMode);
    findings.push(...result.findings);
    metrics.tokenScannedFileCount += result.metrics.scannedFileCount;
    metrics.tokenOccurrencesIgnoredCount += result.metrics.ignoredOccurrenceCount;
    metrics.tokenOccurrencesAllowedCount += result.metrics.allowedOccurrenceCount;
  }
  const summary = summarizeFindings(findings, rules, metrics);
  return createPluginResult(PLUGIN_ID, findings, startedAt, {
    rulesPath: DEFAULT_RULES_PATH,
    moduleGraphPath: DEFAULT_MODULE_GRAPH_PATH,
    defaultMode,
    summary
  });
}

pluginCliMain(import.meta.url, runArchitectureBoundaryCheck, { id: PLUGIN_ID, file: 'tools/quality/plugins/architecture-boundary-check.mjs' });
