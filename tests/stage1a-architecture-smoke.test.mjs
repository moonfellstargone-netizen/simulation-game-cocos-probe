import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test('design snapshot is bound to formal design pack v1.5.2.2 and Stage 1A load order', () => {
  const snapshotPath = join(root, 'design_snapshot/generated/stage_1A_runtime_snapshot.json');
  assert.equal(existsSync(snapshotPath), true);
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  assert.equal(snapshot.source_formal_design_version, 'v1.5.2.2');
  assert.equal(snapshot.source_config_profile, 'configs/active_stage_1A/load_order.yaml');
  assert.ok(snapshot.loaded_documents['configs/core/new_game_builder_mapping.yaml']);
  assert.ok(snapshot.loaded_documents['tests/expected/stage_1A_runtime_lifecycle_matrix.yaml']);
});

test('core source keeps engine adapter outside game-core', () => {
  const dispatcher = readFileSync(join(root, 'src/cocos-app/adapters/CocosActionDispatcher.ts'), 'utf8');
  const pipeline = readFileSync(join(root, 'src/game-core/action/ActionPipeline.ts'), 'utf8');
  assert.match(dispatcher, /pipeline\.dispatch/);
  assert.doesNotMatch(pipeline, /cc\.|Node|Component|_decorator/);
});
