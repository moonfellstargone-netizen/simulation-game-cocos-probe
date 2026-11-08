import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProbeLifetime, type ProbeCommand, type ProbeCommandResult, type ProbeMenuSnapshot } from '../apps/cocos-probe/template/assets/scripts/ProbeLifetime';
import { ProbeInteraction } from '../apps/cocos-probe/template/assets/scripts/ProbeInteraction';
import { ProbeCooking } from '../apps/cocos-probe/template/assets/scripts/ProbeCooking';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot, type SaveFile } from '../src/game-core';
import { CocosActionDraftBuilder } from '../src/cocos-app/adapters/CocosActionDraftBuilder';

type Intercept = (command: ProbeCommand, next: () => Promise<ProbeCommandResult>) => Promise<ProbeCommandResult>;
const SAVE = { name: 'save', selection: { slot_id: 'web_probe' } } as const;
const LOAD = { name: 'load', selection: { slot_id: 'web_probe' } } as const;

async function cookingProbe(storage = new InMemorySaveStoragePort(), intercept?: Intercept) {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  let host: CocosSessionHost | null = null;
  const cooking = new ProbeCooking();
  let calls = 0;
  const lifetime = new ProbeLifetime({
    loadResources: async () => ({ snapshot, buildId: 'web_cooking_contract', schemas: Object.fromEntries(snapshot.schema_paths.map((path) => [path,
      JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))])) }),
    createHost: (input) => host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot, storage, nowIso8601: '2026-11-02T00:00:00.000Z', randomSeed: 'farming-test-23' }),
    createBinding: (current) => new QinglanUiSceneProbeComponent(current as CocosSessionHost, {
      applyNodeBindingPatch: (patch) => { if (patch.section === 'menu') cooking.refresh(patch.payload as ProbeMenuSnapshot); }
    })
  });
  const interaction = new ProbeInteraction({ isAvailable: () => !lifetime.isDisposed() && lifetime.status().phase === 'ready',
    execute: async (command) => {
      calls++; const next = () => lifetime.execute(command);
      const result = await (intercept ? intercept(command, next) : next());
      if (!lifetime.isDisposed()) cooking.acceptCookingResult(command, result);
      return result;
    }, onChange: () => {} });
  await lifetime.start();
  const send = async (command: ProbeCommand) => {
    if ((command.name !== 'menu_preview' && command.name !== 'menu_confirm') || command.selection.action_type !== 'cook_dish') cooking.invalidatePreview();
    try {
      const result = await interaction.execute(command);
      return result;
    } catch (error) { cooking.invalidatePreview(); throw error; }
  };
  async function capture() { await host!.requireSession().save('cooking_capture'); return storage.read('cooking_capture'); }
  async function harvest() {
    const current = host!.requireSession().getSelectableViewModel();
    const field = current.field_options.find((item) => item.enabled)!;
    const seed = current.seed_lot_options.find((item) => item.enabled)!;
    await send({ name: 'menu_confirm', selection: { action_type: 'plant_crop', field_option_id: field.id,
      seed_lot_option_id: seed.id, seed_quantity: { amount: 1, unit: seed.quantity.unit } } });
    for (let day = 0; day < 30 && !host!.requireSession().getSelectableViewModel().harvestable_crop_options.some((item) => item.field_plot_id === field.id); day++) {
      await send({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 1440 } });
    }
    const crop = host!.requireSession().getSelectableViewModel().harvestable_crop_options.find((item) => item.field_plot_id === field.id)!;
    await send({ name: 'menu_confirm', selection: { action_type: 'harvest_crop', crop_option_id: crop.id } });
  }
  return { lifetime, interaction, cooking, storage, send, capture, harvest, calls: () => calls,
    session: () => host!.requireSession() };
}

type PublicCooking = Awaited<ReturnType<typeof cookingProbe>>;
function input(p: PublicCooking, role: string, text: string) {
  for (let i = 0; i < 5 && p.cooking.status().selectedRole !== role; i++) p.cooking.selectNextRole();
  assert.equal(p.cooking.status().selectedRole, role);
  if (!p.cooking.status().inputSelections.find((item) => item.role === role)?.lotId) p.cooking.selectNextLot();
  p.cooking.setInputQuantity(text);
}
function setup(p: PublicCooking, side = true) {
  p.cooking.selectNextRecipe();
  input(p, 'main', '250');
  if (side) input(p, 'side', '50');
  for (let i = 0; i < 3 && p.cooking.status().heatLevel !== 'high'; i++) p.cooking.selectNextHeat();
  p.cooking.setActiveMinutes('8');
  for (let i = 0; i < 8 && p.cooking.status().targetOptions.find((item) => item.id === p.cooking.status().selectedTargetId)?.storage_type !== 'room_temp'; i++) p.cooking.selectNextStorage();
}
async function preview(p: PublicCooking) {
  const command = p.cooking.previewCommand(); assert.ok(command);
  const result = await p.send(command); assert.ok(result); return { command, result };
}
async function cook(p: PublicCooking) {
  const command = p.cooking.confirmCommand(); assert.ok(command);
  const result = await p.send(command); assert.ok(result); return result;
}

test('cooking keeps missing-material recipes inspectable and local inputs detached without implicit operation defaults', async (t) => {
  const p = await cookingProbe(); t.after(() => p.lifetime.dispose());
  const before = await p.capture(); p.cooking.selectNextRecipe();
  const view = p.cooking.status();
  assert.ok(view.recipeOptions.length); assert.equal(view.recipeOptions[0]!.enabled, false);
  assert.equal(view.selectedRecipeId, view.recipeOptions[0]!.id);
  assert.equal(view.heatLevel, null); assert.equal(view.activeMinutesText, '');
  assert.equal(view.currentInputLotOptions.length, 0); assert.equal(view.canPreview, false);
  Reflect.set(view.recipeOptions[0]!.roles[0]!, 'role', 'changed');
  assert.notEqual(p.cooking.status().recipeOptions[0]!.roles[0]!.role, 'changed');
  assert.equal(p.calls(), 0); assert.equal(await p.capture(), before);
});

test('real cooking menu refusal and insufficient ingredients preserve the entire save and recover to a real DishLot', async (t) => {
  const p = await cookingProbe(); t.after(() => p.lifetime.dispose()); await p.harvest(); setup(p, false);
  const before = await p.capture(); await preview(p);
  assert.equal(p.cooking.status().preview?.success, false);
  assert.match(p.cooking.status().preview!.statusCode, /ERR_MENU_RECIPE_ROLE_MISSING:side/);
  assert.equal(p.cooking.confirmCommand(), null); assert.equal(await p.capture(), before);
  input(p, 'side', '49'); await preview(p);
  assert.equal(p.cooking.status().preview?.success, false); assert.equal(await p.capture(), before);
  input(p, 'side', '50'); await preview(p); await preview(p);
  assert.equal(await p.capture(), before); assert.equal(p.cooking.status().canCook, true);
  const time = p.lifetime.status().timeLabel; const result = await cook(p);
  const created = result!.command_result.snapshot!.menu!.last_action_result!.created_objects.find((item) => item.object_type === 'DishLot')!;
  const dish = p.cooking.status().dishOptions.find((item) => item.id === created.object_id)!;
  assert.deepEqual(p.cooking.status().result, { dishLotId: dish.id, recognizedDishId: dish.recognized_dish_id, servingCount: dish.serving_count, storageRef: dish.storage_ref });
  assert.equal(p.interaction.status().operation.message, '烹饪成功'); assert.equal(p.lifetime.status().timeLabel, time);
  assert.equal(p.cooking.status().recipeOptions[0]!.fuel!.current_quantity.amount, 14);
  assert.equal(p.cooking.status().lotOptions.find((lot) => lot.base_id === 'bacon')!.quantity.amount, 150);
  assert.equal(p.cooking.confirmCommand(), null);
});

test('quantity and minutes validation is local while valid numbers retain formal preview boundaries', async (t) => {
  const p = await cookingProbe(); t.after(() => p.lifetime.dispose()); await p.harvest(); setup(p);
  const before = await p.capture();
  for (const text of ['', ' ', '0', '-1', 'NaN', 'Infinity', '50g', '0x32', '1e309']) {
    p.cooking.setInputQuantity(text); assert.equal(p.cooking.previewCommand(), null, text);
  }
  p.cooking.setInputQuantity('50');
  for (const text of ['', ' ', '0', '-1', '1.5', 'NaN', '8min', '1e309']) {
    p.cooking.setActiveMinutes(text); assert.equal(p.cooking.previewCommand(), null, text);
  }
  p.cooking.setActiveMinutes('16'); await preview(p); assert.equal(p.cooking.status().preview?.success, false);
  assert.equal(await p.capture(), before); p.cooking.setActiveMinutes('8'); await preview(p); assert.equal(p.cooking.status().canCook, true);
  p.cooking.selectNextRole(); assert.equal(p.cooking.confirmCommand(), null);
  assert.equal(await p.capture(), before);
});

test('storage refusal rolls back cooking and a different public storage target succeeds', async (t) => {
  const p = await cookingProbe(); t.after(() => p.lifetime.dispose()); await p.harvest(); setup(p);
  for (let i = 0; i < 8 && p.cooking.status().targetOptions.find((item) => item.id === p.cooking.status().selectedTargetId)?.storage_type !== 'cellar'; i++) p.cooking.selectNextStorage();
  const before = await p.capture(); await preview(p);
  assert.equal(p.cooking.status().preview?.success, false); assert.equal(p.cooking.confirmCommand(), null); assert.equal(await p.capture(), before);
  for (let i = 0; i < 8 && p.cooking.status().targetOptions.find((item) => item.id === p.cooking.status().selectedTargetId)?.storage_type !== 'room_temp'; i++) p.cooking.selectNextStorage();
  await preview(p); await cook(p); assert.ok(p.cooking.status().result);
});

test('manual save and fresh-host load restore actual dishes and fuel without auto-loading or reusing a dish ID', async (t) => {
  const storage = new InMemorySaveStoragePort(); const first = await cookingProbe(storage); t.after(() => first.lifetime.dispose());
  await first.harvest(); setup(first); await preview(first); await cook(first); const oldId = first.cooking.status().result!.dishLotId;
  await first.send(SAVE); const saved = await first.capture(); await first.lifetime.dispose();
  const second = await cookingProbe(storage); t.after(() => second.lifetime.dispose());
  assert.equal(second.cooking.status().dishOptions.length, 0); assert.equal(second.calls(), 0);
  await second.send(LOAD); assert.equal(await second.capture(), saved); assert.equal(second.cooking.status().result, null);
  assert.ok(second.cooking.status().dishOptions.some((dish) => dish.id === oldId));
  setup(second); await preview(second); await cook(second);
  assert.notEqual(second.cooking.status().result!.dishLotId, oldId); assert.equal(second.cooking.status().dishOptions.length, 2);
  assert.equal(second.cooking.status().recipeOptions[0]!.fuel!.current_quantity.amount, 13);
});

test('clearing an optional role and loading older material state discard stale previews without automatic replacement', async (t) => {
  const p = await cookingProbe(); t.after(() => p.lifetime.dispose()); await p.send(SAVE);
  await p.harvest(); setup(p); input(p, 'oil', '10'); await preview(p);
  p.cooking.clearRole(); assert.equal(p.cooking.status().canCook, false);
  assert.equal(p.cooking.status().inputSelections.find((item) => item.role === 'oil')!.lotId, null);
  await preview(p); assert.equal(p.cooking.status().canCook, true); await p.send(LOAD);
  assert.equal(p.cooking.confirmCommand(), null); assert.equal(p.cooking.status().result, null);
  assert.equal(p.cooking.status().inputSelections.find((item) => item.role === 'main')!.lotId, null);
});

test('missing or mismatched cooking preview summaries cannot revive earlier success', async (t) => {
  for (const mode of ['missing', 'mismatched']) {
    let corrupt = false;
    const p = await cookingProbe(undefined, async (command, next) => {
      const result = await next(); if (!corrupt || command.name !== 'menu_preview') return result;
      const copy = structuredClone(result);
      if (mode === 'missing') Reflect.set(copy.command_result.snapshot!.menu!, 'last_preview_result', null);
      else Reflect.set(copy.command_result.snapshot!.menu!.last_preview_result!, 'action_type', 'split_lot');
      return copy;
    });
    t.after(() => p.lifetime.dispose()); await p.harvest(); setup(p); await preview(p); const before = await p.capture(); corrupt = true;
    await assert.rejects(preview(p), /ERR_COCOS_PROBE_ACTION_SUMMARY_MISSING_OR_MISMATCHED/);
    assert.equal(p.cooking.status().preview, null); assert.equal(p.cooking.confirmCommand(), null); assert.equal(await p.capture(), before);
    corrupt = false; await preview(p); assert.equal(p.cooking.status().canCook, true);
  }
});

test('a stale pending cooking preview receipt is rejected after an edit', async (t) => {
  const p = await cookingProbe(); t.after(() => p.lifetime.dispose()); await p.harvest(); setup(p);
  const command = p.cooking.previewCommand()!; const result = await p.interaction.execute(command); assert.ok(result);
  p.cooking.setActiveMinutes('9'); p.cooking.acceptCookingResult(command, result);
  assert.equal(p.cooking.status().preview, null); assert.equal(p.cooking.confirmCommand(), null);
});

test('controlled legal fuel shortage and wrong formal quantity unit preserve the complete save', async (t) => {
  const p = await cookingProbe(); t.after(() => p.lifetime.dispose()); await p.harvest(); setup(p);
  const command = p.cooking.previewCommand()!;
  assert.ok(command.name === 'menu_preview' && command.selection.action_type === 'cook_dish');
  const selection = command.selection;
  const recipe = p.cooking.status().recipeOptions.find((recipe) => recipe.id === selection.recipe_option_id)!;
  const target = p.cooking.status().targetOptions.find((target) => target.id === selection.target_storage_option_id)!;
  const parameters = new CocosActionDraftBuilder().cookDish(recipe.id,
    Object.fromEntries(Object.entries(selection.ingredient_options).map(([role, ingredient]) => [role, { lot_id: ingredient.lot_option_id, quantity: { ...ingredient.quantity } }])),
    recipe.technique, selection.operation_profile, { location_id: target.location_id, storage_type: target.storage_type, container_id: target.id }).parameters;
  const before = await p.capture();
  const wrongUnit = structuredClone(parameters); wrongUnit.ingredients.side!.quantity.unit = 'ml';
  assert.equal(p.session().preview('cook_dish', wrongUnit).success, false);
  assert.equal(p.session().dispatch('cook_dish', wrongUnit).success, false); assert.equal(await p.capture(), before);
  // Schema-valid controlled save loaded through the public port; this is not a normal browser gameplay claim.
  const saved = JSON.parse(before!) as SaveFile;
  const fuel = saved.fuel_state[recipe.fuel!.base_id] as { quantity: { amount: number; unit: string } };
  fuel.quantity.amount = 0; await p.storage.write('web_probe', JSON.stringify(saved)); await p.send(LOAD);
  assert.equal(p.interaction.status().operation.status, 'completed', 'controlled shortage must first be accepted as a valid save');
  const shortage = await p.capture();
  assert.equal(p.session().preview('cook_dish', parameters).status_code, 'ERR_NOT_ENOUGH_FUEL');
  assert.equal(p.session().dispatch('cook_dish', parameters).status_code, 'ERR_NOT_ENOUGH_FUEL'); assert.equal(await p.capture(), shortage);
  const recovered = JSON.parse(shortage!) as SaveFile;
  (recovered.fuel_state[recipe.fuel!.base_id] as { quantity: { amount: number } }).quantity.amount = 1;
  await p.storage.write('web_probe', JSON.stringify(recovered)); await p.send(LOAD);
  await preview(p); await cook(p); assert.ok(p.cooking.status().result); assert.equal(p.cooking.status().recipeOptions[0]!.fuel!.current_quantity.amount, 0);
});

test('busy cooking admits one confirm and disposal prevents a late receipt from restoring the former view', async () => {
  let release!: () => void; let reached!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; }); const entered = new Promise<void>((resolve) => { reached = resolve; });
  const p = await cookingProbe(undefined, async (command, next) => { const result = await next();
    if (command.name === 'menu_confirm' && command.selection.action_type === 'cook_dish') { reached(); await held; } return result; });
  try {
    await p.harvest(); setup(p); await preview(p);
    const command = p.cooking.confirmCommand()!; const calls = p.calls(); const pending = p.send(command); await entered;
    assert.equal(await p.send(command), null); assert.equal(p.calls(), calls + 1);
    assert.equal(p.session().getSelectableViewModel().submittable_dish_lot_options.length, 1);
    assert.equal(p.session().getSelectableViewModel().cookable_recipe_options[0]!.fuel!.current_quantity.amount, 14);
    p.cooking.invalidatePreview(); await p.lifetime.dispose(); release(); await pending;
    assert.equal(p.cooking.status().result, null); assert.equal(p.cooking.confirmCommand(), null);
  } finally { release(); await p.lifetime.dispose(); }
});

test('a committed cooking completion cannot claim an unrelated existing DishLot or automatically retry', async (t) => {
  let wrongDish: string | null = null;
  const p = await cookingProbe(undefined, async (command, next) => {
    const result = await next();
    if (wrongDish && command.name === 'menu_confirm' && command.selection.action_type === 'cook_dish') {
      const copy = structuredClone(result);
      Reflect.set(copy.command_result.snapshot!.menu!.last_action_result!, 'created_objects', [{ object_type: 'DishLot', object_id: wrongDish }]); return copy;
    }
    return result;
  }); t.after(() => p.lifetime.dispose()); await p.harvest(); setup(p); await preview(p); await cook(p);
  wrongDish = p.cooking.status().result!.dishLotId;
  input(p, 'main', '250'); input(p, 'side', '50'); await preview(p); const calls = p.calls();
  await assert.rejects(cook(p), /ERR_COCOS_PROBE_COOKING_RESULT_MISSING_OR_MISMATCHED/);
  assert.equal(p.interaction.status().operation.status, 'failed', 'an invalid dish receipt must not retain completed operation feedback');
  assert.equal(p.calls(), calls + 1); assert.equal(p.cooking.status().result, null); assert.equal(p.cooking.confirmCommand(), null);
  assert.equal(p.session().getSelectableViewModel().submittable_dish_lot_options.length, 2);
  assert.equal(p.session().getSelectableViewModel().cookable_recipe_options[0]!.fuel!.current_quantity.amount, 13);
  wrongDish = null; await p.send(SAVE);
  assert.equal(p.session().getSelectableViewModel().submittable_dish_lot_options.length, 2, 'healthy later commands must not replay cooking');
});
