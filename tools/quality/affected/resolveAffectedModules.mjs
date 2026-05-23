function globRootToPrefix(root) {
  return String(root ?? '').replace(/\\/g, '/').replace(/\/\*\*$/, '/').replace(/\*\*$/, '').replace(/\*$/, '');
}

function matchesRoot(file, root) {
  const normalizedFile = file.replace(/\\/g, '/');
  const normalizedRoot = String(root ?? '').replace(/\\/g, '/');
  if (normalizedRoot.endsWith('/**')) return normalizedFile.startsWith(globRootToPrefix(normalizedRoot));
  if (normalizedRoot.endsWith('*')) return normalizedFile.startsWith(globRootToPrefix(normalizedRoot));
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

function buildReverseDependencies(modules) {
  const reverse = new Map();
  for (const id of Object.keys(modules)) reverse.set(id, new Set());
  for (const [id, module] of Object.entries(modules)) {
    for (const dep of module.dependsOn ?? []) {
      if (!reverse.has(dep)) reverse.set(dep, new Set());
      reverse.get(dep).add(id);
    }
  }
  return reverse;
}

function closureFrom(seeds, reverse) {
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const dependent of reverse.get(id) ?? []) {
      if (!seen.has(dependent)) queue.push(dependent);
    }
  }
  return [...seen];
}

function globalModulesFor(file) {
  if (file === 'package.json' || file === 'package-lock.json') return ['tools', 'tests', 'docs', 'release-tools', 'game-core', 'cocos-app', 'cocos-creator-adapter'];
  if (file.startsWith('tools/quality/rules/') || file.startsWith('tools/quality/') || file.startsWith('tools/run-') || file === 'tools/validate_code_architecture.py') return ['tools', 'tests', 'docs', 'release-tools'];
  if (file === 'tools/build_release_package.py' || file === 'tools/check_release_zip.py') return ['release-tools', 'tools', 'tests', 'docs'];
  if (file.startsWith('docs/') || file === 'README.md' || file === 'design_snapshot/SOURCE_DESIGN_PACK.txt') return ['docs', 'tests', 'tools'];
  if (file.startsWith('design_snapshot/')) return ['docs', 'tests', 'tools', 'game-core'];
  if (file.startsWith('tests/')) return ['tests'];
  return [];
}

export function resolveAffectedModules(changedFiles, moduleGraph) {
  const modules = moduleGraph.modules ?? {};
  const reverse = buildReverseDependencies(modules);
  const owningModules = new Map();
  const seedModules = new Set();
  const unmatchedFiles = [];

  for (const file of changedFiles) {
    const owners = new Set(globalModulesFor(file));
    for (const [moduleId, module] of Object.entries(modules)) {
      if ((module.roots ?? []).some((root) => matchesRoot(file, root))) owners.add(moduleId);
    }
    if (owners.size === 0) unmatchedFiles.push(file);
    owningModules.set(file, [...owners]);
    for (const owner of owners) seedModules.add(owner);
  }

  const affectedModules = closureFrom(seedModules, reverse);
  return {
    owningModules: Object.fromEntries(owningModules),
    affectedModules,
    unmatchedFiles,
    fallback: unmatchedFiles.length > 0,
    fallbackReason: unmatchedFiles.length > 0 ? `unmatched changed files: ${unmatchedFiles.join(', ')}` : ''
  };
}
