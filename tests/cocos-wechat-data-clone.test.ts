import test from 'node:test';
import assert from 'node:assert/strict';
import { structuredClone as clone } from '../apps/cocos-wechat-probe/runtime/WechatDataClone';

test('WeChat formal DTO clone retains native decisions for plain data, references, holes and special keys', () => {
  const shared = { quantity: { amount: 3, unit: 'g' }, optional: undefined };
  const input: Record<string, unknown> = { a: shared, b: shared, zero: -0, missing: undefined,
    values: [null, true, '白菜', NaN, Infinity, BigInt(4)], holes: new Array(3) };
  Object.defineProperty(input, '__proto__', { value: { safe: true }, enumerable: true });
  input.self = input;
  const copied = clone(input);
  assert.deepEqual(copied, globalThis.structuredClone(input));
  assert.notEqual(copied, input);
  assert.notEqual(copied.a, shared);
  assert.equal(copied.a, copied.b);
  assert.equal(copied.self, copied);
  assert.ok(Object.is(copied.zero, -0));
  assert.equal(Object.hasOwn(copied, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(copied), Object.prototype);
  assert.equal(0 in (copied.holes as unknown[]), false);
  (copied.a as typeof shared).quantity.amount = 99;
  assert.equal(shared.quantity.amount, 3);
  const nullPrototype = Object.assign(Object.create(null), { x: [1, 2] });
  assert.deepEqual(clone(nullPrototype), globalThis.structuredClone(nullPrototype));
});

test('WeChat DTO clone fails explicitly for unsupported values and transfer instead of silently dropping data', () => {
  for (const input of [() => {}, Symbol('x'), { callback: () => {} }, new Map(), new Set(), new Date(), /x/, new Uint8Array(2)]) {
    assert.throws(() => clone(input), { name: 'DataCloneError', message: 'ERR_WECHAT_DATA_CLONE_UNSUPPORTED' });
  }
  assert.throws(() => clone({ ok: 1 }, { transfer: [] }), /ERR_WECHAT_DATA_CLONE_UNSUPPORTED/);
});
