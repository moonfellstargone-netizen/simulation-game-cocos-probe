import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ConfigRepository,
  RuntimeContractValidator,
  RuntimeSchemaValidator,
  type RuntimeConfigSnapshot,
} from '../src/game-core/index';
import { Stage1AActionScriptRunner, Stage1AHeadlessRuntime } from '../src/game-core/dev-api';
import { deriveBuildId, loadVersionSurface } from '../tools/quality/lib/versionSurface.mjs';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function collectJsonSchemas(dir: string, base = dir, out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectJsonSchemas(full, base, out);
    if (entry.isFile() && entry.name.endsWith('.json')) {
      out[relative(base, full).replaceAll('\\\\', '/')] = readJson(full);
    }
  }
  return out;
}

const root = process.cwd();
const { markers } = loadVersionSurface(root);
const snapshot = readJson<RuntimeConfigSnapshot>(join(root, 'design_snapshot/generated/stage_1A_runtime_snapshot.json'));
const configs = new ConfigRepository(snapshot);
const contracts = new RuntimeContractValidator(RuntimeSchemaValidator.fromSnapshotSchemas(collectJsonSchemas(join(root, 'design_snapshot/schemas'))));
const runtime = new Stage1AHeadlessRuntime(configs, contracts, {
  buildId: deriveBuildId('stage1a_headless_cli', markers.snakeVersion),
  nowIso8601: '2026-05-19T00:00:00.000Z'
});
const runner = new Stage1AActionScriptRunner();

console.log('New game created');
const report = runner.runCoreLoop(runtime);
for (const step of report.step_results) {
  console.log(`${step.action_type} ${step.success ? 'OK' : step.status_code}`);
}

console.log('');
console.log('Final summary:');
console.log(runtime.summaryText());
console.log('storage audit: OK');
console.log('save schema: OK');
