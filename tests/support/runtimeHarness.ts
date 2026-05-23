import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ConfigRepository, GameRuntime, NewGameBuilder, RuntimeContractValidator, RuntimeSchemaValidator } from '../../src/game-core/index';
import type { RuntimeConfigSnapshot } from '../../src/game-core/index';

export const root = process.cwd();

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function collectJsonSchemas(dir: string, base = dir, out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectJsonSchemas(full, base, out);
    if (entry.isFile() && entry.name.endsWith('.json')) {
      out[relative(base, full).replaceAll('\\\\', '/')] = readJson(full);
    }
  }
  return out;
}

export function buildContracts(): RuntimeContractValidator {
  return new RuntimeContractValidator(RuntimeSchemaValidator.fromSnapshotSchemas(collectJsonSchemas(join(root, 'design_snapshot/schemas'))));
}

export function buildRuntime() {
  const snapshot = readJson<RuntimeConfigSnapshot>(join(root, 'design_snapshot/generated/stage_1A_runtime_snapshot.json'));
  const configs = new ConfigRepository(snapshot);
  const contracts = buildContracts();
  const runtime = new GameRuntime(configs, contracts);
  const state = new NewGameBuilder(configs).buildStage1A({ buildId: 'test_build_v0_0_2_22', nowIso8601: '2026-05-18T00:00:00.000Z' });
  return { snapshot, configs, contracts, runtime, state };
}

export function buildRuntimeWithoutState() {
  const snapshot = readJson<RuntimeConfigSnapshot>(join(root, 'design_snapshot/generated/stage_1A_runtime_snapshot.json'));
  const configs = new ConfigRepository(snapshot);
  const contracts = buildContracts();
  const runtime = new GameRuntime(configs, contracts);
  return { snapshot, configs, contracts, runtime };
}

export function cloneForCompare<T>(value: T): T {
  return structuredClone(value);
}
