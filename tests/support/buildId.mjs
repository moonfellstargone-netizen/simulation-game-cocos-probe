import { loadVersionSurface, deriveBuildId } from '../../tools/quality/lib/versionSurface.mjs';

const surface = loadVersionSurface();

export const baselineBuildIds = surface.baselineBuildIds;
export const currentSnakeVersion = surface.markers.snakeVersion;

export function testBuildId(role) {
  return deriveBuildId(role, surface.markers.snakeVersion);
}

export function reloadBuildIdSurface(rootDir = process.cwd()) {
  const next = loadVersionSurface(rootDir);
  return {
    baselineBuildIds: next.baselineBuildIds,
    testBuildId: (role) => deriveBuildId(role, next.markers.snakeVersion)
  };
}
