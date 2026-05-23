export const BASELINE_TASK_IDS = [
  'quality.versionConsistency',
  'quality.configIntegrity',
  'quality.testRegistryIntegrity'
];

const RISK_ORDER = [
  'docs-low',
  'tests-medium',
  'quality-high',
  'source-risky',
  'config-high',
  'release-high',
  'global-high',
  'unknown-safe',
  'unknown-risky'
];

const FALLBACK_PRIORITY = {
  none: 0,
  fast: 1,
  conservative: 2,
  'release-surface': 3,
  'full-recommended': 4
};

export const MINIMUM_TASKS_BY_RISK = {
  always: [
    'quality.versionConsistency',
    'quality.configIntegrity',
    'quality.testRegistryIntegrity'
  ],
  'docs-low': [
    'quality.versionConsistency',
    'test.context-governance',
    'test.package-hygiene',
    'quality.contextDocSurface'
  ],
  'tests-medium': [
    'static.typecheck',
    'quality.testRegistryIntegrity',
    'test.quality-affected-contracts'
  ],
  'quality-high': [
    'quality.self-test',
    'quality.configIntegrity',
    'quality.testRegistryIntegrity',
    'test.quality-plugin-contracts',
    'test.quality-affected-contracts',
    'test.quality-cache-contracts'
  ],
  'source-risky': [
    'static.typecheck',
    'architecture.legacy',
    'quality.architectureBoundary',
    'test.stage1a-baseline',
    'test.api-boundary'
  ],
  'config-high': [
    'static.typecheck',
    'quality.self-test',
    'quality.configIntegrity',
    'quality.testRegistryIntegrity',
    'test.package-hygiene'
  ],
  'release-high': [
    'quality.releaseSurface',
    'test.package-hygiene',
    'quality.versionConsistency'
  ],
  'global-high': [
    'static.typecheck',
    'architecture.legacy',
    'quality.contextDocSurface',
    'test.stage1a-baseline',
    'test.context-governance'
  ],
  'unknown-risky': [
    'static.typecheck',
    'architecture.legacy',
    'quality.self-test',
    'quality.architectureBoundary',
    'test.package-hygiene',
    'test.quality-affected-contracts',
    'test.quality-cache-contracts'
  ],
  'unknown-safe': [
    'quality.versionConsistency',
    'quality.configIntegrity'
  ]
};

const CONFIG_FILES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'eslint.config.js',
  'eslint.config.mjs',
  'prettier.config.js',
  'prettier.config.mjs',
  'vitest.config.ts',
  'vitest.config.js',
  'vitest.config.mjs',
  'tools/quality/quality.config.json'
]);

const QUALITY_HIGH_FILES = new Set([
  'tools/quality/module-graph.json',
  'tools/quality/test-registry.json',
  'tools/quality/gate-policy.json',
  'tools/quality/rules/project-target.json',
  'tools/quality/rules/architecture-boundary.rules.json',
  'tools/quality/rules/context-doc-surface.rules.json'
]);

const RELEASE_HIGH_FILES = new Set([
  'tools/build_release_package.py',
  'tools/check_release_zip.py'
]);

function normalizePath(file) {
  return String(file ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function startsWithAny(file, prefixes) {
  return prefixes.some((prefix) => file.startsWith(prefix));
}

export function getAffectedGatePolicy(gatePolicy) {
  const gate = gatePolicy.gates?.affected;
  if (!gate) throw new Error('affected gate is missing from gate-policy.json');
  if (gate.releaseGate === true || gate.neverReleaseAuthority !== true) {
    throw new Error('affected gate must never be release authority');
  }
  if (!gate.fallbackGate) throw new Error('affected gate must declare fallbackGate');
  return gate;
}

export function classifyChangedFileRisk(file) {
  const normalized = normalizePath(file);
  if (!normalized) return 'unknown-risky';
  if (startsWithAny(normalized, ['src/game-core/', 'src/cocos-app/', 'src/cocos-creator-adapter/'])) return 'source-risky';
  if (CONFIG_FILES.has(normalized)) return 'config-high';
  if (RELEASE_HIGH_FILES.has(normalized)) return 'release-high';
  if (QUALITY_HIGH_FILES.has(normalized) || startsWithAny(normalized, ['tools/quality/'])) return 'quality-high';
  if (startsWithAny(normalized, ['design_snapshot/', 'schema/', 'schemas/', 'fixtures/', 'configs/'])) return 'global-high';
  if (startsWithAny(normalized, ['tests/'])) return 'tests-medium';
  if (startsWithAny(normalized, ['docs/']) || normalized === 'README.md' || normalized === 'design_snapshot/SOURCE_DESIGN_PACK.txt') return 'docs-low';
  return 'unknown-risky';
}

export function classifyRiskForChangedFiles(changedFiles) {
  const riskClassification = {};
  const riskSet = new Set();
  for (const file of changedFiles ?? []) {
    const normalized = normalizePath(file);
    const risk = classifyChangedFileRisk(normalized);
    riskClassification[normalized] = risk;
    riskSet.add(risk);
  }
  if (riskSet.size === 0) riskSet.add('unknown-risky');
  return {
    riskClassification,
    riskTypes: [...riskSet].sort((a, b) => RISK_ORDER.indexOf(a) - RISK_ORDER.indexOf(b)),
    highestRisk: [...riskSet].sort((a, b) => RISK_ORDER.indexOf(b) - RISK_ORDER.indexOf(a))[0]
  };
}

export function resolveFallbackLevel(riskTypes, options = {}) {
  const risks = new Set(riskTypes ?? []);
  const reasons = [];
  let level = 'none';
  function promote(next, reason) {
    if (FALLBACK_PRIORITY[next] > FALLBACK_PRIORITY[level]) level = next;
    if (reason) reasons.push(reason);
  }

  if (options.changedFilesFallback) promote('conservative', options.changedFilesFallbackReason || 'changed files source required fallback');
  if (options.moduleFallback) promote('conservative', options.moduleFallbackReason || 'module graph mapping required fallback');
  if (risks.has('unknown-risky')) promote('conservative', 'unknown-risky files require conservative fallback');
  if (risks.has('quality-high')) promote('conservative', 'quality policy or quality tooling changed');
  if (risks.has('source-risky')) promote('conservative', 'source-risky files require runtime and architecture coverage');
  if (risks.has('tests-medium')) promote('fast', 'test changes require fast feedback plus registry integrity');
  if (risks.has('docs-low')) promote('fast', 'documentation changes require context and package hygiene coverage');
  if (risks.has('release-high')) promote('release-surface', 'release tooling changed; release surface coverage and q:release reminder required');
  if (risks.has('config-high')) promote('full-recommended', 'configuration or package metadata changed; q:full is recommended after affected feedback');
  if (risks.has('global-high')) promote('full-recommended', 'global design/schema/config surface changed; q:full is recommended after affected feedback');

  return {
    fallbackLevel: level,
    fallbackReason: reasons.join('; ') || 'none'
  };
}

export function minimumRequiredTasksForRisks(riskTypes) {
  const required = new Set(MINIMUM_TASKS_BY_RISK.always);
  for (const risk of riskTypes ?? []) {
    for (const taskId of MINIMUM_TASKS_BY_RISK[risk] ?? []) required.add(taskId);
  }
  return [...required];
}

export function taskMatchesRisk(task, riskTypes) {
  const risks = new Set(riskTypes ?? []);
  const covers = new Set(task.covers ?? []);
  const tags = new Set(task.tags ?? []);
  if (risks.has('docs-low') && (covers.has('docs') || covers.has('design_snapshot') || tags.has('context') || tags.has('hygiene'))) return true;
  if (risks.has('tests-medium') && (covers.has('tests') || tags.has('test-registry'))) return true;
  if (risks.has('quality-high') && ([...covers].some((cover) => String(cover).startsWith('tools/quality')) || tags.has('quality') || tags.has('architecture-boundary'))) return true;
  if (risks.has('source-risky') && (covers.has('game-core') || covers.has('cocos-app') || covers.has('cocos-creator-adapter') || tags.has('stage1a') || tags.has('cocos'))) return true;
  if (risks.has('config-high') && (tags.has('fast') || tags.has('quality') || covers.has('package-scripts') || covers.has('tools'))) return true;
  if (risks.has('release-high') && (covers.has('release-tools') || tags.has('release') || tags.has('release-surface') || tags.has('hygiene'))) return true;
  if (risks.has('global-high') && (covers.has('game-core') || covers.has('docs') || covers.has('design_snapshot') || tags.has('stage1a'))) return true;
  if (risks.has('unknown-risky') && (tags.has('fast') || tags.has('quality') || covers.has('tools') || covers.has('docs'))) return true;
  return false;
}
