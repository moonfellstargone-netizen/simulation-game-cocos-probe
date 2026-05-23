import { loadProjectTarget } from './projectTarget.mjs';

const BASELINE_SUFFIXES = ['fixture_baseline', 'headless_baseline', 'cocos_baseline'];

export function collectVersionMarkers(projectTarget) {
  const version = projectTarget.version ?? {};
  const release = projectTarget.release ?? {};
  return {
    codePackageVersion: version.codePackageVersion,
    npmVersion: version.npmVersion,
    qualityMetadataVersion: version.qualityMetadataVersion,
    snakeVersion: version.snakeVersion,
    versionName: version.versionName,
    chineseVersionName: version.chineseVersionName,
    releaseRoot: release.root,
    releaseZip: release.zip
  };
}

export function deriveBaselineBuildIds(snakeVersion) {
  return Object.fromEntries(BASELINE_SUFFIXES.map((suffix) => [suffix, `${suffix}_${snakeVersion}`]));
}

export function deriveBuildId(role, snakeVersion) {
  return `${role}_${snakeVersion}`;
}

export function collectStaleVersionMarkers(projectTarget) {
  return [...(projectTarget.staleMarkers?.forbiddenCurrentMarkers ?? [])];
}

export function collectStaleBuildIdMarkers(projectTarget) {
  const markers = new Set();
  for (const snake of collectSnakeVersionsForStaleBuildIds(projectTarget)) {
    for (const suffix of BASELINE_SUFFIXES) {
      markers.add(`${suffix}_${snake}`);
    }
  }
  return [...markers];
}

function collectSnakeVersionsForStaleBuildIds(projectTarget) {
  const snakes = new Set();
  const previous = projectTarget.previous ?? {};
  if (previous.snakeVersion) snakes.add(previous.snakeVersion);
  for (const marker of projectTarget.staleMarkers?.forbiddenCurrentMarkers ?? []) {
    const match = /^v0_0_2_\d+$/.exec(marker);
    if (match) snakes.add(marker);
  }
  return [...snakes];
}

export function pathAllowlistForHistoricalMarkers(projectTarget) {
  const paths = new Set(['tools/quality/rules/project-target.json']);
  for (const scope of projectTarget.staleMarkers?.allowedHistoricalScopes ?? []) {
    if (scope.includes('/') || scope.endsWith('.md')) paths.add(scope);
  }
  return paths;
}

export function loadVersionSurface(rootDir = process.cwd()) {
  const projectTarget = loadProjectTarget(rootDir);
  const markers = collectVersionMarkers(projectTarget);
  return {
    projectTarget,
    markers,
    baselineBuildIds: deriveBaselineBuildIds(markers.snakeVersion),
    staleVersionMarkers: collectStaleVersionMarkers(projectTarget),
    staleBuildIdMarkers: collectStaleBuildIdMarkers(projectTarget),
    pathAllowlist: pathAllowlistForHistoricalMarkers(projectTarget)
  };
}
