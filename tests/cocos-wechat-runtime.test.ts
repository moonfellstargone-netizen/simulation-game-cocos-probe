import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WechatProbeController, readCandidateIdentity, type CandidateIdentity,
  type WechatProbeSnapshot, type WechatResources } from '../apps/cocos-wechat-probe/template/assets/scripts/WechatProbeController';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot, type SaveStoragePort } from '../src/game-core';
import { WECHAT_BACKUP_SLOT_ID, WECHAT_SAVE_SLOT_ID } from '../apps/cocos-wechat-probe/template/assets/scripts/WechatSaveStoragePort';
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
function harness(options: { identity?: CandidateIdentity; storage?: SaveStoragePort;
  load?: () => Promise<{ resources: WechatResources; identity: unknown }>;
  prepareBackupRecovery?: () => Promise<void>;
  recoverValidatedBackup?: () => Promise<void>;
  cancelFirstFailedSave?: () => Promise<void>;
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
    prepareBackupRecovery: options.prepareBackupRecovery,
    recoverValidatedBackup: options.recoverValidatedBackup,
    cancelFirstFailedSave: options.cancelFirstFailedSave,
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

test('M2 manual save/load restores A state in B while the running B identity stays independent', async () => {
  const storage = new InMemorySaveStoragePort();
  const a = harness({ storage, identity: identity('1') });
  await a.controller.start();
  await a.controller.advance();
  await a.controller.save();
  const saved = await storage.read(WECHAT_SAVE_SLOT_ID);
  assert.ok(saved);
  await a.controller.dispose();
  const b = harness({ storage, identity: identity('2') });
  await b.controller.start();
  assert.equal(b.controller.snapshot().time_label, 'day 1 minute 360');
  await b.controller.load();
  assert.equal(b.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(b.controller.snapshot().identity?.candidate_id, identity('2').candidate_id);
  assert.equal(await storage.read(WECHAT_SAVE_SLOT_ID), saved);
  await b.controller.advance();
  assert.equal(b.controller.snapshot().time_label, 'day 1 minute 480');
  await b.controller.dispose();
});

test('M2 empty, invalid, read and write failures preserve session and allow healthy retry', async () => {
  const delegate = new InMemorySaveStoragePort();
  let failRead = false;
  let failWrite = false;
  const storage: SaveStoragePort = {
    read: async slot => { if (failRead) throw new Error('injected-read-failure'); return delegate.read(slot); },
    write: async (slot, data) => { if (failWrite) throw new Error('injected-write-failure'); return delegate.write(slot, data); }
  };
  const p = harness({ storage });
  await p.controller.start();
  await p.controller.advance();
  await assert.rejects(p.controller.load(), /SAVE_SLOT_NOT_FOUND/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  await delegate.write(WECHAT_SAVE_SLOT_ID, '{broken');
  await assert.rejects(p.controller.load(), /LOAD_REJECTED/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  failRead = true;
  await assert.rejects(p.controller.load(), /injected-read-failure/);
  failRead = false;
  failWrite = true;
  await assert.rejects(p.controller.save(), /injected-write-failure/);
  assert.equal(await delegate.read(WECHAT_SAVE_SLOT_ID), '{broken');
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  failWrite = false;
  await p.controller.save();
  await p.controller.advance();
  await p.controller.load();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(p.controller.snapshot().last_error, null);
  await p.controller.dispose();
});

test('M2 background blocks new commands, allows in-flight completion and foreground does not auto-save or advance', async () => {
  const delegate = new InMemorySaveStoragePort();
  const gate = deferred<void>();
  const entered = deferred<void>();
  let writes = 0;
  let reads = 0;
  const storage: SaveStoragePort = {
    read: async slot => { reads++; return delegate.read(slot); },
    write: async (slot, data) => { writes++; entered.resolve(); await gate.promise; await delegate.write(slot, data); }
  };
  const p = harness({ storage });
  await p.controller.start();
  const saving = p.controller.save();
  await entered.promise;
  await assert.rejects(p.controller.advance(), /BUSY/);
  p.controller.setVisible(false);
  await assert.rejects(p.controller.advance(), /HIDDEN/);
  await assert.rejects(p.controller.load(), /HIDDEN/);
  gate.resolve();
  await saving;
  assert.equal(p.controller.snapshot().visible, false);
  assert.equal(p.controller.snapshot().busy, false);
  p.controller.setVisible(true);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 360');
  assert.equal(writes, 1);
  assert.equal(reads, 0);
  await p.controller.advance();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  await p.controller.dispose();
});

test('M2 cannot report storage success for a completed command with a missing or wrong per-command receipt', async () => {
  let mode: 'missing' | 'wrong' | 'normal' = 'missing';
  const controller = new WechatProbeController({
    load: async () => ({ resources: resources(), identity: identity() }),
    createHost: value => createStage1AHost({ ...value, snapshot: value.snapshot as RuntimeConfigSnapshot,
      storage: new InMemorySaveStoragePort(), nowIso8601: '2026-11-03T00:00:00.000Z' }),
    createBinding: host => {
      const binding = new QinglanUiSceneProbeComponent(host as CocosSessionHost, { applyNodeBindingPatch: () => {} });
      return {
        mount: () => binding.mount(),
        unmount: () => binding.unmount(),
        execute: command => {
          if (mode === 'missing') return Promise.resolve({ command_result: { status: 'completed' } });
          if (mode === 'wrong') return Promise.resolve({ command_result: { status: 'completed',
            snapshot: { save_load: { last_save_result: { slot_id: 'other' } } } } });
          return binding.execute(command);
        }
      };
    }
  });
  await controller.start();
  await assert.rejects(controller.save(), /STORAGE_FAILED/);
  mode = 'wrong';
  await assert.rejects(controller.save(), /STORAGE_FAILED/);
  assert.equal(controller.snapshot().completed_commands, 0);
  mode = 'normal';
  await controller.save();
  assert.equal(controller.snapshot().completed_commands, 1);
  await controller.dispose();
});

test('M2 disposal suppresses late UI completion for a save already accepted by the storage port', async () => {
  const gate = deferred<void>();
  const entered = deferred<void>();
  const delegate = new InMemorySaveStoragePort();
  const p = harness({ storage: {
    read: slot => delegate.read(slot),
    write: async (slot, value) => { entered.resolve(); await gate.promise; await delegate.write(slot, value); }
  } });
  await p.controller.start();
  const saving = p.controller.save();
  await entered.promise;
  const closing = p.controller.dispose();
  const notifications = p.states.length;
  gate.resolve();
  await Promise.all([saving, closing]);
  assert.equal(p.states.length, notifications);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(p.controller.snapshot().completed_commands, 0);
  assert.ok(await delegate.read(WECHAT_SAVE_SLOT_ID), 'an accepted in-flight write is not claimed to be cancelled');
  assert.equal(p.host().hasSession(), false);
});

test('M2 explicitly loads a validated backup and protects the healthy session from bad or rejected backup reads', async () => {
  const delegate = new InMemorySaveStoragePort();
  let backupRead: 'normal' | 'corrupt' | 'reject' = 'normal';
  let recoveries = 0;
  let failRecovery = false;
  let stateProbe = '';
  const storage: SaveStoragePort = {
    read: async slot => {
      if (slot === WECHAT_BACKUP_SLOT_ID && backupRead === 'reject') throw new Error('backup-read-failed');
      if (slot === WECHAT_BACKUP_SLOT_ID && backupRead === 'corrupt') return '{invalid-backup';
      return delegate.read(slot);
    },
    write: async (slot, value) => {
      if (slot === 'state_probe') { stateProbe = value; return; }
      assert.equal(slot, WECHAT_SAVE_SLOT_ID);
      const old = await delegate.read(slot);
      if (old !== null) await delegate.write(WECHAT_BACKUP_SLOT_ID, old);
      await delegate.write(slot, value);
    }
  };
  const p = harness({ storage, identity: identity('2'), prepareBackupRecovery: async () => {
    const input = resources();
    const host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot,
      storage: { read: () => storage.read(WECHAT_BACKUP_SLOT_ID), write: async () => { throw new Error('read only'); } },
      nowIso8601: '2026-11-03T00:00:00.000Z' });
    try { await host.requireSession().load(WECHAT_BACKUP_SLOT_ID); }
    finally { host.destroySession(); }
  }, recoverValidatedBackup: async () => {
    recoveries++;
    if (failRecovery) throw new Error('promotion-failed');
    const backup = await delegate.read(WECHAT_BACKUP_SLOT_ID);
    assert.ok(backup);
    await delegate.write(WECHAT_SAVE_SLOT_ID, backup);
  } });
  await p.controller.start();
  await assert.rejects(p.controller.loadBackup(), /SAVE_SLOT_NOT_FOUND/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 360');
  assert.equal(recoveries, 0);
  await p.controller.advance();
  await p.controller.save();
  await p.controller.advance();
  await p.controller.save();
  await p.controller.advance();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 540');
  await p.host().requireSession().save('state_probe');
  const healthyState = stateProbe;
  backupRead = 'reject';
  await assert.rejects(p.controller.loadBackup(), /backup-read-failed/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 540');
  await p.host().requireSession().save('state_probe');
  assert.equal(stateProbe, healthyState);
  backupRead = 'corrupt';
  await assert.rejects(p.controller.loadBackup(), /LOAD_REJECTED/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 540');
  await p.host().requireSession().save('state_probe');
  assert.equal(stateProbe, healthyState);
  assert.equal(recoveries, 0, 'invalid or rejected backup never invokes recovery');
  backupRead = 'normal';
  failRecovery = true;
  const beforeFailure = p.controller.snapshot().completed_commands;
  await assert.rejects(p.controller.loadBackup(), /BACKUP_RECOVERY_INCOMPLETE:promotion-failed/);
  assert.equal(p.controller.snapshot().completed_commands, beforeFailure);
  assert.equal(p.controller.snapshot().busy, false);
  assert.match(p.controller.snapshot().last_error!, /BACKUP_RECOVERY_INCOMPLETE/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 540');
  await p.host().requireSession().save('state_probe');
  assert.equal(stateProbe, healthyState, 'failed promotion leaves the full current session intact');
  failRecovery = false;
  await p.controller.loadBackup();
  assert.equal(recoveries, 2);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(p.controller.snapshot().identity?.candidate_id, identity('2').candidate_id);
  assert.equal(p.controller.snapshot().last_error, null);
  await p.controller.advance();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 480');
  await p.controller.dispose();
});

test('M2 backup recovery requires a recovery callback and remains busy while promotion is pending', async () => {
  const missing = harness();
  await missing.controller.start();
  await assert.rejects(missing.controller.loadBackup(), /BACKUP_RECOVERY_UNAVAILABLE/);
  assert.equal(missing.controller.snapshot().time_label, 'day 1 minute 360');
  assert.equal(missing.controller.snapshot().accepted_commands, 0);
  await missing.controller.dispose();

  const storage = new InMemorySaveStoragePort();
  const old = harness({ storage });
  await old.controller.start();
  await old.controller.advance();
  await old.controller.save();
  const oldBytes = await storage.read(WECHAT_SAVE_SLOT_ID);
  assert.ok(oldBytes);
  await storage.write(WECHAT_BACKUP_SLOT_ID, oldBytes);
  await old.controller.dispose();
  const gate = deferred<void>();
  const entered = deferred<void>();
  const p = harness({ storage, prepareBackupRecovery: async () => {}, recoverValidatedBackup: async () => { entered.resolve(); await gate.promise; } });
  await p.controller.start();
  const loading = p.controller.loadBackup();
  await entered.promise;
  assert.equal(p.controller.snapshot().busy, true);
  await assert.rejects(p.controller.advance(), /BUSY/);
  await assert.rejects(p.controller.save(), /BUSY/);
  const closing = p.controller.dispose();
  const notifications = p.states.length;
  gate.resolve();
  await Promise.all([loading, closing]);
  assert.equal(p.states.length, notifications);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(p.controller.snapshot().completed_commands, 0);
  assert.equal(p.host().hasSession(), false);

  const readGate = deferred<void>();
  const readEntered = deferred<void>();
  let promotions = 0;
  const gatedStorage: SaveStoragePort = {
    read: async slot => { readEntered.resolve(); await readGate.promise; return storage.read(slot); },
    write: (slot, value) => storage.write(slot, value)
  };
  const late = harness({ storage: gatedStorage,
    prepareBackupRecovery: async () => { await gatedStorage.read(WECHAT_BACKUP_SLOT_ID); },
    recoverValidatedBackup: async () => { promotions++; } });
  await late.controller.start();
  const lateLoad = late.controller.loadBackup();
  await readEntered.promise;
  const lateClosing = late.controller.dispose();
  readGate.resolve();
  await Promise.all([lateLoad, lateClosing]);
  assert.equal(promotions, 0, 'a disposed controller must not start a late promotion');
  assert.equal(late.controller.snapshot().phase, 'closed');
});

test('M2 checks pending recovery inside the busy lock before reading a backup or changing the session', async () => {
  let reads = 0;
  let recovered = 0;
  let mode: 'not-pending' | 'error' | 'wait' = 'not-pending';
  const entered = deferred<void>();
  const gate = deferred<void>();
  const delegate = new InMemorySaveStoragePort();
  const storage: SaveStoragePort = {
    read: async slot => { reads++; return delegate.read(slot); },
    write: (slot, value) => delegate.write(slot, value)
  };
  const p = harness({ storage, prepareBackupRecovery: async () => {
    if (mode === 'not-pending') throw new Error('ERR_WECHAT_RECOVERY_NOT_PENDING');
    if (mode === 'error') throw new Error('prepare-rejected');
    entered.resolve();
    await gate.promise;
  }, recoverValidatedBackup: async () => { recovered++; } });
  await p.controller.start();
  await p.controller.advance();
  await assert.rejects(p.controller.loadBackup(), /RECOVERY_NOT_PENDING/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(reads, 0);
  assert.equal(recovered, 0);
  mode = 'error';
  await assert.rejects(p.controller.loadBackup(), /prepare-rejected/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.match(p.controller.snapshot().last_error!, /prepare-rejected/);
  assert.equal(p.controller.snapshot().busy, false);
  assert.equal(reads, 0);
  assert.equal(recovered, 0);
  mode = 'wait';
  const loading = p.controller.loadBackup();
  await entered.promise;
  assert.equal(p.controller.snapshot().busy, true);
  await assert.rejects(p.controller.advance(), /BUSY/);
  const closing = p.controller.dispose();
  gate.resolve();
  await Promise.all([loading, closing]);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(reads, 0, 'disposal during preparation must not start a late load');
  assert.equal(recovered, 0);
});

test('M2 rejects backup recovery without both preparation and validated recovery callbacks', async () => {
  for (const options of [
    { prepareBackupRecovery: async () => {} },
    { recoverValidatedBackup: async () => {} }
  ]) {
    const p = harness(options);
    await p.controller.start();
    await assert.rejects(p.controller.loadBackup(), /BACKUP_RECOVERY_UNAVAILABLE/);
    assert.equal(p.controller.snapshot().accepted_commands, 0);
    assert.equal(p.controller.snapshot().time_label, 'day 1 minute 360');
    await p.controller.dispose();
  }
});

test('M2 reports a failed final load separately after successful storage recovery and preserves the whole session', async () => {
  let stateProbe = '';
  let promoted = false;
  let playerReads = 0;
  const storage: SaveStoragePort = {
    read: async () => { playerReads++; throw new Error('final-main-read-failed'); },
    write: async (slot, value) => { assert.equal(slot, 'state_probe'); stateProbe = value; }
  };
  const p = harness({ storage, prepareBackupRecovery: async () => {}, recoverValidatedBackup: async () => { promoted = true; } });
  await p.controller.start();
  await p.controller.advance();
  await p.host().requireSession().save('state_probe');
  const before = stateProbe;
  const completed = p.controller.snapshot().completed_commands;
  await assert.rejects(p.controller.loadBackup(), /BACKUP_RESTORED_RESULT_UNCERTAIN:final-main-read-failed/);
  assert.equal(promoted, true);
  assert.equal(playerReads, 1);
  assert.equal(p.controller.snapshot().completed_commands, completed);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  await p.host().requireSession().save('state_probe');
  assert.equal(stateProbe, before);
  assert.match(p.controller.snapshot().last_error!, /BACKUP_RESTORED_RESULT_UNCERTAIN/);
  await p.controller.dispose();
});

test('M2 binding patch failure after recovered load reports uncertainty because the session may already be replaced', async () => {
  const storage = new InMemorySaveStoragePort();
  let failPatch = false;
  const p = harness({ storage, prepareBackupRecovery: async () => {}, recoverValidatedBackup: async () => {},
    patch: () => { if (failPatch) throw new Error('binding-patch-failed'); } });
  await p.controller.start();
  await p.controller.advance();
  await p.controller.save();
  await p.controller.advance();
  await p.host().requireSession().save('state_before');
  const before = await storage.read('state_before');
  const completed = p.controller.snapshot().completed_commands;
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 480');
  failPatch = true;
  await assert.rejects(p.controller.loadBackup(), /BACKUP_RESTORED_RESULT_UNCERTAIN:binding-patch-failed/);
  assert.equal(p.controller.snapshot().completed_commands, completed);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  await p.host().requireSession().save('state_after');
  assert.notEqual(await storage.read('state_after'), before, 'the session was committed before the patch rejected');
  assert.match(p.controller.snapshot().last_error!, /BACKUP_RESTORED_RESULT_UNCERTAIN/);
  failPatch = false;
  await p.controller.dispose();
});

test('M2 explicit first-save cancellation preserves the session and reports callback failures', async () => {
  const missing = harness();
  await missing.controller.start();
  await assert.rejects(missing.controller.cancelFirstFailedSave(), /FIRST_CANCEL_UNAVAILABLE/);
  assert.equal(missing.controller.snapshot().accepted_commands, 0);
  await missing.controller.dispose();

  let calls = 0;
  let shouldFail = true;
  const p = harness({ cancelFirstFailedSave: async () => {
    calls++;
    if (shouldFail) throw new Error('cancel-rejected');
  } });
  await p.controller.start();
  await p.controller.advance();
  p.controller.setVisible(false);
  await assert.rejects(p.controller.cancelFirstFailedSave(), /HIDDEN/);
  assert.equal(calls, 0);
  p.controller.setVisible(true);
  const previousCompletions = p.controller.snapshot().completed_commands;
  await assert.rejects(p.controller.cancelFirstFailedSave(), /cancel-rejected/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(p.controller.snapshot().completed_commands, previousCompletions);
  assert.match(p.controller.snapshot().last_error!, /cancel-rejected/);
  assert.equal(p.controller.snapshot().busy, false);
  shouldFail = false;
  await p.controller.cancelFirstFailedSave();
  assert.equal(calls, 2);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(p.controller.snapshot().completed_commands, previousCompletions + 1);
  assert.equal(p.controller.snapshot().last_error, null);
  await p.controller.advance();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 480');
  await p.controller.dispose();
  await assert.rejects(p.controller.cancelFirstFailedSave(), /NOT_READY/);
});

test('M2 explicit first-save cancellation shares the busy lock and suppresses late success after disposal', async () => {
  const entered = deferred<void>();
  const gate = deferred<void>();
  let calls = 0;
  const p = harness({ cancelFirstFailedSave: async () => { calls++; entered.resolve(); await gate.promise; } });
  await p.controller.start();
  const cancellation = p.controller.cancelFirstFailedSave();
  await entered.promise;
  assert.equal(p.controller.snapshot().busy, true);
  await assert.rejects(p.controller.cancelFirstFailedSave(), /BUSY/);
  await assert.rejects(p.controller.advance(), /BUSY/);
  assert.equal(calls, 1);
  const closing = p.controller.dispose();
  const notifications = p.states.length;
  gate.resolve();
  await Promise.all([cancellation, closing]);
  assert.equal(p.states.length, notifications);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(p.controller.snapshot().completed_commands, 0);
  assert.equal(p.host().hasSession(), false);
});
