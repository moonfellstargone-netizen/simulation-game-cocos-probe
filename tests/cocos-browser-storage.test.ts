import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BrowserSaveStoragePort, BROWSER_SAVE_SLOT_ID, BROWSER_SAVE_STORAGE_KEY,
  type BrowserStorage
} from '../apps/cocos-probe/template/assets/scripts/BrowserSaveStoragePort';
import { ProbeInteraction } from '../apps/cocos-probe/template/assets/scripts/ProbeInteraction';
import { ProbeLifetime } from '../apps/cocos-probe/template/assets/scripts/ProbeLifetime';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import type { RuntimeConfigSnapshot } from '../src/game-core';

const ADVANCE = { name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } } as const;
const SAVE = { name: 'save', selection: { slot_id: BROWSER_SAVE_SLOT_ID } } as const;
const LOAD = { name: 'load', selection: { slot_id: BROWSER_SAVE_SLOT_ID } } as const;

// This fake controls browser API outcomes only; formal resources and the public host stay real.
class ControlledBrowserStorage implements BrowserStorage {
  readonly values = new Map<string, string>();
  readonly calls: string[] = [];
  readError: Error | null = null;
  writeError: Error | null = null;

  getItem(key: string): string | null {
    this.calls.push(`read:${key}`);
    if (this.readError) throw this.readError;
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.calls.push(`write:${key}`);
    if (this.writeError) throw this.writeError;
    this.values.set(key, value);
  }
}

async function publicProbe(storage: BrowserSaveStoragePort, buildId = 'browser_storage_contract') {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  let host: CocosSessionHost | null = null;
  const errors: unknown[] = [];
  const lifetime = new ProbeLifetime({
    loadResources: async () => ({
      snapshot, buildId,
      schemas: Object.fromEntries(snapshot.schema_paths.map((path) => [path,
        JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))]))
    }),
    createHost: (input) => {
      host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot,
        storage, nowIso8601: '2026-10-31T00:00:00.000Z' });
      return host;
    },
    createBinding: (current) => new QinglanUiSceneProbeComponent(current as CocosSessionHost, {
      applyNodeBindingPatch: () => {}
    }),
    onError: (error) => errors.push(error)
  });
  const interaction = new ProbeInteraction({
    isAvailable: () => !lifetime.isDisposed() && lifetime.status().phase === 'ready',
    execute: (command) => lifetime.execute(command),
    onChange: () => {}
  });
  await lifetime.start();
  return { lifetime, interaction, errors, session: () => host!.requireSession() };
}

test('browser adapter lazily uses one stable key and preserves raw strings and unrelated data', async () => {
  const browser = new ControlledBrowserStorage();
  browser.values.set('unrelated', 'keep');
  let acquisitions = 0;
  const first = new BrowserSaveStoragePort(() => { acquisitions++; return browser; });
  assert.equal(acquisitions, 0);
  assert.equal(BROWSER_SAVE_SLOT_ID, 'web_probe');
  assert.equal(BROWSER_SAVE_STORAGE_KEY, 'qinglan.simulation-game.cocos-probe.save.web_probe');
  assert.equal(await first.read(BROWSER_SAVE_SLOT_ID), null);
  const raw = ' \n{"opaque":"原样保存","version":"any-string"}\n ';
  await first.write(BROWSER_SAVE_SLOT_ID, raw);
  const second = new BrowserSaveStoragePort(() => browser);
  assert.equal(await second.read(BROWSER_SAVE_SLOT_ID), raw);
  assert.equal(browser.values.get('unrelated'), 'keep');
  assert.deepEqual([...browser.values.keys()].sort(), [BROWSER_SAVE_STORAGE_KEY, 'unrelated'].sort());
  assert.deepEqual(browser.calls, [`read:${BROWSER_SAVE_STORAGE_KEY}`, `write:${BROWSER_SAVE_STORAGE_KEY}`, `read:${BROWSER_SAVE_STORAGE_KEY}`]);
  assert.equal(acquisitions, 2);
});

test('unsupported slots reject before browser access instead of creating additional saves', async () => {
  let acquisitions = 0;
  const port = new BrowserSaveStoragePort(() => { acquisitions++; return new ControlledBrowserStorage(); });
  for (const slot of ['', ' ', 'other', 'web_probe ', '../web_probe']) {
    await assert.rejects(port.read(slot), /ERR_SAVE_SLOT_ID_UNSUPPORTED/);
    await assert.rejects(port.write(slot, 'raw'), /ERR_SAVE_SLOT_ID_UNSUPPORTED/);
  }
  assert.equal(acquisitions, 0);
});

test('default localStorage getter is lazy, preserves its rejection, and can recover on the same adapter', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const browser = new ControlledBrowserStorage();
  const failure = new Error('browser getter refused');
  let blocked = true;
  let acquisitions = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() {
    acquisitions++;
    if (blocked) throw failure;
    return browser;
  } });
  try {
    const port = new BrowserSaveStoragePort();
    assert.equal(acquisitions, 0);
    await assert.rejects(port.read(BROWSER_SAVE_SLOT_ID), (error) => error === failure);
    await assert.rejects(port.write(BROWSER_SAVE_SLOT_ID, 'never-saved'), (error) => error === failure);
    assert.deepEqual(browser.calls, []);
    blocked = false;
    assert.equal(await port.read(BROWSER_SAVE_SLOT_ID), null, 'failed writes did not fall back to memory');
    await port.write(BROWSER_SAVE_SLOT_ID, 'healthy');
    assert.equal(await port.read(BROWSER_SAVE_SLOT_ID), 'healthy');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('new public hosts never touch storage at startup and manual load restores another host save', async (t) => {
  const browser = new ControlledBrowserStorage();
  let acquisitions = 0;
  const first = await publicProbe(new BrowserSaveStoragePort(() => { acquisitions++; return browser; }), 'first_build');
  t.after(() => first.lifetime.dispose());
  assert.equal(acquisitions, 0);
  assert.deepEqual(browser.calls, []);
  await first.interaction.execute(ADVANCE);
  assert.equal(first.lifetime.status().timeLabel, 'day 1 minute 420');
  assert.equal((await first.interaction.execute(SAVE))?.command_result.status, 'completed');
  const saved = browser.values.get(BROWSER_SAVE_STORAGE_KEY);
  assert.ok(saved);
  await first.interaction.execute(ADVANCE);
  assert.equal(first.lifetime.status().timeLabel, 'day 1 minute 480');
  const callsBeforeSecond = [...browser.calls];
  await first.lifetime.dispose();
  const second = await publicProbe(new BrowserSaveStoragePort(() => browser), 'different_build');
  t.after(() => second.lifetime.dispose());
  assert.deepEqual(browser.calls, callsBeforeSecond, 'a new session neither auto-loads nor overwrites the save');
  assert.equal(browser.values.get(BROWSER_SAVE_STORAGE_KEY), saved);
  assert.equal(second.lifetime.status().timeLabel, 'day 1 minute 360');
  assert.equal((await second.interaction.execute(LOAD))?.command_result.status, 'completed');
  assert.equal(second.lifetime.status().timeLabel, 'day 1 minute 420');
  assert.equal(second.interaction.status().operation.worldMinute, 420);
  assert.equal(browser.values.get(BROWSER_SAVE_STORAGE_KEY), saved, 'load does not rewrite the saved bytes');
  assert.deepEqual(first.errors, []);
  assert.deepEqual(second.errors, []);
});

// Capture through the public healthy save path; restore the fake's old bytes so diagnostics do not overwrite the recovery target.
async function captureCurrent(p: Awaited<ReturnType<typeof publicProbe>>, browser: ControlledBrowserStorage): Promise<string> {
  const previous = browser.values.get(BROWSER_SAVE_STORAGE_KEY);
  await p.session().save(BROWSER_SAVE_SLOT_ID);
  const serialized = browser.values.get(BROWSER_SAVE_STORAGE_KEY)!;
  if (previous === undefined) browser.values.delete(BROWSER_SAVE_STORAGE_KEY);
  else browser.values.set(BROWSER_SAVE_STORAGE_KEY, previous);
  return serialized;
}

for (const failureKind of ['getter', 'read', 'write'] as const) {
  test(`${failureKind} refusal reports current failure, retains full state and old save, then recovers`, async (t) => {
    const browser = new ControlledBrowserStorage();
    const failure = new Error(`browser ${failureKind} refused`);
    let getterError: Error | null = null;
    const p = await publicProbe(new BrowserSaveStoragePort(() => {
      if (getterError) throw getterError;
      return browser;
    }));
    t.after(() => p.lifetime.dispose());
    await p.interaction.execute(ADVANCE);
    await p.interaction.execute(SAVE);
    const saved = browser.values.get(BROWSER_SAVE_STORAGE_KEY)!;
    await p.interaction.execute(ADVANCE);
    const beforeView = p.session().getViewModel();
    const beforeSelectable = p.session().getSelectableViewModel();
    const beforeState = await captureCurrent(p, browser);
    if (failureKind === 'getter') getterError = failure;
    if (failureKind === 'read') browser.readError = failure;
    if (failureKind === 'write') browser.writeError = failure;
    const result = await p.interaction.execute(failureKind === 'write' ? SAVE : LOAD);
    assert.equal(result?.command_result.status, 'failed');
    assert.equal(result.command_result.error_message, failure.message);
    assert.equal(p.interaction.status().operation.status, 'failed');
    assert.equal(p.interaction.status().operation.worldMinute, null);
    assert.equal(p.interaction.status().operation.errorMessage, failure.message);
    assert.equal(p.lifetime.status().phase, 'ready');
    assert.deepEqual(p.session().getViewModel(), beforeView);
    assert.deepEqual(p.session().getSelectableViewModel(), beforeSelectable);
    assert.equal(browser.values.get(BROWSER_SAVE_STORAGE_KEY), saved);
    getterError = null;
    browser.readError = null;
    browser.writeError = null;
    assert.equal(await captureCurrent(p, browser), beforeState);
    assert.equal(browser.values.get(BROWSER_SAVE_STORAGE_KEY), saved);
    const recovered = await p.interaction.execute(failureKind === 'write' ? SAVE : LOAD);
    assert.equal(recovered?.command_result.status, 'completed');
    assert.equal(p.interaction.status().operation.errorMessage, null);
    if (failureKind === 'write') {
      assert.equal(browser.values.get(BROWSER_SAVE_STORAGE_KEY), beforeState);
      assert.deepEqual(p.session().getViewModel(), beforeView);
    } else {
      assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 420');
      assert.equal(browser.values.get(BROWSER_SAVE_STORAGE_KEY), saved);
    }
    assert.deepEqual(p.errors, [], 'storage failure is operation feedback, not startup failure');
  });
}

test('empty browser slot fails without changing state and later manual save/load succeeds', async (t) => {
  const browser = new ControlledBrowserStorage();
  const p = await publicProbe(new BrowserSaveStoragePort(() => browser));
  t.after(() => p.lifetime.dispose());
  const before = await captureCurrent(p, browser);
  assert.equal((await p.interaction.execute(LOAD))?.command_result.status, 'failed');
  assert.equal(p.interaction.status().operation.errorMessage, 'ERR_SAVE_SLOT_NOT_FOUND:web_probe');
  assert.equal(p.lifetime.status().phase, 'ready');
  assert.equal(await captureCurrent(p, browser), before);
  assert.equal(browser.values.has(BROWSER_SAVE_STORAGE_KEY), false);
  assert.equal((await p.interaction.execute(SAVE))?.command_result.status, 'completed');
  await p.interaction.execute(ADVANCE);
  assert.equal((await p.interaction.execute(LOAD))?.command_result.status, 'completed');
  assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 360');
});

for (const malformed of ['json', 'schema', 'audit'] as const) {
  test(`${malformed} invalid save is preserved after rejection while current full state survives and healthy load recovers`, async (t) => {
    const browser = new ControlledBrowserStorage();
    const p = await publicProbe(new BrowserSaveStoragePort(() => browser));
    t.after(() => p.lifetime.dispose());
    await p.interaction.execute(ADVANCE);
    await p.interaction.execute(SAVE);
    const healthy = browser.values.get(BROWSER_SAVE_STORAGE_KEY)!;
    await p.interaction.execute(ADVANCE);
    const beforeView = p.session().getViewModel();
    const beforeSelectable = p.session().getSelectableViewModel();
    const beforeState = await captureCurrent(p, browser);
    let bad = '{not JSON';
    if (malformed === 'schema') bad = JSON.stringify({ invalid: true });
    if (malformed === 'audit') {
      const candidate = JSON.parse(healthy);
      candidate.storage_containers[0].used_capacity += 1;
      bad = JSON.stringify(candidate);
    }
    browser.values.set(BROWSER_SAVE_STORAGE_KEY, bad);
    assert.equal((await p.interaction.execute(LOAD))?.command_result.status, 'failed');
    assert.match(p.interaction.status().operation.errorMessage ?? '', /ERR_COCOS_SESSION_LOAD_REJECTED/);
    if (malformed === 'audit') assert.match(p.interaction.status().operation.errorMessage ?? '', /ERR_STORAGE_AUDIT_FAILED/);
    assert.equal(p.interaction.status().operation.worldMinute, null);
    assert.equal(p.lifetime.status().phase, 'ready');
    assert.deepEqual(p.session().getViewModel(), beforeView);
    assert.deepEqual(p.session().getSelectableViewModel(), beforeSelectable);
    assert.equal(browser.values.get(BROWSER_SAVE_STORAGE_KEY), bad);
    assert.equal(await captureCurrent(p, browser), beforeState);
    assert.equal(browser.values.get(BROWSER_SAVE_STORAGE_KEY), bad);
    browser.values.set(BROWSER_SAVE_STORAGE_KEY, healthy);
    assert.equal((await p.interaction.execute(LOAD))?.command_result.status, 'completed');
    assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 420');
    assert.equal(browser.values.get(BROWSER_SAVE_STORAGE_KEY), healthy);
    assert.deepEqual(p.errors, []);
  });
}
