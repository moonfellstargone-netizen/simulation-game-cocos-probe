import { readJsonFile } from './readJsonFile.mjs';

const PROJECT_TARGET_PATH = 'tools/quality/rules/project-target.json';
const CONTEXT_DOC_SURFACE_RULES_PATH = 'tools/quality/rules/context-doc-surface.rules.json';
const ARCHITECTURE_BOUNDARY_RULES_PATH = 'tools/quality/rules/architecture-boundary.rules.json';

function getPathValue(object, path) {
  return path.split('.').reduce((current, segment) => (current && Object.prototype.hasOwnProperty.call(current, segment) ? current[segment] : undefined), object);
}

function flattenProjectTarget(projectTarget) {
  const flat = {};
  function walk(prefix, value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, nested] of Object.entries(value)) walk(`${prefix}.${key}`, nested);
      return;
    }
    flat[prefix] = value;
  }
  walk('project', projectTarget);
  return flat;
}

function buildVariableMap(projectTarget, rules) {
  const flat = flattenProjectTarget(projectTarget);
  const variables = {};
  for (const [name, template] of Object.entries(rules.variables ?? {})) {
    variables[name] = expandTemplate(template, { ...flat, ...variables });
  }
  return { ...flat, ...variables };
}

export function expandTemplate(value, variables) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, name) => {
      const resolved = Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : getPathValue(variables, name);
      return resolved === undefined || resolved === null ? '' : String(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item) => expandTemplate(item, variables));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, expandTemplate(nested, variables)]));
  }
  return value;
}

export function loadProjectTarget(rootDir = process.cwd(), findings = []) {
  return readJsonFile(rootDir, PROJECT_TARGET_PATH, findings, { missingCode: 'PROJECT_TARGET_MISSING' });
}

export function loadContextDocSurfaceRules(rootDir = process.cwd(), findings = []) {
  return readJsonFile(rootDir, CONTEXT_DOC_SURFACE_RULES_PATH, findings, { missingCode: 'CONTEXT_DOC_RULES_MISSING' });
}

export function loadArchitectureBoundaryRules(rootDir = process.cwd(), findings = []) {
  return readJsonFile(rootDir, ARCHITECTURE_BOUNDARY_RULES_PATH, findings, { missingCode: 'ARCHITECTURE_BOUNDARY_RULES_MISSING' });
}

export function loadQualityRuleContext(rootDir = process.cwd(), findings = []) {
  const projectTarget = loadProjectTarget(rootDir, findings);
  const contextDocSurfaceRulesRaw = loadContextDocSurfaceRules(rootDir, findings);
  const architectureBoundaryRulesRaw = loadArchitectureBoundaryRules(rootDir, findings);
  const variables = buildVariableMap(projectTarget, contextDocSurfaceRulesRaw);
  const contextDocSurfaceRules = expandTemplate(contextDocSurfaceRulesRaw, variables);
  return {
    projectTarget,
    contextDocSurfaceRules,
    architectureBoundaryRules: architectureBoundaryRulesRaw,
    variables,
    paths: {
      projectTarget: PROJECT_TARGET_PATH,
      contextDocSurfaceRules: CONTEXT_DOC_SURFACE_RULES_PATH,
      architectureBoundaryRules: ARCHITECTURE_BOUNDARY_RULES_PATH
    }
  };
}
