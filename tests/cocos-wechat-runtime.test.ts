import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WechatProbeController, readCandidateIdentity, type CandidateIdentity,
  type WechatProbeSnapshot, type WechatResources } from '../apps/cocos-wechat-probe/template/assets/scripts/WechatProbeController';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot } from '../src/game-core';
import { deriveBuildId } from '../tools/quality/lib/versionSurface.mjs';

const target = JSON.parse(readFileSync('tools/quality/rules/project-target.json', 'utf8'));
function identity(seed = '1', version = target.version): CandidateIdentity {
  return { schema: 'wechat-candidate/v1', candidate_id: `wechat-${seed.repeat(8)}-${seed.repeat(4)}-${seed.repeat(4)}-${seed.repeat(4)}-${seed.repeat(12)}`,
    source_commit: 'a'.repeat(40), short_commit: 'a'.repeat(12),
    version: version.codePackageVersion, build_id: deriveBuildId('cocos_wechat_probe', version.snakeVersion) };
}
function resources(buildId = identity().build_id): WechatResources {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  return { snapshot, schemas: Object.fromEntries(snapshot.schema_paths.map(path => [path,
    JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))])), buildId };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(options: { identity?: CandidateIdentity; storage?: InMemorySaveStoragePort;
  load?: () => Promise<{ resources: WechatResources; identity: unknown }>;
  patch?: () => void | Promise<void> } = {}) {
  let host: CocosSessionHost | null = null;
  let binding: QinglanUiSceneProbeComponent | null = null;
  let factories = 0;
  const states: WechatProbeSnapshot[] = [];
  const current = options.identity ?? identity();
  const controller = new WechatProbeController({
    load: options.load ?? (async () => ({ resources: resources(current.build_id), identity: current })),
    createHost: input => {
      factories++;
      host = createStage1AHost({ snapshot: input.snapshot as RuntimeConfigSnapshot, schemas: input.schemas,
        buildId: input.buildId, nowIso8601: '2026-11-03T00:00:00.000Z', storage: options.storage ?? new InMemorySaveStoragePort() });
      return host;
    },
    createBinding: currentHost => {
      binding = new QinglanUiSceneProbeComponent(currentHost as CocosSessionHost, { applyNodeBindingPatch: options.patch ?? (() => {}) });
      return binding;
    },
    onChange: state => states.push(state)
  });
  return { controller, states, host: () => host!, binding: () => binding!, factories: () => factories };
}

test('M1 public formal resources start once and one command advances one hour through the binding queue', async () => {
  const gate = deferred<{ resources: WechatResources; identity: unknown }>();
  const original = identity();
  const p = harness({ load: () => gate.promise });
  const first = p.controller.start();
  assert.equal(p.controller.start(), first);
  await assert.rejects(p.controller.advance(), /NOT_READY/);
  gate.resolve({ resources: resources(), identity: original });
  await first;
  assert.equal(p.factories(), 1);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 360');
  const result = await p.controller.advance();
  assert.equal(result.time_label, 'day 1 minute 420');
  assert.equal(result.busy, false);
  assert.equal(result.accepted_commands, 1);
  assert.equal(result.completed_commands, 1);
  assert.equal(result.identity?.candidate_id, original.candidate_id);
  assert.equal(Object.isFrozen(result.identity), true);
  (original as { candidate_id: string }).candidate_id = identity('2').candidate_id;
  assert.notEqual(p.controller.snapshot().identity?.candidate_id, original.candidate_id);
  await p.controller.dispose();
  assert.equal(p.host().hasSession(), false);
  await assert.rejects(p.controller.advance(), /NOT_READY/);
  await assert.rejects(p.controller.start(), /CLOSED/);
});

test('M1 rejects concurrent input and suppresses completion feedback after disposal of an accepted action', async () => {
  const gate = deferred<void>();
  const entered = deferred<void>();
  let hold = false;
  const p = harness({ patch: () => { if (hold) { entered.resolve(); return gate.promise; } } });
  await p.controller.start();
  hold = true;
  const advancing = p.controller.advance();
  await entered.promise;
  await assert.rejects(p.controller.advance(), /BUSY/);
  const closing = p.controller.dispose();
  const countAtClose = p.states.length;
  gate.resolve();
  await Promise.all([advancing, closing]);
  assert.equal(p.states.length, countAtClose);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(p.controller.snapshot().accepted_commands, 1);
  assert.equal(p.controller.snapshot().completed_commands, 0);
  assert.equal(p.host().hasSession(), false);
  assert.equal(p.controller.dispose(), closing);
});

test('M1 resource failure and invalid candidate identity produce no usable half-started host', async () => {
  for (const bad of [null, {}, { ...identity(), short_commit: 'bad' }, { ...identity(), candidate_id: 'wechat-' + '-'.repeat(36) }]) {
    assert.throws(() => readCandidateIdentity(bad), /CANDIDATE_INVALID/);
    const p = harness({ load: async () => ({ resources: resources(), identity: bad }) });
    await assert.rejects(p.controller.start(), /CANDIDATE_INVALID/);
    assert.equal(p.factories(), 0);
    assert.equal(p.controller.snapshot().phase, 'failed');
    await p.controller.dispose();
  }
  const mismatch = harness({ load: async () => ({ resources: resources('different'), identity: identity() }) });
  await assert.rejects(mismatch.controller.start(), /CANDIDATE_BUILD_ID/);
  assert.equal(mismatch.factories(), 0);
  const invalidSchemas = harness({ load: async () => ({ resources: { ...resources(), schemas: {} }, identity: identity() }) });
  await assert.rejects(invalidSchemas.controller.start(), /SCHEMA/);
  assert.equal(invalidSchemas.controller.snapshot().phase, 'failed');
  assert.equal(invalidSchemas.controller.snapshot().has_session, false);
  await invalidSchemas.controller.dispose();
});

test('M1 disposal before asynchronous resource completion never creates a session', async () => {
  const gate = deferred<{ resources: WechatResources; identity: unknown }>();
  const p = harness({ load: () => gate.promise });
  const starting = p.controller.start();
  await p.controller.dispose();
  gate.resolve({ resources: resources(), identity: identity() });
  await starting;
  assert.equal(p.factories(), 0);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(p.controller.snapshot().identity, null);
});

test('M1 startup preserves its primary failure and failed state even when binding cleanup also rejects', async () => {
  const input = resources();
  let host: CocosSessionHost | null = null;
  const controller = new WechatProbeController({
    load: async () => ({ resources: input, identity: identity() }),
    createHost: value => {
      host = createStage1AHost({ ...value, snapshot: value.snapshot as RuntimeConfigSnapshot,
        storage: new InMemorySaveStoragePort(), nowIso8601: '2026-11-03T00:00:00.000Z' });
      return host;
    },
    createBinding: () => ({
      mount: async () => { throw new Error('primary-mount-failure'); },
      execute: async () => { throw new Error('not-mounted'); },
      unmount: async () => { throw new Error('cleanup-failure'); }
    })
  });
  await assert.rejects(controller.start(), /primary-mount-failure/);
  assert.equal(controller.snapshot().phase, 'failed');
  assert.equal(controller.snapshot().last_error, 'primary-mount-failure');
  assert.equal(controller.snapshot().has_session, false);
  assert.equal((host as CocosSessionHost | null)?.hasSession(), false);
  await controller.dispose();
});

test('M1 action binding failure preserves the committed world and a later input can recover', async () => {
  let fail = false;
  const p = harness({ patch: () => { if (fail) throw new Error('view-port-failure'); } });
  await p.controller.start();
  fail = true;
  await assert.rejects(p.controller.advance(), /view-port-failure/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(p.controller.snapshot().busy, false);
  assert.equal(p.controller.snapshot().completed_commands, 0);
  assert.match(p.controller.snapshot().last_error!, /view-port-failure/);
  fail = false;
  await p.controller.advance();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 480');
  assert.equal(p.controller.snapshot().accepted_commands, 2);
  assert.equal(p.controller.snapshot().completed_commands, 1);
  assert.equal(p.controller.snapshot().last_error, null);
  await p.controller.dispose();
});

test('M1 disposal during delayed startup cleanup cannot overwrite the closed state with a late failure', async () => {
  const cleanup = deferred<void>();
  const entered = deferred<void>();
  const phases: string[] = [];
  let host: CocosSessionHost | null = null;
  const controller = new WechatProbeController({
    load: async () => ({ resources: resources(), identity: identity() }),
    createHost: value => {
      host = createStage1AHost({ ...value, snapshot: value.snapshot as RuntimeConfigSnapshot,
        storage: new InMemorySaveStoragePort(), nowIso8601: '2026-11-03T00:00:00.000Z' });
      return host;
    },
    createBinding: () => ({
      mount: async () => { throw new Error('primary-mount-failure'); },
      execute: async () => { throw new Error('not-mounted'); },
      unmount: async () => { entered.resolve(); await cleanup.promise; }
    }),
    onChange: state => phases.push(state.phase)
  });
  const starting = controller.start();
  await entered.promise;
  await controller.dispose();
  assert.deepEqual(phases, ['loading', 'closed']);
  cleanup.resolve();
  await starting;
  assert.deepEqual(phases, ['loading', 'closed']);
  assert.equal(controller.snapshot().phase, 'closed');
  assert.equal((host as CocosSessionHost | null)?.hasSession(), false);
});

test('M1 identity stays with running candidate B when a public controlled load restores candidate A metadata', async () => {
  const storage = new InMemorySaveStoragePort();
  const a = harness({ storage, identity: identity('1', target.previous) });
  await a.controller.start();
  await a.controller.advance();
  await a.binding().execute({ name: 'save', selection: { slot_id: 'identity_contract' } });
  const savedBytes = await storage.read('identity_contract');
  assert.ok(savedBytes);
  const b = harness({ storage, identity: identity('2') });
  await b.controller.start();
  assert.equal(b.controller.snapshot().time_label, 'day 1 minute 360');
  const loaded = await b.binding().execute({ name: 'load', selection: { slot_id: 'identity_contract' } });
  assert.equal(loaded.command_result.status, 'completed');
  assert.equal(b.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(b.controller.snapshot().identity?.candidate_id, identity('2').candidate_id);
  assert.equal(b.controller.snapshot().identity?.build_id, identity('2').build_id);
  assert.equal(await storage.read('identity_contract'), savedBytes);
  await Promise.all([a.controller.dispose(), b.controller.dispose()]);
  const reloaded = harness({ identity: identity('2') });
  await reloaded.controller.start();
  assert.equal(reloaded.controller.snapshot().time_label, 'day 1 minute 360', 'M1 deliberately creates a temporary new session');
  assert.equal(reloaded.controller.snapshot().identity?.candidate_id, identity('2').candidate_id);
  await reloaded.controller.dispose();
});
