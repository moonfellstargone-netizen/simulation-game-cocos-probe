import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProbeOrders } from '../apps/cocos-probe/template/assets/scripts/ProbeOrders';
import { ProbeLifetime, type ProbeCommand, type ProbeCommandResult, type ProbeMenuSnapshot } from '../apps/cocos-probe/template/assets/scripts/ProbeLifetime';
import { ProbeInteraction } from '../apps/cocos-probe/template/assets/scripts/ProbeInteraction';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, SaveManager, type SaveFile, type RuntimeConfigSnapshot } from '../src/game-core';
import { Stage1AFixtureRunner } from '../src/game-core/testing-api';
import { buildRuntimeWithoutState } from './support/runtimeHarness';

const SAVE = { name: 'save', selection: { slot_id: 'web_probe' } } as const;
const LOAD = { name: 'load', selection: { slot_id: 'web_probe' } } as const;
type Intercept = (command: ProbeCommand, next: () => Promise<ProbeCommandResult>) => Promise<ProbeCommandResult>;
async function orderProbe(storage = new InMemorySaveStoragePort(), intercept?: Intercept) {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  const orders = new ProbeOrders(); let host: CocosSessionHost | null = null; let calls = 0;
  const lifetime = new ProbeLifetime({
    loadResources: async () => ({ snapshot, buildId: 'web_orders_contract', schemas: Object.fromEntries(snapshot.schema_paths.map(path => [path, JSON.parse(readFileSync('design_snapshot/' + path, 'utf8'))])) }),
    createHost: input => host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot, storage, nowIso8601: '2026-11-02T00:00:00.000Z', randomSeed: 'farming-test-23' }),
    createBinding: current => new QinglanUiSceneProbeComponent(current as CocosSessionHost, { applyNodeBindingPatch: patch => { if (patch.section === 'menu') orders.refresh(patch.payload as ProbeMenuSnapshot); } })
  });
  const interaction = new ProbeInteraction({ isAvailable: () => !lifetime.isDisposed() && lifetime.status().phase === 'ready',
    execute: async command => { calls++; const next = () => lifetime.execute(command); const result = await (intercept ? intercept(command, next) : next());
      if (!lifetime.isDisposed()) orders.acceptOrderResult(command, result); return result; }, onChange: () => {} });
  const send = async (command: ProbeCommand) => {
    if ((command.name !== 'menu_preview' && command.name !== 'menu_confirm') || command.selection.action_type !== 'submit_order') orders.invalidatePreview();
    try { return await interaction.execute(command); } catch (error) { orders.invalidatePreview(); throw error; }
  };
  await lifetime.start();
  const capture = async () => { await host!.requireSession().save('orders_capture'); return storage.read('orders_capture'); };
  async function ready() {
    const x = buildRuntimeWithoutState();
    const fixture = x.snapshot.loaded_documents['tests/fixtures/stage_1A_action_sequence.yaml'];
    const report = new Stage1AFixtureRunner(x.runtime.pipeline, { configs: x.configs, buildId: 'web_orders_fixture', nowIso8601: '2026-11-02T00:00:00.000Z', randomSeed: 'farming-test-23' }).runFixtureThroughStepId(fixture, 'T13_cook_bacon_cabbage');
    x.contracts.assertSaveFile(report.state.save_file);
    await storage.write('web_probe', new SaveManager().serialize(report.state)); await send(LOAD);
    return { dishId: report.aliases.dish_lot, saved: await capture() };
  }
  return { orders, lifetime, interaction, send, capture, ready, storage, calls: () => calls, menu: () => host!.requireSession().getSelectableViewModel(), session: () => host!.requireSession() };
}
type OrderProbe = Awaited<ReturnType<typeof orderProbe>>;
function select(p: OrderProbe) { if (!p.orders.status().selectedOrderId) p.orders.selectNextOrder(); if (!p.orders.status().selectedDishId) p.orders.selectNextDish(); }
async function preview(p: OrderProbe) { const command = p.orders.previewCommand(); assert.ok(command); return p.send(command); }
async function confirm(p: OrderProbe) { const command = p.orders.confirmCommand(); assert.ok(command); return p.send(command); }

test('orders keep empty and terminal choices inspectable without implicit selections or business commands', async t => {
  const p = await orderProbe(); t.after(() => p.lifetime.dispose()); const before = await p.capture();
  assert.ok(p.orders.status().orderOptions.length); assert.equal(p.orders.status().selectedOrderId, null);
  p.orders.selectNextOrder(); assert.equal(p.orders.status().dishOptions.length, 0); assert.equal(p.orders.previewCommand(), null);
  assert.match(p.orders.status().inputError!, /菜品/); assert.equal(p.calls(), 0); assert.equal(await p.capture(), before);
  const detached = p.orders.status(); Reflect.set(detached.orderOptions[0]!, 'status', 'completed');
  assert.equal(p.orders.status().orderOptions[0]!.status, 'available');
});

test('order preview is read-only and a real selected dish settles once with actual money and reputation', async t => {
  const p = await orderProbe(); t.after(() => p.lifetime.dispose()); const source = await p.ready(); select(p);
  const before = await p.capture(); await preview(p); assert.equal(await p.capture(), before); assert.equal(p.orders.status().canSubmit, true);
  p.orders.selectNextDish(); assert.equal(p.orders.confirmCommand(), null); await preview(p); await confirm(p);
  const result = p.orders.status().result!; const actual = JSON.parse((await p.capture())!) as SaveFile;
  assert.equal(result.dishLotId, source.dishId); assert.equal(result.rewardMoney, 37); assert.equal(result.moneyAfter, 137);
  assert.deepEqual(result.reputationDelta, { west_market_tavern: 1 });
  assert.equal(actual.orders[0]!.status, 'completed'); assert.equal(actual.dish_lots.length, 0);
  assert.equal(actual.storage_containers.some(c => c.active_object_refs.some(r => r.object_id === source.dishId)), false);
  assert.equal(p.orders.confirmCommand(), null); assert.equal(p.orders.status().selectedDishId, null);
  assert.match(p.interaction.status().operation.message, /订单.*完成/);
});

test('choosing one of two actually cooked dishes consumes the whole selected batch and preserves the other', async t => {
  const p = await orderProbe(); t.after(() => p.lifetime.dispose()); const source = await p.ready();
  const menu = p.menu(); const recipe = menu.cookable_recipe_options.find(option => option.enabled)!;
  const ingredient_options: Record<string, { lot_option_id: string; quantity: { amount: number; unit: string } }> = {};
  for (const role of recipe.roles.filter(role => role.required)) {
    assert.ok(role.min_quantity); const lot = menu.splittable_lot_options.find(lot => role.lot_ids.includes(lot.id) && lot.enabled && lot.quantity.amount >= role.min_quantity!.amount);
    assert.ok(lot, 'the second actual cooking needs a real public lot with sufficient quantity');
    ingredient_options[role.role] = { lot_option_id: lot.id, quantity: { ...role.min_quantity } };
  }
  const target = menu.storage_target_options.find(option => option.storage_type === 'room_temp' && option.enabled)!;
  const cooked = await p.send({ name: 'menu_confirm', selection: { action_type: 'cook_dish', recipe_option_id: recipe.id, ingredient_options,
    operation_profile: { heat_level: 'high', active_minutes: 8 }, target_storage_option_id: target.id } });
  assert.equal(cooked!.command_result.snapshot!.menu!.last_action_result!.success, true);
  const before = JSON.parse((await p.capture())!) as SaveFile; assert.equal(before.dish_lots.length, 2); select(p);
  assert.equal(p.orders.status().selectedDishId, source.dishId); await preview(p); await confirm(p);
  const after = JSON.parse((await p.capture())!) as SaveFile;
  assert.deepEqual(after.dish_lots, before.dish_lots.filter(dish => dish.dish_lot_id !== source.dishId));
  assert.equal(after.orders[0]!.result_summary!.submitted_count, before.dish_lots.find(dish => dish.dish_lot_id === source.dishId)!.serving_count);
  const other = after.dish_lots[0]!; assert.ok(after.storage_containers.some(container => container.active_object_refs.some(ref => ref.object_type === 'DishLot' && ref.object_id === other.dish_lot_id)));
});

test('order demand refusal preserves the entire save and a legal loaded dish can recover', async t => {
  const p = await orderProbe(); t.after(() => p.lifetime.dispose()); const source = await p.ready();
  const unsafe = JSON.parse(source.saved!) as SaveFile; unsafe.dish_lots[0]!.dish_profile.safety_risk = 26;
  await p.storage.write('web_probe', JSON.stringify(unsafe)); await p.send(LOAD); select(p); const before = await p.capture();
  await preview(p); assert.equal(p.orders.status().preview?.statusCode, 'ERR_DEMAND_REJECTED_SAFETY');
  assert.equal(p.orders.confirmCommand(), null); assert.equal(await p.capture(), before);
  const parameters = { order_id: p.orders.status().selectedOrderId!, submitted_object_refs: [{ object_type: 'DishLot' as const, object_id: source.dishId }] };
  assert.equal(p.session().dispatch('submit_order', parameters).status_code, 'ERR_DEMAND_REJECTED_SAFETY'); assert.equal(await p.capture(), before);
  await p.storage.write('web_probe', source.saved!); await p.send(LOAD); select(p); await preview(p); await confirm(p);
  assert.equal(p.orders.status().result?.rewardMoney, 37);
});

test('normal time and older saves invalidate order previews while loaded completion remains historical', async t => {
  const storage = new InMemorySaveStoragePort(); const p = await orderProbe(storage); t.after(() => p.lifetime.dispose());
  await p.ready(); select(p); await preview(p); const remaining = p.orders.status().orderOptions[0]!.minutes_until_deadline!;
  await p.send({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: remaining + 1 } });
  assert.equal(p.orders.status().orderOptions[0]!.status, 'expired'); assert.equal(p.orders.confirmCommand(), null);
  const expired = await p.capture(); const expiredDish = p.orders.status().dishOptions[0]!.id;
  assert.equal(p.session().dispatch('submit_order', { order_id: p.orders.status().orderOptions[0]!.id, submitted_object_refs: [{ object_type: 'DishLot', object_id: expiredDish }] }).status_code, 'ERR_ORDER_NOT_AVAILABLE');
  assert.equal(await p.capture(), expired);
  await p.send(LOAD); select(p); assert.equal(p.orders.status().result, null); await preview(p); await confirm(p); await p.send(SAVE);
  const completed = await p.capture(); await p.lifetime.dispose(); const fresh = await orderProbe(storage); t.after(() => fresh.lifetime.dispose());
  assert.equal(fresh.calls(), 0); await fresh.send(LOAD); fresh.orders.selectNextOrder();
  assert.equal(await fresh.capture(), completed); assert.equal(fresh.orders.status().result, null);
  assert.equal(fresh.orders.status().orderOptions[0]!.result_summary?.reward_final, 37); assert.equal(fresh.orders.previewCommand(), null);
  const historical = fresh.orders.status().orderOptions[0]!;
  assert.equal(fresh.session().dispatch('submit_order', { order_id: historical.id, submitted_object_refs: structuredClone(historical.submitted_object_refs) }).status_code, 'ERR_ORDER_NOT_AVAILABLE');
  assert.equal(await fresh.capture(), completed);
});

test('a missing dish after loading clears selection and cannot reuse an old successful preview', async t => {
  const p = await orderProbe(); t.after(() => p.lifetime.dispose()); await p.send(SAVE); await p.ready(); select(p); await preview(p);
  const empty = await orderProbe(); try { await empty.send(SAVE); const raw = await empty.storage.read('web_probe'); await p.storage.write('web_probe', raw!); } finally { await empty.lifetime.dispose(); }
  await p.send(LOAD); assert.equal(p.orders.status().selectedDishId, null); assert.equal(p.orders.status().preview, null); assert.equal(p.orders.confirmCommand(), null);
});

test('a committed order cannot claim a wrong dish receipt or automatically replay settlement', async t => {
  let corrupt = false;
  const p = await orderProbe(undefined, async (command, next) => {
    const result = await next(); if (!corrupt || command.name !== 'menu_confirm' || command.selection.action_type !== 'submit_order') return result;
    const wrong = structuredClone(result); Reflect.set(wrong.command_result.snapshot!.menu!.last_action_result!, 'consumed_resources', [{ resource_type: 'DishLot', resource_id: 'wrong_dish' }]); return wrong;
  }); t.after(() => p.lifetime.dispose()); await p.ready(); select(p); await preview(p); corrupt = true; const calls = p.calls();
  await assert.rejects(confirm(p), /ERR_COCOS_PROBE_ORDER_RESULT/); assert.equal(p.calls(), calls + 1);
  assert.equal(p.interaction.status().operation.status, 'failed'); assert.equal(p.orders.status().result, null); assert.equal(p.orders.confirmCommand(), null);
  assert.equal((JSON.parse((await p.capture())!) as SaveFile).player_state.money, 137); corrupt = false; await p.send(SAVE);
  assert.equal((JSON.parse((await p.capture())!) as SaveFile).player_state.money, 137);
});

test('a committed order rejects an older ActionResult request even when the other receipt fields look successful', async t => {
  let corrupt = false;
  const p = await orderProbe(undefined, async (command, next) => {
    const result = await next(); if (!corrupt || command.name !== 'menu_confirm' || command.selection.action_type !== 'submit_order') return result;
    const wrong = structuredClone(result); Reflect.set(wrong.command_result.snapshot!.menu!.last_action_result!, 'request_id', 'unrelated_previous_request'); return wrong;
  }); t.after(() => p.lifetime.dispose()); await p.ready(); select(p); await preview(p); corrupt = true; const calls = p.calls();
  await assert.rejects(confirm(p), /ERR_COCOS_PROBE_ORDER_RESULT/); assert.equal(p.calls(), calls + 1);
  assert.equal(p.interaction.status().operation.status, 'failed'); assert.equal(p.orders.status().result, null);
  assert.equal((JSON.parse((await p.capture())!) as SaveFile).player_state.money, 137);
});

test('missing or wrong order command names fail before completed feedback without retrying an actual settlement', async t => {
  for (const phase of ['menu_confirm', 'menu_preview'] as const) for (const mode of ['missing', 'wrong']) {
    let corrupt = false;
    const p = await orderProbe(undefined, async (command, next) => {
      const result = await next(); if (!corrupt || command.name !== phase || command.selection.action_type !== 'submit_order') return result;
      const wrong = structuredClone(result);
      if (mode === 'missing') Reflect.deleteProperty(wrong.command_result, 'command_name'); else Reflect.set(wrong.command_result, 'command_name', 'save');
      return wrong;
    }); t.after(() => p.lifetime.dispose()); await p.ready(); select(p); if (phase === 'menu_confirm') await preview(p);
    const before = await p.capture(); const calls = p.calls(); corrupt = true;
    await assert.rejects(phase === 'menu_confirm' ? confirm(p) : preview(p), /ERR_COCOS_PROBE_ORDER_COMMAND_RESULT_MISMATCH/);
    assert.equal(p.calls(), calls + 1); assert.equal(p.interaction.status().operation.status, 'failed');
    assert.doesNotMatch(p.interaction.status().operation.message, /校验通过|结算完成/);
    assert.equal(p.orders.status().result, null); assert.equal(p.orders.status().preview, null); assert.equal(p.orders.confirmCommand(), null);
    const actual = JSON.parse((await p.capture())!) as SaveFile;
    if (phase === 'menu_confirm') { assert.equal(actual.player_state.money, 137); assert.equal(actual.orders[0]!.status, 'completed'); }
    else assert.equal(await p.capture(), before);
    corrupt = false; await p.send(SAVE); assert.equal(p.calls(), calls + 2); assert.equal(actual.player_state.money, (JSON.parse((await p.capture())!) as SaveFile).player_state.money);
  }
});

test('a stale pending order preview cannot publish completed success after a local selection changes', async t => {
  let hold = true; let release!: () => void; let entered!: () => void;
  const held = new Promise<void>(r => { release = r; }); const reached = new Promise<void>(r => { entered = r; });
  const p = await orderProbe(undefined, async (command, next) => { const result = await next(); if (hold && command.name === 'menu_preview' && command.selection.action_type === 'submit_order') { entered(); await held; } return result; });
  t.after(() => p.lifetime.dispose()); await p.ready(); select(p); const before = await p.capture();
  const command = p.orders.previewCommand()!; const pending = p.send(command); await reached; p.orders.selectNextDish(); release();
  await assert.rejects(pending, /ERR_COCOS_PROBE_ORDER_RECEIPT_STALE/);
  assert.equal(p.interaction.status().operation.status, 'failed'); assert.doesNotMatch(p.interaction.status().operation.message, /校验通过|结算完成/);
  assert.equal(p.orders.status().preview, null); assert.equal(p.orders.confirmCommand(), null); assert.equal(await p.capture(), before);
  hold = false; await preview(p); assert.equal(p.orders.status().canSubmit, true);
});

test('busy order confirmation admits once and disposal prevents a late success from restoring local feedback', async () => {
  let release!: () => void; let entered!: () => void; const held = new Promise<void>(r => { release = r; }); const reached = new Promise<void>(r => { entered = r; });
  const p = await orderProbe(undefined, async (command, next) => { const result = await next(); if (command.name === 'menu_confirm' && command.selection.action_type === 'submit_order') { entered(); await held; } return result; });
  try { await p.ready(); select(p); await preview(p); const command = p.orders.confirmCommand()!; const calls = p.calls(); const pending = p.send(command); await reached;
    assert.equal(await p.send(command), null); assert.equal(p.calls(), calls + 1); p.orders.invalidatePreview(); await p.lifetime.dispose(); release(); await pending;
    assert.equal(p.orders.status().result, null); assert.equal(p.orders.confirmCommand(), null);
  } finally { release(); await p.lifetime.dispose(); }
});
