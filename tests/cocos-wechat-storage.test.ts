import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot } from '../src/game-core';
import { createWechatPriorSaveValidator } from '../apps/cocos-wechat-probe/template/assets/scripts/WechatPriorSaveValidator';
import { WechatSaveStoragePort as RealWechatSaveStoragePort, WECHAT_SAVE_SLOT_ID, WECHAT_BACKUP_SLOT_ID, WECHAT_SAVE_STORAGE_KEY, WECHAT_SAVE_BACKUP_KEY, WECHAT_SAVE_TRANSACTION_KEY,
  type WechatPlatformStorage } from '../apps/cocos-wechat-probe/template/assets/scripts/WechatSaveStoragePort';

class WechatSaveStoragePort extends RealWechatSaveStoragePort {
  constructor(storage: () => WechatPlatformStorage, validatePrior: (serialized: string) => Promise<void> = async () => {}) {
    super(storage, validatePrior);
  }
}

class FakeStorage implements WechatPlatformStorage {
  readonly values = new Map<string, unknown>();
  errorAt: 'length' | 'key' | 'get' | 'set' | null = null;
  noWriteKey: string | null = null;
  partialWriteKey: string | null = null;
  failReadAfterWriteKey: string | null = null;
  throwBeforeWriteKey: string | null = null;
  throwAfterWriteKey: string | null = null;
  removeFailure: 'before' | 'after' | 'noop' | null = null;
  removeFailureKey: string | null = null;
  failLengthAfterRemoveKey: string | null = null;
  readonly removals: string[] = [];
  readonly writes: string[] = [];
  private fail(where: typeof this.errorAt): void {
    if (this.errorAt === where) throw new Error(`refused:${where}`);
  }
  get length(): number { this.fail('length'); return this.values.size; }
  key(index: number): string | null { this.fail('key'); return [...this.values.keys()][index] ?? null; }
  getItem(key: string): unknown { this.fail('get'); return this.values.get(key); }
  setItem(key: string, value: string): void {
    this.fail('set');
    this.writes.push(key);
    if (this.throwBeforeWriteKey === key) throw new Error('write refused');
    if (this.partialWriteKey === key) { this.values.set(key, value.slice(0, 2)); throw new Error('partial write'); }
    if (this.noWriteKey !== key) this.values.set(key, value);
    if (this.throwAfterWriteKey === key) throw new Error('written then refused');
    if (this.failReadAfterWriteKey === key) this.errorAt = 'get';
  }
  removeItem(key: string): void {
    this.removals.push(key);
    const failure = this.removeFailureKey === null || this.removeFailureKey === key ? this.removeFailure : null;
    if (failure === 'before') throw new Error('remove refused');
    if (failure !== 'noop') this.values.delete(key);
    if (this.failLengthAfterRemoveKey === key) this.errorAt = 'length';
    if (failure === 'after') throw new Error('removed then refused');
  }
}

test('storage is lazy, stable single slot keeps exact strings and unrelated keys across instances', async () => {
  const storage = new FakeStorage();
  storage.values.set('unrelated', 'keep');
  let acquired = 0;
  const first = new WechatSaveStoragePort(() => { acquired++; return storage; });
  assert.equal(acquired, 0);
  assert.equal(WECHAT_SAVE_SLOT_ID, 'wechat_probe');
  assert.equal(WECHAT_SAVE_STORAGE_KEY, 'qinglan.simulation-game.cocos-wechat-probe.save.wechat_probe');
  assert.equal(WECHAT_SAVE_BACKUP_KEY, 'qinglan.simulation-game.cocos-wechat-probe.save.wechat_probe.backup');
  assert.equal(await first.read(WECHAT_SAVE_SLOT_ID), null);
  const bytes = ' \n{"text":"原样保存"}\n ';
  await first.write(WECHAT_SAVE_SLOT_ID, bytes);
  assert.equal(await new WechatSaveStoragePort(() => storage).read(WECHAT_SAVE_SLOT_ID), bytes);
  assert.equal(storage.values.get('unrelated'), 'keep');
  assert.equal(await new WechatSaveStoragePort(() => storage).readBackup(WECHAT_SAVE_SLOT_ID), null);
  assert.equal(acquired, 2);
});

test('present empty or malformed string is passed through, absent and non-string stay distinct', async () => {
  const storage = new FakeStorage();
  const port = new WechatSaveStoragePort(() => storage);
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), null);
  for (const value of ['', '{invalid JSON']) {
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, value);
    assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), value);
  }
  for (const value of [null, undefined, 0, {}, false]) {
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, value);
    await assert.rejects(port.read(WECHAT_SAVE_SLOT_ID), /ERR_WECHAT_SAVE_NOT_STRING/);
    await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'replacement'), /ERR_WECHAT_SAVE_NOT_STRING/);
    assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), value);
  }
});

test('unsupported slot and non-string input reject before storage access', async () => {
  let calls = 0;
  const port = new WechatSaveStoragePort(() => { calls++; return new FakeStorage(); });
  for (const slot of ['', ' ', 'web_probe', 'wechat_probe ', '../wechat_probe']) {
    await assert.rejects(port.read(slot), /ERR_SAVE_SLOT_ID_UNSUPPORTED/);
    await assert.rejects(port.readBackup(slot), /ERR_SAVE_SLOT_ID_UNSUPPORTED/);
    await assert.rejects(port.write(slot, 'value'), /ERR_SAVE_SLOT_ID_UNSUPPORTED/);
  }
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 0 as unknown as string), /ERR_WECHAT_SAVE_NOT_STRING/);
  await assert.rejects(port.write(WECHAT_BACKUP_SLOT_ID, 'not allowed'), /ERR_SAVE_SLOT_ID_UNSUPPORTED/);
  assert.equal(calls, 0);
});

test('successive saves retain the previous main value as a read-only backup', async () => {
  const storage = new FakeStorage();
  storage.values.set('unrelated', 'keep');
  const port = new WechatSaveStoragePort(() => storage);
  await port.write(WECHAT_SAVE_SLOT_ID, 'first');
  assert.deepEqual(storage.writes, [WECHAT_SAVE_TRANSACTION_KEY, WECHAT_SAVE_STORAGE_KEY]);
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), null);
  await port.write(WECHAT_SAVE_SLOT_ID, 'second');
  assert.deepEqual(storage.writes, [WECHAT_SAVE_TRANSACTION_KEY, WECHAT_SAVE_STORAGE_KEY,
    WECHAT_SAVE_BACKUP_KEY, WECHAT_SAVE_TRANSACTION_KEY, WECHAT_SAVE_STORAGE_KEY]);
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), 'second');
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'first');
  await port.write(WECHAT_SAVE_SLOT_ID, 'third');
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'second');
  assert.equal(storage.values.get('unrelated'), 'keep');
  await assert.rejects(port.write(WECHAT_BACKUP_SLOT_ID, 'replace'), /ERR_SAVE_SLOT_ID_UNSUPPORTED/);
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'second');
});

test('backup partial-write and verification failures leave main untouched', async () => {
  for (const failure of ['partial', 'noop', 'readback'] as const) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'old-main');
    const port = new WechatSaveStoragePort(() => storage);
    if (failure === 'partial') storage.partialWriteKey = WECHAT_SAVE_BACKUP_KEY;
    if (failure === 'noop') storage.noWriteKey = WECHAT_SAVE_BACKUP_KEY;
    if (failure === 'readback') storage.failReadAfterWriteKey = WECHAT_SAVE_BACKUP_KEY;
    await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new-main'));
    assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'old-main');
    assert.equal(storage.writes.includes(WECHAT_SAVE_STORAGE_KEY), false);
  }
});

test('main partial-write and readback failures leave the verified backup readable after a new port', async () => {
  for (const failure of ['partial', 'readback'] as const) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'original');
    storage.values.set('unrelated', 'keep');
    const first = new WechatSaveStoragePort(() => storage);
    if (failure === 'partial') storage.partialWriteKey = WECHAT_SAVE_STORAGE_KEY;
    if (failure === 'readback') storage.failReadAfterWriteKey = WECHAT_SAVE_STORAGE_KEY;
    await assert.rejects(first.write(WECHAT_SAVE_SLOT_ID, 'replacement'));
    assert.deepEqual(storage.writes, [WECHAT_SAVE_BACKUP_KEY, WECHAT_SAVE_TRANSACTION_KEY, WECHAT_SAVE_STORAGE_KEY]);
    storage.errorAt = null;
    const restarted = new WechatSaveStoragePort(() => storage);
    await assert.rejects(restarted.read(WECHAT_SAVE_SLOT_ID), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
    assert.equal(await restarted.read(WECHAT_BACKUP_SLOT_ID), 'original');
    assert.equal(await restarted.readBackup(WECHAT_SAVE_SLOT_ID), 'original');
    await assert.rejects(restarted.write(WECHAT_SAVE_SLOT_ID, 'retry'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
    assert.equal(await restarted.read(WECHAT_BACKUP_SLOT_ID), 'original');
    assert.equal(storage.values.get('unrelated'), 'keep');
  }
});

test('explicit recovery requires pending marker and unchanged backup, then restores and clears marker', async () => {
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'broken');
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'valid-old');
  storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-with-prior/v1');
  const port = new WechatSaveStoragePort(() => storage);
  const validatedBytes = await port.read(WECHAT_BACKUP_SLOT_ID);
  assert.equal(validatedBytes, 'valid-old');
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'changed');
  await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(), /ERR_WECHAT_SAVE_BACKUP_CHANGED/);
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'broken');
  assert.equal(storage.values.get(WECHAT_SAVE_TRANSACTION_KEY), 'wechat-save-with-prior/v1');
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, validatedBytes);
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), validatedBytes);
  await port.finishBackupRecoveryAfterValidatedRead();
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), 'valid-old');
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'valid-old');
  assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), validatedBytes);
  await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(), /ERR_WECHAT_SAVE_RECOVERY_NOT_PENDING/);
});

test('recovery retains marker and backup on failed main write; failed marker removal reports uncertainty', async () => {
  for (const failure of ['partial-main', 'readback-main', 'clear-before', 'clear-noop', 'clear-after'] as const) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'broken');
    storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'old-valid');
    storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-with-prior/v1');
    if (failure === 'partial-main') storage.partialWriteKey = WECHAT_SAVE_STORAGE_KEY;
    if (failure === 'readback-main') storage.failReadAfterWriteKey = WECHAT_SAVE_STORAGE_KEY;
    if (failure.startsWith('clear-')) storage.removeFailure = failure.slice(6) as 'before' | 'noop' | 'after';
    const port = new WechatSaveStoragePort(() => storage);
    assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'old-valid');
    await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(), failure.startsWith('clear-') ? /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/ : undefined);
    storage.errorAt = null;
    assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'old-valid');
    if (failure !== 'clear-after') {
      await assert.rejects(port.read(WECHAT_SAVE_SLOT_ID), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
      await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'retry'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
    } else {
      assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false, 'removal can succeed before it throws');
    }
  }
});

test('interrupted first save with no backup fails recovery without changing evidence', async () => {
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'partial');
  storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-with-prior/v1');
  const port = new WechatSaveStoragePort(() => storage);
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), null);
  await assert.rejects(port.assertBackupRecoveryAvailable(), /ERR_WECHAT_SAVE_BACKUP_MISSING/);
  await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(), /ERR_WECHAT_SAVE_BACKUP_READ_REQUIRED/);
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'partial');
  assert.equal(storage.values.get(WECHAT_SAVE_TRANSACTION_KEY), 'wechat-save-with-prior/v1');
  assert.deepEqual(storage.writes, []);
});

test('interrupted first write requires explicit cancel after restart before later save', async () => {
  const storage = new FakeStorage();
  storage.partialWriteKey = WECHAT_SAVE_STORAGE_KEY;
  const first = new WechatSaveStoragePort(() => storage);
  await assert.rejects(first.write(WECHAT_SAVE_SLOT_ID, 'first-save'), /partial write/);
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'fi');
  assert.equal(storage.values.get(WECHAT_SAVE_TRANSACTION_KEY), 'wechat-save-first/v1');
  assert.equal(storage.values.has(WECHAT_SAVE_BACKUP_KEY), false);
  const restarted = new WechatSaveStoragePort(() => storage);
  await assert.rejects(restarted.read(WECHAT_SAVE_SLOT_ID), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
  await assert.rejects(restarted.write(WECHAT_SAVE_SLOT_ID, 'retry'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
  await restarted.assertFirstFailedSaveCancelable();
  storage.partialWriteKey = null;
  await restarted.cancelFirstFailedSave();
  assert.equal(storage.values.has(WECHAT_SAVE_STORAGE_KEY), false);
  assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
  await restarted.write(WECHAT_SAVE_SLOT_ID, 'healthy');
  assert.equal(await restarted.read(WECHAT_SAVE_SLOT_ID), 'healthy');
});

test('first-save cancellation rejects unknown or malformed marker and any existing backup', async () => {
  for (const marker of [null, '', 'wechat-save-with-prior/v1', 'wechat-save-first/', 'pending', 0]) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'partial');
    if (marker !== null) storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, marker);
    const before = [...storage.values.entries()];
    const port = new WechatSaveStoragePort(() => storage);
    await assert.rejects(port.assertFirstFailedSaveCancelable());
    await assert.rejects(port.cancelFirstFailedSave());
    assert.deepEqual([...storage.values.entries()], before);
    assert.deepEqual(storage.removals, []);
  }
  for (const backup of ['', 'valid-backup', 0]) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'partial');
    storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
    storage.values.set(WECHAT_SAVE_BACKUP_KEY, backup);
    const before = [...storage.values.entries()];
    const port = new WechatSaveStoragePort(() => storage);
    await assert.rejects(port.assertFirstFailedSaveCancelable());
    await assert.rejects(port.cancelFirstFailedSave());
    assert.deepEqual([...storage.values.entries()], before);
    assert.deepEqual(storage.removals, []);
  }
});

test('first-save cancellation fails closed on delete or verification failures', async () => {
  for (const failure of ['main-before', 'main-noop', 'main-after', 'main-readback', 'marker-before', 'marker-noop', 'marker-after'] as const) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'partial');
    storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
    if (failure === 'main-readback') storage.failLengthAfterRemoveKey = WECHAT_SAVE_STORAGE_KEY;
    else {
      const [target, mode] = failure.split('-');
      storage.removeFailureKey = target === 'main' ? WECHAT_SAVE_STORAGE_KEY : WECHAT_SAVE_TRANSACTION_KEY;
      storage.removeFailure = mode as 'before' | 'noop' | 'after';
    }
    const port = new WechatSaveStoragePort(() => storage);
    await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
    storage.errorAt = null;
    await assert.rejects(port.read(WECHAT_SAVE_SLOT_ID), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
    await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'retry'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
    if (failure !== 'marker-after') assert.equal(storage.values.get(WECHAT_SAVE_TRANSACTION_KEY), 'wechat-save-first/v1');
    else assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false, 'platform may delete marker before throwing');
    if (failure === 'main-before' || failure === 'main-noop') assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'partial');
    else assert.equal(storage.values.has(WECHAT_SAVE_STORAGE_KEY), false, 'main deletion may have succeeded before failure');
  }
});

test('after verified first-save deletion and marker removal throws, only same instance can explicitly recheck and unlock', async () => {
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'partial');
  storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
  storage.values.set('unrelated', 'keep');
  storage.removeFailure = 'after';
  storage.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
  const port = new WechatSaveStoragePort(() => storage);
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  assert.equal(storage.values.has(WECHAT_SAVE_STORAGE_KEY), false);
  assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
  const restarted = new WechatSaveStoragePort(() => storage);
  await assert.rejects(restarted.assertFirstFailedSaveCancelable(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  await assert.rejects(restarted.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  await port.assertFirstFailedSaveCancelable();
  await port.cancelFirstFailedSave();
  storage.removeFailure = null;
  await port.write(WECHAT_SAVE_SLOT_ID, 'new');
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), 'new');
  assert.equal(storage.values.get('unrelated'), 'keep');
});

test('uncertain first-cancel retry stays locked when main, backup, marker or storage access changes', async () => {
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'partial');
  storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
  storage.removeFailure = 'after';
  storage.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
  const port = new WechatSaveStoragePort(() => storage);
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  for (const key of [WECHAT_SAVE_STORAGE_KEY, WECHAT_SAVE_BACKUP_KEY, WECHAT_SAVE_TRANSACTION_KEY]) {
    storage.values.set(key, 'unexpected');
    await assert.rejects(port.assertFirstFailedSaveCancelable());
    await assert.rejects(port.cancelFirstFailedSave());
    await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
    assert.equal(storage.values.get(key), 'unexpected');
    storage.values.delete(key);
  }
  storage.errorAt = 'length';
  await assert.rejects(port.assertFirstFailedSaveCancelable(), /refused:length/);
  await assert.rejects(port.cancelFirstFailedSave(), /refused:length/);
  storage.errorAt = null;
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
  await port.cancelFirstFailedSave();
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), null);
});

test('uncertain first-cancel retry may reattempt removal when first marker still exists', async () => {
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'partial');
  storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
  storage.removeFailure = 'noop';
  storage.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
  const port = new WechatSaveStoragePort(() => storage);
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  await port.assertFirstFailedSaveCancelable();
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
  storage.removeFailure = null;
  await port.cancelFirstFailedSave();
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), null);
});

test('uncertain first save whose marker vanished can be explicitly cancelled by the same witnessed instance', async () => {
  const storage = new FakeStorage();
  storage.removeFailure = 'after';
  storage.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
  const port = new WechatSaveStoragePort(() => storage);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'first-verified'), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'first-verified');
  assert.equal(storage.values.has(WECHAT_SAVE_BACKUP_KEY), false);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'retry'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
  const restarted = new WechatSaveStoragePort(() => storage);
  await assert.rejects(restarted.assertFirstFailedSaveCancelable(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  await assert.rejects(restarted.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  await port.assertFirstFailedSaveCancelable();
  storage.removeFailure = null;
  const oldWrites = storage.writes.length;
  await port.cancelFirstFailedSave();
  assert.deepEqual(storage.writes.slice(oldWrites), [WECHAT_SAVE_TRANSACTION_KEY]);
  assert.equal(storage.values.has(WECHAT_SAVE_STORAGE_KEY), false);
  assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
  await port.write(WECHAT_SAVE_SLOT_ID, 'healthy-new');
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), 'healthy-new');
  await assert.rejects(port.assertFirstFailedSaveCancelable(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
});

test('first-save witness rejects changed main, backup, marker, provider identity and read failures', async () => {
  const storage = new FakeStorage();
  let current = storage;
  storage.removeFailure = 'after';
  storage.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
  const port = new WechatSaveStoragePort(() => current);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'verified'), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  storage.removeFailure = null;
  const beforeWrites = storage.writes.length;
  for (const key of [WECHAT_SAVE_STORAGE_KEY, WECHAT_SAVE_BACKUP_KEY, WECHAT_SAVE_TRANSACTION_KEY]) {
    const old = storage.values.get(key);
    storage.values.set(key, 'changed');
    await assert.rejects(port.assertFirstFailedSaveCancelable());
    await assert.rejects(port.cancelFirstFailedSave());
    assert.equal(storage.writes.length, beforeWrites);
    assert.equal(storage.values.get(key), 'changed');
    if (old === undefined) storage.values.delete(key); else storage.values.set(key, old);
  }
  current = new FakeStorage();
  current.values.set(WECHAT_SAVE_STORAGE_KEY, 'verified');
  await assert.rejects(port.assertFirstFailedSaveCancelable(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  assert.deepEqual(current.writes, []);
  current = storage;
  storage.errorAt = 'length';
  await assert.rejects(port.assertFirstFailedSaveCancelable(), /refused:length/);
  await assert.rejects(port.cancelFirstFailedSave(), /refused:length/);
  storage.errorAt = null;
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'retry'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'verified');
});

test('failed first-save witness marker restoration never deletes the main save', async () => {
  for (const failure of ['partial', 'noop', 'before', 'after'] as const) {
    const storage = new FakeStorage();
    storage.removeFailure = 'after';
    storage.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
    const port = new WechatSaveStoragePort(() => storage);
    await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'verified'), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
    storage.removeFailure = null;
    if (failure === 'partial') storage.partialWriteKey = WECHAT_SAVE_TRANSACTION_KEY;
    if (failure === 'noop') storage.noWriteKey = WECHAT_SAVE_TRANSACTION_KEY;
    if (failure === 'before') storage.throwBeforeWriteKey = WECHAT_SAVE_TRANSACTION_KEY;
    if (failure === 'after') storage.throwAfterWriteKey = WECHAT_SAVE_TRANSACTION_KEY;
    const mainRemovals = storage.removals.filter(key => key === WECHAT_SAVE_STORAGE_KEY).length;
    await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
    assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'verified');
    assert.equal(storage.removals.filter(key => key === WECHAT_SAVE_STORAGE_KEY).length, mainRemovals);
    await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'retry'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
  }
});

test('first-save witness supports explicit retry after main deletion succeeded before throwing', async () => {
  const storage = new FakeStorage();
  storage.removeFailure = 'after';
  storage.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
  const port = new WechatSaveStoragePort(() => storage);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'verified'), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  storage.removeFailureKey = WECHAT_SAVE_STORAGE_KEY;
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  assert.equal(storage.values.has(WECHAT_SAVE_STORAGE_KEY), false);
  assert.equal(storage.values.get(WECHAT_SAVE_TRANSACTION_KEY), 'wechat-save-first/v1');
  storage.removeFailure = null;
  await port.assertFirstFailedSaveCancelable();
  await port.cancelFirstFailedSave();
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), null);
});

test('first-save witness retry after deletion refusal rejects a changed provider or changed primary', async () => {
  const original = new FakeStorage();
  let current = original;
  original.removeFailure = 'after';
  original.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
  const port = new WechatSaveStoragePort(() => current);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'verified'), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  original.removeFailure = 'before';
  original.removeFailureKey = WECHAT_SAVE_STORAGE_KEY;
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  assert.equal(original.values.get(WECHAT_SAVE_STORAGE_KEY), 'verified');
  assert.equal(original.values.get(WECHAT_SAVE_TRANSACTION_KEY), 'wechat-save-first/v1');
  const foreign = new FakeStorage();
  foreign.values.set(WECHAT_SAVE_STORAGE_KEY, 'verified');
  foreign.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
  current = foreign;
  await assert.rejects(port.assertFirstFailedSaveCancelable(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  assert.equal(foreign.values.get(WECHAT_SAVE_STORAGE_KEY), 'verified');
  assert.deepEqual(foreign.removals, []);
  current = original;
  original.values.set(WECHAT_SAVE_STORAGE_KEY, 'foreign-change');
  const count = original.removals.length;
  await assert.rejects(port.assertFirstFailedSaveCancelable(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  assert.equal(original.values.get(WECHAT_SAVE_STORAGE_KEY), 'foreign-change');
  assert.equal(original.removals.length, count);
  original.values.set(WECHAT_SAVE_STORAGE_KEY, 'verified');
  original.removeFailure = null;
  await port.cancelFirstFailedSave();
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), null);
});

test('first-save witness retry after deletion occurred still binds provider and rejects a new primary', async () => {
  const original = new FakeStorage();
  let current = original;
  original.removeFailure = 'after';
  original.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
  const port = new WechatSaveStoragePort(() => current);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'verified'), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  original.removeFailureKey = WECHAT_SAVE_STORAGE_KEY;
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  assert.equal(original.values.has(WECHAT_SAVE_STORAGE_KEY), false);
  const foreign = new FakeStorage();
  foreign.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
  current = foreign;
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  assert.equal(foreign.values.get(WECHAT_SAVE_TRANSACTION_KEY), 'wechat-save-first/v1');
  assert.deepEqual(foreign.removals, []);
  current = original;
  original.values.set(WECHAT_SAVE_STORAGE_KEY, 'new-foreign-value');
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  assert.equal(original.values.get(WECHAT_SAVE_STORAGE_KEY), 'new-foreign-value');
  original.values.delete(WECHAT_SAVE_STORAGE_KEY);
  original.removeFailure = null;
  await port.cancelFirstFailedSave();
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), null);
});

test('verified deletion retry without a first-save witness binds its original storage object', async () => {
  const original = new FakeStorage();
  original.values.set(WECHAT_SAVE_STORAGE_KEY, 'partial');
  original.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
  original.removeFailure = 'after';
  original.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
  let current = original;
  const port = new WechatSaveStoragePort(() => current);
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  assert.equal(original.values.has(WECHAT_SAVE_STORAGE_KEY), false);
  assert.equal(original.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
  const foreign = new FakeStorage();
  foreign.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
  current = foreign;
  await assert.rejects(port.assertFirstFailedSaveCancelable(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  assert.equal(foreign.values.get(WECHAT_SAVE_TRANSACTION_KEY), 'wechat-save-first/v1');
  assert.deepEqual(foreign.removals, []);
  current = original;
  await port.assertFirstFailedSaveCancelable();
  await port.cancelFirstFailedSave();
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), null);
});

test('partial first save followed by deletion refusal binds retry to original storage and captured bytes', async () => {
  const original = new FakeStorage();
  let current = original;
  const port = new WechatSaveStoragePort(() => current);
  original.partialWriteKey = WECHAT_SAVE_STORAGE_KEY;
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'first-save'), /partial write/);
  assert.equal(original.values.get(WECHAT_SAVE_STORAGE_KEY), 'fi');
  original.partialWriteKey = null;
  original.removeFailure = 'before';
  original.removeFailureKey = WECHAT_SAVE_STORAGE_KEY;
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  const foreign = new FakeStorage();
  foreign.values.set(WECHAT_SAVE_STORAGE_KEY, 'fi');
  foreign.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
  current = foreign;
  await assert.rejects(port.assertFirstFailedSaveCancelable(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  assert.equal(foreign.values.get(WECHAT_SAVE_STORAGE_KEY), 'fi');
  assert.deepEqual(foreign.removals, []);
  current = original;
  original.values.set(WECHAT_SAVE_STORAGE_KEY, 'foreign-data');
  const previousRemovals = original.removals.length;
  await assert.rejects(port.assertFirstFailedSaveCancelable(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  assert.equal(original.values.get(WECHAT_SAVE_STORAGE_KEY), 'foreign-data');
  assert.equal(original.removals.length, previousRemovals);
  original.values.set(WECHAT_SAVE_STORAGE_KEY, 'fi');
  original.removeFailure = null;
  await port.cancelFirstFailedSave();
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), null);
});

test('partial first save retry after deletion occurred still rejects provider or primary changes', async () => {
  const original = new FakeStorage();
  let current = original;
  const port = new WechatSaveStoragePort(() => current);
  original.partialWriteKey = WECHAT_SAVE_STORAGE_KEY;
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'first-save'), /partial write/);
  original.partialWriteKey = null;
  original.removeFailure = 'after';
  original.removeFailureKey = WECHAT_SAVE_STORAGE_KEY;
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  assert.equal(original.values.has(WECHAT_SAVE_STORAGE_KEY), false);
  const foreign = new FakeStorage();
  foreign.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
  current = foreign;
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  assert.equal(foreign.values.get(WECHAT_SAVE_TRANSACTION_KEY), 'wechat-save-first/v1');
  assert.deepEqual(foreign.removals, []);
  current = original;
  original.values.set(WECHAT_SAVE_STORAGE_KEY, 'unexpected');
  await assert.rejects(port.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  assert.equal(original.values.get(WECHAT_SAVE_STORAGE_KEY), 'unexpected');
  original.values.delete(WECHAT_SAVE_STORAGE_KEY);
  original.removeFailure = null;
  await port.cancelFirstFailedSave();
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), null);
});

test('new instance uses only the persisted exact first marker, not another instance cancellation witness', async () => {
  const storage = new FakeStorage();
  const first = new WechatSaveStoragePort(() => storage);
  storage.partialWriteKey = WECHAT_SAVE_STORAGE_KEY;
  await assert.rejects(first.write(WECHAT_SAVE_SLOT_ID, 'first-save'), /partial write/);
  storage.partialWriteKey = null;
  storage.removeFailure = 'before';
  storage.removeFailureKey = WECHAT_SAVE_STORAGE_KEY;
  await assert.rejects(first.cancelFirstFailedSave(), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  const restarted = new WechatSaveStoragePort(() => storage);
  storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'unknown');
  await assert.rejects(restarted.assertFirstFailedSaveCancelable(), /ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED/);
  storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-first/v1');
  await restarted.assertFirstFailedSaveCancelable();
  storage.removeFailure = null;
  await restarted.cancelFirstFailedSave();
  assert.equal(await restarted.read(WECHAT_SAVE_SLOT_ID), null);
});

test('missing main with an existing backup rejects a fresh save without overwriting the backup', async () => {
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'older-backup');
  const port = new WechatSaveStoragePort(() => storage);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new'), /ERR_WECHAT_SAVE_BACKUP_CONFLICT/);
  assert.equal(storage.values.has(WECHAT_SAVE_STORAGE_KEY), false);
  assert.equal(storage.values.get(WECHAT_SAVE_BACKUP_KEY), 'older-backup');
  assert.deepEqual(storage.writes, []);
});

test('existing primary must pass prior validation before any physical key is changed', async () => {
  for (const prior of ['{bad JSON', '{"bad":"schema"}', '{"bad":"audit"}']) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, prior);
    storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'healthy-old-backup');
    storage.values.set('unrelated', 'keep');
    const before = [...storage.values.entries()];
    let validated = '';
    const port = new WechatSaveStoragePort(() => storage, async (serialized) => {
      validated = serialized;
      throw new Error('prior rejected');
    });
    await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new'), /prior rejected/);
    assert.equal(validated, prior);
    assert.deepEqual([...storage.values.entries()], before);
    assert.deepEqual(storage.writes, []);
  }
});

test('production validator uses a separate public host and rejects JSON, Schema and Audit errors before any write', async () => {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  const schemas = Object.fromEntries(snapshot.schema_paths.map(path => [path, JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))]));
  const memory = new InMemorySaveStoragePort();
  const donor = createStage1AHost({ snapshot, schemas, buildId: 'prior_validation_test',
    nowIso8601: '2026-11-04T00:00:00.000Z', storage: memory });
  let healthy: string;
  try {
    await donor.requireSession().save('donor');
    const saved = await memory.read('donor');
    assert.notEqual(saved, null);
    healthy = saved!;
  } finally {
    donor.destroySession();
  }
  const hosts: CocosSessionHost[] = [];
  const validate = createWechatPriorSaveValidator(storage => {
    const host = createStage1AHost({ snapshot, schemas, buildId: 'prior_validation_test',
      nowIso8601: '2026-11-04T00:00:00.000Z', storage });
    hosts.push(host);
    return host;
  });
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, healthy);
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'previous-backup');
  storage.values.set('unrelated', 'keep');
  const port = new WechatSaveStoragePort(() => storage, validate);
  await port.write(WECHAT_SAVE_SLOT_ID, healthy + '\n');
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), healthy + '\n');
  assert.equal(storage.values.get(WECHAT_SAVE_BACKUP_KEY), healthy);
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].hasSession(), false);
  const auditBad = JSON.parse(healthy);
  auditBad.storage_containers[0].used_capacity += 1;
  for (const [bad, pattern] of [
    ['{bad JSON', /ERR_COCOS_SESSION_LOAD_REJECTED/],
    [JSON.stringify({ invalid: true }), /ERR_COCOS_SESSION_LOAD_REJECTED/],
    [JSON.stringify(auditBad), /ERR_STORAGE_AUDIT_FAILED/]
  ] as const) {
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, bad);
    storage.values.set(WECHAT_SAVE_BACKUP_KEY, healthy);
    const before = [...storage.values.entries()];
    const writeCount = storage.writes.length;
    await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, healthy), pattern);
    assert.deepEqual([...storage.values.entries()], before);
    assert.equal(storage.writes.length, writeCount);
    assert.equal(hosts.at(-1)?.hasSession(), false);
  }
  assert.equal(hosts.length, 4);
  assert.equal(storage.values.get('unrelated'), 'keep');
});

test('production recovery validates backup even when caller read it directly and never touched the Session', async () => {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  const schemas = Object.fromEntries(snapshot.schema_paths.map(path => [path, JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))]));
  const memory = new InMemorySaveStoragePort();
  const options = { snapshot, schemas, buildId: 'recovery_validation_test', nowIso8601: '2026-11-04T00:00:00.000Z' };
  const donor = createStage1AHost({ ...options, storage: memory });
  let healthy: string;
  try {
    await donor.requireSession().save('donor');
    const saved = await memory.read('donor');
    assert.notEqual(saved, null);
    healthy = saved!;
  } finally { donor.destroySession(); }
  const auditBad = JSON.parse(healthy);
  auditBad.storage_containers[0].used_capacity += 1;
  const hosts: CocosSessionHost[] = [];
  const validate = createWechatPriorSaveValidator(storage => {
    const host = createStage1AHost({ ...options, storage });
    hosts.push(host);
    return host;
  });
  for (const [bad, pattern] of [
    ['{bad JSON', /ERR_COCOS_SESSION_LOAD_REJECTED/],
    [JSON.stringify({ invalid: true }), /ERR_COCOS_SESSION_LOAD_REJECTED/],
    [JSON.stringify(auditBad), /ERR_STORAGE_AUDIT_FAILED/]
  ] as const) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'partial-primary');
    storage.values.set(WECHAT_SAVE_BACKUP_KEY, bad);
    storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-with-prior/v1');
    const port = new WechatSaveStoragePort(() => storage, validate);
    assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), bad);
    const before = [...storage.values.entries()];
    await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(), pattern);
    assert.deepEqual([...storage.values.entries()], before);
    assert.deepEqual(storage.writes, []);
    assert.equal(hosts.at(-1)?.hasSession(), false);
  }
  assert.equal(hosts.length, 3);
});

test('recovery rechecks marker and backup after async validation before changing main', async () => {
  for (const changed of ['marker', 'backup'] as const) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'partial-primary');
    storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'old-backup');
    storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-with-prior/v1');
    const port = new WechatSaveStoragePort(() => storage, async () => {
      storage.values.set(changed === 'marker' ? WECHAT_SAVE_TRANSACTION_KEY : WECHAT_SAVE_BACKUP_KEY, 'changed');
    });
    assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'old-backup');
    await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(),
      changed === 'marker' ? /ERR_WECHAT_SAVE_MARKER_CHANGED/ : /ERR_WECHAT_SAVE_BACKUP_CHANGED/);
    assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'partial-primary');
    assert.deepEqual(storage.writes, []);
  }
});

test('primary changed during prior validation is refused before backup or marker writes', async () => {
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'old');
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'healthy-backup');
  const port = new WechatSaveStoragePort(() => storage, async () => {
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'externally-changed');
  });
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new'), /ERR_WECHAT_SAVE_PRIOR_CHANGED/);
  assert.equal(storage.values.get(WECHAT_SAVE_BACKUP_KEY), 'healthy-backup');
  assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
  assert.deepEqual(storage.writes, []);
});

test('backup recovery preflight refuses absent marker or backup without changing storage', async () => {
  const storage = new FakeStorage();
  const port = new WechatSaveStoragePort(() => storage);
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'old');
  await assert.rejects(port.assertBackupRecoveryAvailable(), /ERR_WECHAT_SAVE_RECOVERY_NOT_PENDING/);
  storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-with-prior/v1');
  storage.values.delete(WECHAT_SAVE_BACKUP_KEY);
  await assert.rejects(port.assertBackupRecoveryAvailable(), /ERR_WECHAT_SAVE_BACKUP_MISSING/);
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'old');
  await port.assertBackupRecoveryAvailable();
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.values.get(WECHAT_SAVE_TRANSACTION_KEY), 'wechat-save-with-prior/v1');
});

test('backup promotion refuses first, unknown, empty and malformed markers without touching any key', async () => {
  for (const marker of ['', 'wechat-save-first/v1', 'partial-marker', 'unknown', 0, null]) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'existing-main');
    storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'unrelated-backup');
    storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, marker);
    let validatorCalls = 0;
    const port = new WechatSaveStoragePort(() => storage, async () => { validatorCalls++; });
    const before = [...storage.values.entries()];
    await assert.rejects(port.assertBackupRecoveryAvailable());
    assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'unrelated-backup');
    await assert.rejects(port.finishBackupRecoveryAfterValidatedRead());
    assert.deepEqual([...storage.values.entries()], before);
    assert.deepEqual(storage.writes, []);
    assert.equal(validatorCalls, 0);
  }
});

test('a missing marker and generic uncertain lock cannot promote an unrelated backup without prior-save witness', async () => {
  const storage = new FakeStorage();
  storage.removeFailure = 'after';
  storage.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
  const port = new WechatSaveStoragePort(() => storage);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'first-save'), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'foreign-backup');
  const before = [...storage.values.entries()];
  const count = storage.writes.length;
  await assert.rejects(port.assertBackupRecoveryAvailable(), /ERR_WECHAT_SAVE_RECOVERY_NOT_ALLOWED/);
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'foreign-backup');
  await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(), /ERR_WECHAT_SAVE_RECOVERY_NOT_ALLOWED/);
  assert.deepEqual([...storage.values.entries()], before);
  assert.equal(storage.writes.length, count);
});

test('prior-save uncertain recovery without marker binds original provider and previous backup bytes', async () => {
  const storage = new FakeStorage();
  let current = storage;
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'old');
  storage.removeFailure = 'after';
  storage.removeFailureKey = WECHAT_SAVE_TRANSACTION_KEY;
  const port = new WechatSaveStoragePort(() => current);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new'), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
  assert.equal(storage.values.get(WECHAT_SAVE_BACKUP_KEY), 'old');
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'changed');
  await assert.rejects(port.assertBackupRecoveryAvailable(), /ERR_WECHAT_SAVE_RECOVERY_NOT_ALLOWED/);
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'changed');
  await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(), /ERR_WECHAT_SAVE_RECOVERY_NOT_ALLOWED/);
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'new');
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'old');
  const foreign = new FakeStorage();
  foreign.values.set(WECHAT_SAVE_STORAGE_KEY, 'new');
  foreign.values.set(WECHAT_SAVE_BACKUP_KEY, 'old');
  current = foreign;
  await assert.rejects(port.assertBackupRecoveryAvailable(), /ERR_WECHAT_SAVE_RECOVERY_NOT_ALLOWED/);
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'old');
  await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(), /ERR_WECHAT_SAVE_RECOVERY_NOT_ALLOWED/);
  assert.deepEqual(foreign.writes, []);
  current = storage;
  storage.removeFailure = null;
  await port.assertBackupRecoveryAvailable();
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'old');
  await port.finishBackupRecoveryAfterValidatedRead();
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), 'old');
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'old');
});

test('validated-read recovery requires a fresh backup read, rejects changed bytes and clears stale witness on failed read', async () => {
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'broken');
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'old');
  storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-with-prior/v1');
  const port = new WechatSaveStoragePort(() => storage);
  await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(), /ERR_WECHAT_SAVE_BACKUP_READ_REQUIRED/);
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'old');
  storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'changed');
  await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(), /ERR_WECHAT_SAVE_BACKUP_CHANGED/);
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'broken');
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'changed');
  storage.errorAt = 'get';
  await assert.rejects(port.read(WECHAT_BACKUP_SLOT_ID), /refused:get/);
  storage.errorAt = null;
  await assert.rejects(port.finishBackupRecoveryAfterValidatedRead(), /ERR_WECHAT_SAVE_BACKUP_READ_REQUIRED/);
  assert.equal(storage.values.get(WECHAT_SAVE_TRANSACTION_KEY), 'wechat-save-with-prior/v1');
});

test('same instance locks an uncertain commit even if marker deletion happened before error', async () => {
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'old');
  storage.removeFailure = 'after';
  const port = new WechatSaveStoragePort(() => storage);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new'), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
  assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
  await assert.rejects(port.read(WECHAT_SAVE_SLOT_ID), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'retry'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'old');
  storage.removeFailure = null;
  await port.finishBackupRecoveryAfterValidatedRead();
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), 'old');
  assert.equal(await port.read(WECHAT_BACKUP_SLOT_ID), 'old');
  assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
});

test('failed or unverified transaction marker never touches main; persisted marker blocks after restart', async () => {
  for (const failure of ['partial', 'noop', 'readback', 'throw-before', 'throw-after'] as const) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'original');
    if (failure === 'partial') storage.partialWriteKey = WECHAT_SAVE_TRANSACTION_KEY;
    if (failure === 'noop') storage.noWriteKey = WECHAT_SAVE_TRANSACTION_KEY;
    if (failure === 'readback') storage.failReadAfterWriteKey = WECHAT_SAVE_TRANSACTION_KEY;
    if (failure === 'throw-before') storage.throwBeforeWriteKey = WECHAT_SAVE_TRANSACTION_KEY;
    if (failure === 'throw-after') storage.throwAfterWriteKey = WECHAT_SAVE_TRANSACTION_KEY;
    await assert.rejects(new WechatSaveStoragePort(() => storage).write(WECHAT_SAVE_SLOT_ID, 'new'));
    assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'original');
    assert.equal(storage.values.get(WECHAT_SAVE_BACKUP_KEY), 'original');
    assert.equal(storage.writes.includes(WECHAT_SAVE_STORAGE_KEY), false);
    storage.errorAt = null;
    if (storage.values.has(WECHAT_SAVE_TRANSACTION_KEY)) {
      await assert.rejects(new WechatSaveStoragePort(() => storage).write(WECHAT_SAVE_SLOT_ID, 'retry'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
      assert.equal(storage.values.get(WECHAT_SAVE_BACKUP_KEY), 'original');
    }
  }
});

test('present empty, malformed or non-string marker always blocks save', async () => {
  for (const marker of ['', 'partial', null, 0, {}]) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'original');
    storage.values.set(WECHAT_SAVE_BACKUP_KEY, 'protected');
    storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, marker);
    await assert.rejects(new WechatSaveStoragePort(() => storage).write(WECHAT_SAVE_SLOT_ID, 'new'));
    assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'original');
    assert.equal(storage.values.get(WECHAT_SAVE_BACKUP_KEY), 'protected');
    assert.deepEqual(storage.writes, []);
  }
});

test('marker cleanup failures report uncertain commit and preserve backup', async () => {
  for (const failure of ['before', 'noop', 'after'] as const) {
    const storage = new FakeStorage();
    storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'original');
    storage.removeFailure = failure;
    await assert.rejects(new WechatSaveStoragePort(() => storage).write(WECHAT_SAVE_SLOT_ID, 'new'), /ERR_WECHAT_SAVE_COMMIT_UNCERTAIN/);
    assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'new');
    assert.equal(storage.values.get(WECHAT_SAVE_BACKUP_KEY), 'original');
    if (failure !== 'after') {
      await assert.rejects(new WechatSaveStoragePort(() => storage).write(WECHAT_SAVE_SLOT_ID, 'retry'), /ERR_WECHAT_SAVE_RECOVERY_REQUIRED/);
    } else {
      assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false, 'an exception may arrive after deletion');
    }
    assert.equal(storage.values.get(WECHAT_SAVE_BACKUP_KEY), 'original');
  }
});

test('public binding restores a valid backup and rejects a corrupt backup without replacing the session', async () => {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  const schemas = Object.fromEntries(snapshot.schema_paths.map(path => [path, JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))]));
  const storage = new FakeStorage();
  const port = new WechatSaveStoragePort(() => storage);
  const host = createStage1AHost({ snapshot, schemas, buildId: 'wechat_backup_contract',
    nowIso8601: '2026-11-04T00:00:00.000Z', storage: port });
  const binding = new QinglanUiSceneProbeComponent(host, { applyNodeBindingPatch: () => {} });
  const advance = { name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } } as const;
  const save = { name: 'save', selection: { slot_id: WECHAT_SAVE_SLOT_ID } } as const;
  const loadBackup = { name: 'load', selection: { slot_id: WECHAT_BACKUP_SLOT_ID } } as const;
  try {
    await binding.mount();
    await binding.execute(advance);
    assert.equal((await binding.execute(save)).command_result.status, 'completed');
    await binding.execute(advance);
    assert.equal((await binding.execute(save)).command_result.status, 'completed');
    const oldBytes = storage.values.get(WECHAT_SAVE_BACKUP_KEY);
    storage.values.set(WECHAT_SAVE_TRANSACTION_KEY, 'wechat-save-with-prior/v1');
    await port.assertBackupRecoveryAvailable();
    assert.equal((await binding.execute(loadBackup)).command_result.status, 'completed');
    assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
    await port.finishBackupRecoveryAfterValidatedRead();
    assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), oldBytes);
    assert.equal(storage.values.has(WECHAT_SAVE_TRANSACTION_KEY), false);
    storage.values.set(WECHAT_SAVE_BACKUP_KEY, '{bad JSON');
    const failed = await binding.execute(loadBackup);
    assert.equal(failed.command_result.status, 'failed');
    assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
    assert.equal(storage.values.get(WECHAT_SAVE_BACKUP_KEY), '{bad JSON');
  } finally {
    await binding.unmount();
    host.destroySession();
  }
});

test('enumeration, read, provider and write exceptions propagate and healthy retries work', async () => {
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'old');
  let providerFails = true;
  const port = new WechatSaveStoragePort(() => {
    if (providerFails) throw new Error('provider refused');
    return storage;
  });
  await assert.rejects(port.read(WECHAT_SAVE_SLOT_ID), /provider refused/);
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new'), /provider refused/);
  providerFails = false;
  for (const stage of ['length', 'key', 'get', 'set'] as const) {
    storage.errorAt = stage;
    await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'new'), new RegExp(`refused:${stage}`));
    assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'old');
    if (stage !== 'set') await assert.rejects(port.read(WECHAT_SAVE_SLOT_ID), new RegExp(`refused:${stage}`));
  }
  storage.errorAt = null;
  await port.write(WECHAT_SAVE_SLOT_ID, 'new');
  assert.equal(await port.read(WECHAT_SAVE_SLOT_ID), 'new');
});

test('silent no-op write, bad enumeration and partial mutation fail without an in-memory fallback', async () => {
  const storage = new FakeStorage();
  storage.values.set(WECHAT_SAVE_STORAGE_KEY, 'old');
  const port = new WechatSaveStoragePort(() => storage);
  storage.noWriteKey = WECHAT_SAVE_BACKUP_KEY;
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'different'), /ERR_WECHAT_SAVE_VERIFY_FAILED/);
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'old');
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'old');
  storage.noWriteKey = null;
  storage.failReadAfterWriteKey = WECHAT_SAVE_STORAGE_KEY;
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'written-but-unverified'), /refused:get/);
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'written-but-unverified', 'readback failure is not a rollback guarantee');
  storage.errorAt = null;
  storage.failReadAfterWriteKey = null;
  storage.values.delete(WECHAT_SAVE_TRANSACTION_KEY); // Start an independent fault scenario in this fake.
  storage.partialWriteKey = WECHAT_SAVE_STORAGE_KEY;
  await assert.rejects(port.write(WECHAT_SAVE_SLOT_ID, 'different'), /partial write/);
  assert.equal(storage.values.get(WECHAT_SAVE_STORAGE_KEY), 'di', 'failed platform write may have changed the old bytes');
  const invalid: WechatPlatformStorage = { length: 1, key: () => null, getItem: () => '', setItem: () => {}, removeItem: () => {} };
  await assert.rejects(new WechatSaveStoragePort(() => invalid).read(WECHAT_SAVE_SLOT_ID), /ERR_WECHAT_STORAGE_ENUM_INVALID/);
  const invalidLength: WechatPlatformStorage = { ...invalid, length: -1 };
  await assert.rejects(new WechatSaveStoragePort(() => invalidLength).read(WECHAT_SAVE_SLOT_ID), /ERR_WECHAT_STORAGE_ENUM_INVALID/);
});
