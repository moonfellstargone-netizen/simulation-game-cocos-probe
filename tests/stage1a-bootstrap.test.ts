import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createStage1AHost,
  CocosUiShellController,
  CocosUiShellCommandQueue,
  type CocosSessionHost,
  type Stage1ABootstrapResources
} from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, RuntimeContractValidator, RuntimeSchemaValidator, type RuntimeConfigSnapshot } from '../src/game-core';
import { testBuildId } from './support/buildId.mjs';

class CountingMemoryStorage extends InMemorySaveStoragePort {
  readonly operations: string[] = [];

  override async write(slotId: string, serializedSave: string): Promise<void> {
    this.operations.push(`write:${slotId}`);
    await super.write(slotId, serializedSave);
  }

  override async read(slotId: string): Promise<string | null> {
    this.operations.push(`read:${slotId}`);
    return await super.read(slotId);
  }
}

// Only this test layer reads files; runtime assembly uses the public bootstrap API.
function resources(): Stage1ABootstrapResources & { storage: CountingMemoryStorage } {
  const snapshot = JSON.parse(readFileSync(join(process.cwd(), 'design_snapshot/generated/stage_1A_runtime_snapshot.json'), 'utf8')) as RuntimeConfigSnapshot;
  const schemas = Object.fromEntries(snapshot.schema_paths.map((path) => [
    path,
    JSON.parse(readFileSync(join(process.cwd(), 'design_snapshot', path), 'utf8')) as unknown
  ]));
  return {
    snapshot,
    schemas,
    storage: new CountingMemoryStorage(),
    buildId: testBuildId('bootstrap_integration'),
    nowIso8601: '2026-05-21T00:00:00.000Z'
  };
}

function assertNotPublished(input: ReturnType<typeof resources>, expected?: RegExp): void {
  let published: CocosSessionHost | undefined;
  const attempt = () => { published = createStage1AHost(input); };
  if (expected) assert.throws(attempt, expected);
  else assert.throws(attempt);
  assert.equal(published, undefined, 'failed assembly must not publish a usable host');
  assert.deepEqual(input.storage.operations, [], 'assembly must not read or write player storage');
  assert.equal(input.storage.snapshot().size, 0);
}

test('formal resources bootstrap a ready host through public shell, action, save/load and lifecycle APIs', async () => {
  const input = resources();
  const originalSnapshot = structuredClone(input.snapshot);
  const originalSchemas = structuredClone(input.schemas);
  const host = createStage1AHost(input);
  assert.equal(host.hasSession(), true);
  assert.deepEqual(input.storage.operations, []);
  const initialView = host.requireSession().getViewModel();
  const queue = new CocosUiShellCommandQueue(new CocosUiShellController(host));
  assert.equal((await queue.execute({ name: 'create_session' })).status, 'completed', 'the shell accepts an already-created session');

  const saved = await queue.execute({ name: 'save', selection: { slot_id: 'bootstrap_initial' } });
  assert.equal(saved.status, 'completed');
  const serializedInitial = await input.storage.read('bootstrap_initial');
  assert.notEqual(serializedInitial, null);
  const save = JSON.parse(serializedInitial!);
  assert.equal(save.created_with_build, input.buildId);
  assert.equal(save.created_at_real_time, input.nowIso8601);

  const advanced = await queue.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(advanced.status, 'completed');
  assert.equal(advanced.snapshot.menu.last_action_result?.success, true);
  assert.notDeepEqual(host.requireSession().getViewModel(), initialView);
  const loaded = await queue.execute({ name: 'load', selection: { slot_id: 'bootstrap_initial' } });
  assert.equal(loaded.status, 'completed');
  assert.deepEqual(host.requireSession().getViewModel(), initialView);
  assert.equal((await queue.execute({ name: 'save', selection: { slot_id: 'bootstrap_restored' } })).status, 'completed');
  assert.equal(await input.storage.read('bootstrap_restored'), serializedInitial);

  assert.equal((await queue.execute({ name: 'destroy_session' })).status, 'completed');
  assert.equal(host.hasSession(), false);
  assert.throws(() => host.requireSession(), /ERR_COCOS_SESSION_NOT_CREATED/);
  assert.deepEqual(input.snapshot, originalSnapshot, 'bootstrap and actions must not rewrite supplied resources');
  assert.deepEqual(input.schemas, originalSchemas);
});

test('a missing declared schema fails before publishing or accessing storage', () => {
  const input = resources();
  delete input.schemas['schemas/action_result.schema.json'];
  assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_MISSING:schemas\/action_result.schema.json/);
});

test('contract readiness rejects a core schema even when omitted from the caller declaration', () => {
  const input = resources();
  input.snapshot.schema_paths = input.snapshot.schema_paths.filter((path) => path !== 'schemas/action_result.schema.json');
  delete input.schemas['schemas/action_result.schema.json'];
  assertNotPublished(input, /ERR_RUNTIME_SCHEMA_NOT_LOADED:action_result.schema.json/);
});

test('invalid schema syntax is rejected by the existing schema validator before publishing', () => {
  const input = resources();
  input.schemas['schemas/animal_instance.schema.json'] = { $id: 'animal_instance.schema.json', type: 42 };
  assertNotPublished(input);
});

test('bootstrap compiles declared schemas that are not needed just to construct a new session', () => {
  const input = resources();
  // This config schema is outside the nine runtime contracts' reference closure.
  input.schemas['schemas/config/crop_config.schema.json'] = {
    $id: 'crop_config.schema.json',
    $ref: 'missing_bootstrap_reference.schema.json'
  };
  // Control: the runtime contracts still compile, so only checking those is insufficient.
  new RuntimeContractValidator(RuntimeSchemaValidator.fromSnapshotSchemas(input.schemas)).assertReady();
  assertNotPublished(input, /missing_bootstrap_reference.schema.json/);
});

test('duplicate schema identities cannot silently replace a resource', () => {
  const input = resources();
  (input.schemas['schemas/action_result.schema.json'] as Record<string, unknown>).$id = 'action_request.schema.json';
  assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_ID_DUPLICATE:action_request.schema.json/);
});

test('a schema identity must match its declared resource basename', () => {
  const input = resources();
  (input.schemas['schemas/action_result.schema.json'] as Record<string, unknown>).$id = 'wrong_action_result.schema.json';
  assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_ID_MISMATCH:schemas\/action_result.schema.json/);
});

test('undeclared schema resources are not silently ignored', () => {
  const input = resources();
  input.schemas['schemas/extra.schema.json'] = { $id: 'extra.schema.json', type: 'object' };
  assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_UNDECLARED:schemas\/extra.schema.json/);
});

test('schema resources must be schema objects', () => {
  const input = resources();
  input.schemas['schemas/action_result.schema.json'] = null;
  assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_INVALID:schemas\/action_result.schema.json/);
});

test('schema paths are canonical and unique', async (t) => {
  for (const invalidPath of [
    '../schemas/action_result.schema.json',
    '/schemas/action_result.schema.json',
    'C:/schemas/action_result.schema.json',
    'schemas\\action_result.schema.json',
    'schemas/../action_result.schema.json',
    'schemas//action_result.schema.json'
  ]) {
    await t.test(invalidPath, () => {
      const input = resources();
      input.snapshot.schema_paths = [invalidPath];
      assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_PATH_INVALID/);
    });
  }
  await t.test('duplicate declaration', () => {
    const input = resources();
    input.snapshot.schema_paths.push(input.snapshot.schema_paths[0]!);
    assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_PATH_DUPLICATE/);
  });
});

test('a missing required configuration fails without publishing a usable host', () => {
  const input = resources();
  delete input.snapshot.loaded_documents['configs/core/new_game_builder_mapping.yaml'];
  assertNotPublished(input, /ERR_CONFIG_DOC_NOT_LOADED/);
});

test('invalid initial state fails the existing session schema or audit checks before publishing', () => {
  const input = resources();
  const initialWorld = input.snapshot.loaded_documents['configs/initial_world/stage_1A_initial_world.yaml'] as { world_time: { absolute_minute: unknown } };
  initialWorld.world_time.absolute_minute = 'not a minute';
  assertNotPublished(input, /ERR_COCOS_SESSION_VALIDATION_FAILED/);
});

test('the Stage1A bootstrap does not open another stage', () => {
  const input = resources();
  (input.snapshot.loaded_documents['configs/active_stage_1A/stage_1A_active_config.yaml'] as Record<string, unknown>).stage_id = 'stage_1B';
  assertNotPublished(input, /ERR_BOOTSTRAP_STAGE_UNSUPPORTED:stage_1B/);
});

test('startup requires explicit build identity and valid timestamp instead of probe defaults', async (t) => {
  for (const [field, value] of [['buildId', ''], ['nowIso8601', 'not a timestamp']] as const) {
    await t.test(field, () => {
      const input = resources();
      input[field] = value;
      assertNotPublished(input, new RegExp(`ERR_BOOTSTRAP_RESOURCE_INVALID:${field}`));
    });
  }
});

test('snapshot resource metadata and containers must have the declared structure', async (t) => {
  for (const field of ['snapshot_id', 'loaded_documents', 'schema_paths'] as const) {
    await t.test(field, () => {
      const input = resources();
      (input.snapshot as unknown as Record<string, unknown>)[field] = null;
      assertNotPublished(input, /ERR_BOOTSTRAP_RESOURCE_INVALID/);
    });
  }
});

test('startup timestamps reject impossible dates and out-of-range clock fields', async (t) => {
  for (const timestamp of [
    '2026-02-30T00:00:00.000Z',
    '2026-04-31T00:00:00+08:00',
    '2025-02-29T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T23:60:00Z',
    '2026-01-01T23:59:60Z'
  ]) {
    await t.test(timestamp, () => {
      const input = resources();
      input.nowIso8601 = timestamp;
      assertNotPublished(input, /ERR_BOOTSTRAP_RESOURCE_INVALID:nowIso8601/);
    });
  }
});

test('valid leap dates, offsets and fractional seconds preserve the supplied startup metadata', async (t) => {
  for (const timestamp of [
    '2024-02-29T23:59:59.123Z',
    '2000-02-29T00:00:00+08:00',
    '2026-10-30T11:45:12.1-05:30'
  ]) {
    await t.test(timestamp, async () => {
      const input = resources();
      input.nowIso8601 = timestamp;
      const host = createStage1AHost(input);
      assert.deepEqual(input.storage.operations, []);
      await host.requireSession().save('bootstrap_valid_timestamp');
      const save = JSON.parse((await input.storage.read('bootstrap_valid_timestamp'))!);
      assert.equal(save.created_at_real_time, timestamp);
      assert.equal(save.last_saved_at_real_time, timestamp);
      assert.equal(save.created_with_build, input.buildId);
      host.destroySession();
    });
  }
});
