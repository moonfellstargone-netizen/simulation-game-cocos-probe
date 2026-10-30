import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ProbeLifetime, type ProbeBinding, type ProbeResources
} from '../apps/cocos-probe/template/assets/scripts/ProbeLifetime';
import {
  createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost
} from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot } from '../src/game-core';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function resources(): ProbeResources {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  return {
    snapshot,
    schemas: Object.fromEntries(snapshot.schema_paths.map((path) => [path,
      JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))])),
    buildId: 'cocos_engine_lifecycle_contract'
  };
}

function makeProbe(loadResources: () => Promise<ProbeResources> = async () => resources()) {
  let host: CocosSessionHost | null = null;
  let created = 0;
  let mounted = 0;
  const phases: string[] = [];
  const errors: unknown[] = [];
  const rendered: unknown[] = [];
  const lifetime = new ProbeLifetime({
    loadResources,
    createHost: (input) => {
      created++;
      host = createStage1AHost({
        snapshot: input.snapshot as RuntimeConfigSnapshot,
        schemas: input.schemas,
        buildId: input.buildId,
        nowIso8601: '2026-10-30T00:00:00.000Z',
        storage: new InMemorySaveStoragePort()
      });
      return host;
    },
    createBinding: (currentHost) => {
      mounted++;
      return new QinglanUiSceneProbeComponent(currentHost as CocosSessionHost, {
        applyNodeBindingPatch: (patch) => {
          if (!lifetime.isDisposed()) rendered.push(structuredClone(patch));
        }
      });
    },
    onPhase: (phase) => phases.push(phase),
    onError: (error) => errors.push(error)
  });
  return { lifetime, phases, errors, rendered, counts: () => ({ created, mounted }), host: () => host };
}

test('engine outer lifetime loads formal resources once and uses the public action/save/load/unmount path', async () => {
  const gate = deferred<ProbeResources>();
  const p = makeProbe(() => gate.promise);
  const first = p.lifetime.start();
  assert.equal(p.lifetime.start(), first, 'concurrent starts share startup, rather than creating a second Session');
  assert.equal(p.lifetime.status().phase, 'loading');
  await assert.rejects(p.lifetime.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } }), /NOT_READY/);
  gate.resolve(resources());
  await first;
  assert.deepEqual(p.counts(), { created: 1, mounted: 1 });
  assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 360');

  await p.lifetime.execute({ name: 'save', selection: { slot_id: 'probe_memory' } });
  await p.lifetime.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 420');
  await p.lifetime.execute({ name: 'load', selection: { slot_id: 'probe_memory' } });
  assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 360');
  assert.ok(p.rendered.length > 0);
  const closing = p.lifetime.dispose();
  assert.equal(p.lifetime.dispose(), closing, 'repeated destruction shares cleanup');
  await closing;
  assert.deepEqual(p.lifetime.status(), { phase: 'closed', hasSession: false, timeLabel: null });
  assert.equal(p.host()?.hasSession(), false);
  assert.deepEqual(p.errors, []);
});

test('destroying during asynchronous resource loading prevents a late host or node publication', async () => {
  const gate = deferred<ProbeResources>();
  const p = makeProbe(() => gate.promise);
  const started = p.lifetime.start();
  await p.lifetime.dispose();
  gate.resolve(resources());
  await started;
  assert.deepEqual(p.counts(), { created: 0, mounted: 0 });
  assert.deepEqual(p.rendered, []);
  assert.equal(p.lifetime.status().phase, 'closed');
  await p.lifetime.start();
  assert.deepEqual(p.counts(), { created: 0, mounted: 0 });
});

test('resource rejection is observable before host publication and a later explicit startup can recover', async () => {
  const error = new Error('resource-read-rejected');
  let reject = true;
  const p = makeProbe(() => reject ? Promise.reject(error) : Promise.resolve(resources()));
  await assert.rejects(p.lifetime.start(), (caught) => caught === error);
  assert.equal(p.lifetime.status().phase, 'failed');
  assert.deepEqual(p.counts(), { created: 0, mounted: 0 });
  assert.deepEqual(p.errors, [error]);
  reject = false;
  await p.lifetime.start();
  assert.equal(p.lifetime.status().phase, 'ready');
  assert.deepEqual(p.counts(), { created: 1, mounted: 1 });
  await p.lifetime.dispose();
});

test('synchronous resource acquisition errors can be retried without publishing an unusable host', async () => {
  let failing = true;
  const error = new Error('sync-resource-error');
  const p = makeProbe(() => { if (failing) throw error; return Promise.resolve(resources()); });
  await assert.rejects(p.lifetime.start(), (caught) => caught === error);
  failing = false;
  await p.lifetime.start();
  assert.deepEqual(p.counts(), { created: 1, mounted: 1 });
  await p.lifetime.dispose();
});

test('resource failure arriving after destruction cannot change the closed view or create a host', async () => {
  const gate = deferred<ProbeResources>();
  const p = makeProbe(() => gate.promise);
  const started = p.lifetime.start();
  await p.lifetime.dispose();
  gate.reject(new Error('late-load-error'));
  await started;
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.counts(), { created: 0, mounted: 0 });
  assert.equal(p.lifetime.status().phase, 'closed');
});

test('destruction during mounting suppresses late node writes and ready publication, then releases the real host', async (t) => {
  const entered = deferred<void>();
  const gate = deferred<void>();
  let host: CocosSessionHost | null = null;
  let updates = 0;
  const phases: string[] = [];
  const lifetime = new ProbeLifetime({
    loadResources: async () => resources(),
    createHost: (input) => {
      host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot,
        nowIso8601: '2026-10-30T00:00:00.000Z', storage: new InMemorySaveStoragePort() });
      return host;
    },
    createBinding: (currentHost) => new QinglanUiSceneProbeComponent(currentHost as CocosSessionHost, {
      applyNodeBindingPatch: async () => {
        entered.resolve();
        await gate.promise;
        if (!lifetime.isDisposed()) updates++;
      }
    }),
    onPhase: (phase) => phases.push(phase)
  });
  const started = lifetime.start();
  t.after(async () => { gate.resolve(); await lifetime.dispose(); });
  await entered.promise;
  const closed = lifetime.dispose();
  gate.resolve();
  await Promise.all([started, closed]);
  assert.equal(updates, 0);
  assert.equal(phases.includes('ready'), false);
  assert.equal(lifetime.status().phase, 'closed');
  assert.equal((host as CocosSessionHost | null)?.hasSession(), false);
});

test('a failed binding factory releases the already-created host and does not expose readiness', async () => {
  const error = new Error('binding-construction-failed');
  let host: CocosSessionHost | null = null;
  const lifetime = new ProbeLifetime({
    loadResources: async () => resources(),
    createHost: (input) => {
      host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot,
        nowIso8601: '2026-10-30T00:00:00.000Z', storage: new InMemorySaveStoragePort() });
      return host;
    },
    createBinding: () => { throw error; }
  });
  await assert.rejects(lifetime.start(), (caught) => caught === error);
  assert.equal(lifetime.status().phase, 'failed');
  assert.equal((host as CocosSessionHost | null)?.hasSession(), false);
  await lifetime.dispose();
});

test('cleanup releases the host even when a binding unmount rejects', async () => {
  let destroyed = 0;
  const error = new Error('unmount-rejected');
  const binding: ProbeBinding = {
    mount: async () => ({ command_result: { status: 'completed' } }),
    execute: async () => ({ command_result: { status: 'completed' } }),
    unmount: async () => { throw error; }
  };
  const lifetime = new ProbeLifetime({
    loadResources: async () => resources(),
    createHost: () => ({ hasSession: () => destroyed === 0, destroySession: () => { destroyed++; },
      requireSession: () => ({ getViewModel: () => ({ time_label: 'observed' }) }) }),
    createBinding: () => binding
  });
  await lifetime.start();
  await assert.rejects(lifetime.dispose(), (caught) => caught === error);
  assert.equal(destroyed, 1);
  assert.equal(lifetime.status().phase, 'closed');
});

test('disposal triggered by binding construction cannot mount a late session', async () => {
  let host: CocosSessionHost | null = null;
  let mounts = 0;
  const lifetime = new ProbeLifetime({
    loadResources: async () => resources(),
    createHost: (input) => {
      host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot,
        nowIso8601: '2026-10-30T00:00:00.000Z', storage: new InMemorySaveStoragePort() });
      return host;
    },
    createBinding: (currentHost) => {
      void lifetime.dispose();
      const component = new QinglanUiSceneProbeComponent(currentHost as CocosSessionHost, {
        applyNodeBindingPatch: () => { mounts++; }
      });
      return component;
    }
  });
  await lifetime.start();
  await lifetime.dispose();
  assert.equal(mounts, 0);
  assert.equal((host as CocosSessionHost | null)?.hasSession(), false);
  assert.equal(lifetime.status().phase, 'closed');
});
