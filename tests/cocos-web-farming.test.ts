import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProbeFarming } from '../apps/cocos-probe/template/assets/scripts/ProbeFarming';
import { ProbeInteraction } from '../apps/cocos-probe/template/assets/scripts/ProbeInteraction';
import { ProbeLifetime, type ProbeCommand, type ProbeMenuSnapshot } from '../apps/cocos-probe/template/assets/scripts/ProbeLifetime';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot } from '../src/game-core';

const DAY = { name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 1440 } } as const;
const SAVE = { name: 'save', selection: { slot_id: 'web_probe' } } as const;
const LOAD = { name: 'load', selection: { slot_id: 'web_probe' } } as const;

async function publicFarming() {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  const farming = new ProbeFarming();
  let calls = 0;
  let host: CocosSessionHost | null = null;
  let lastMenu: ProbeMenuSnapshot | null = null;
  const lifetime = new ProbeLifetime({
    loadResources: async () => ({
      snapshot, buildId: 'web_farming_contract', schemas: Object.fromEntries(snapshot.schema_paths.map((path) => [path,
        JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))]))
    }),
    createHost: (input) => {
      host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot,
        storage: new InMemorySaveStoragePort(), nowIso8601: '2026-10-31T00:00:00.000Z' });
      return host;
    },
    createBinding: (current) => new QinglanUiSceneProbeComponent(current as CocosSessionHost, {
      applyNodeBindingPatch: (patch) => {
        if (patch.section === 'menu') {
          lastMenu = patch.payload as ProbeMenuSnapshot;
          farming.refresh(lastMenu);
        }
      }
    })
  });
  const interaction = new ProbeInteraction({
    isAvailable: () => !lifetime.isDisposed() && lifetime.status().phase === 'ready',
    execute: (command) => { calls++; return lifetime.execute(command); },
    onChange: () => {}
  });
  await lifetime.start();
  return { lifetime, interaction, farming, calls: () => calls,
    session: () => host!.requireSession(), menu: () => lastMenu! };
}

function requiredCommand(command: ProbeCommand | null): ProbeCommand {
  assert.ok(command, 'a visible valid selection creates a command');
  return command;
}

function choosePlant(p: Awaited<ReturnType<typeof publicFarming>>) {
  p.farming.selectNextField();
  p.farming.selectNextSeed();
  return requiredCommand(p.farming.plantCommand());
}

async function growUntilPubliclyHarvestable(p: Awaited<ReturnType<typeof publicFarming>>) {
  // A bounded test loop observes the formal ready list; it does not introduce a growth duration.
  for (let day = 0; day < 10 && p.farming.status().harvestableOptions.length === 0; day++) {
    await p.interaction.execute(DAY);
    assert.equal(p.interaction.status().operation.status, 'completed');
    assert.equal(p.interaction.status().operation.message, '已推进一天');
  }
  assert.ok(p.farming.status().harvestableOptions.length > 0, 'formal time progression produces a public harvest option');
}

test('explicit public selections plant, advance and harvest through the real component without selection commands', async (t) => {
  const p = await publicFarming();
  t.after(() => p.lifetime.dispose());
  assert.equal(p.farming.status().selectedFieldId, null);
  assert.equal(p.farming.status().selectedSeedId, null);
  assert.equal(p.farming.plantCommand(), null);
  assert.equal(p.farming.harvestCommand(), null);
  const plant = choosePlant(p);
  assert.equal(plant.name, 'menu_confirm');
  if (plant.name !== 'menu_confirm' || plant.selection.action_type !== 'plant_crop') throw new Error('plant command expected');
  const fieldId = plant.selection.field_option_id;
  const seedId = plant.selection.seed_lot_option_id;
  const seedBefore = p.farming.status().seedOptions.find((option) => option.id === seedId)!;
  p.farming.adjustSeedAmount(1);
  const requested = requiredCommand(p.farming.plantCommand());
  assert.equal(p.calls(), 0, 'selection and quantity controls do not enqueue formal operations');
  assert.equal(p.interaction.status().operation.sequence, 0);
  await p.interaction.execute(requested);
  assert.equal(p.interaction.status().operation.status, 'completed');
  assert.equal(p.interaction.status().operation.message, '播种成功');
  const afterPlant = p.farming.status();
  assert.equal(afterPlant.seedOptions.find((option) => option.id === seedId)?.quantity.amount, seedBefore.quantity.amount - 2);
  assert.equal(afterPlant.seedOptions.find((option) => option.id === seedId)?.quantity.unit, seedBefore.quantity.unit);
  assert.equal(afterPlant.fieldOptions.find((option) => option.id === fieldId)?.enabled, false);
  assert.equal(afterPlant.fieldOptions.find((option) => option.id === fieldId)?.occupied_tiles, 1);
  assert.equal(afterPlant.selectedFieldId, null, 'a newly occupied selection is invalidated');
  assert.equal(afterPlant.selectedSeedId, seedId);
  assert.equal(p.farming.harvestCommand(), null, 'a growing crop is not a fabricated ready option');
  await growUntilPubliclyHarvestable(p);
  p.farming.selectNextCrop();
  const ready = p.farming.status();
  const cropId = ready.selectedCropId;
  assert.ok(ready.harvestableOptions.some((option) => option.id === cropId && option.field_plot_id === fieldId));
  const result = await p.interaction.execute(requiredCommand(p.farming.harvestCommand()));
  assert.equal(p.interaction.status().operation.message, '收获成功');
  assert.equal(p.interaction.status().operation.status, 'completed');
  const createdLots = result!.command_result.snapshot!.menu!.last_action_result!.created_objects.filter((item) => item.object_type === 'MaterialLot');
  assert.ok(createdLots.length > 0);
  const current = p.farming.status();
  for (const lot of createdLots) {
    const actual = current.materialOptions.find((option) => option.id === lot.object_id);
    assert.ok(actual && actual.quantity.amount > 0, 'show actual public material quantity, not lot count');
    assert.ok(lot.summary?.quantity, 'the formal ActionResult declares the harvested quantity');
    assert.deepEqual(actual.quantity, lot.summary.quantity, 'public inventory matches the committed result quantity and unit');
    const before = ready.materialOptions.find((option) => option.id === lot.object_id);
    assert.equal(before, undefined, 'the produced lot was absent before harvesting');
  }
  assert.equal(current.fieldOptions.find((option) => option.id === fieldId)?.enabled, true);
  assert.equal(current.fieldOptions.find((option) => option.id === fieldId)?.occupied_tiles, 0);
  assert.equal(current.selectedCropId, null);
  assert.ok(!current.harvestableOptions.some((option) => option.id === cropId));
  p.farming.selectNextField();
  assert.ok(p.farming.plantCommand(), 'the released field can start the next farming cycle');
});

test('loading a growing save invalidates a formerly ready crop and can continue the real farming cycle', async (t) => {
  const p = await publicFarming();
  t.after(() => p.lifetime.dispose());
  await p.interaction.execute(choosePlant(p));
  const saved = p.farming.status();
  const savedTime = p.lifetime.status().timeLabel;
  await p.interaction.execute(SAVE);
  await growUntilPubliclyHarvestable(p);
  p.farming.selectNextCrop();
  assert.ok(p.farming.status().selectedCropId);
  await p.interaction.execute(LOAD);
  assert.equal(p.interaction.status().operation.message, '已恢复本地存档');
  assert.equal(p.interaction.status().operation.status, 'completed');
  assert.equal(p.lifetime.status().timeLabel, savedTime);
  assert.deepEqual(p.farming.status().fieldOptions, saved.fieldOptions);
  assert.deepEqual(p.farming.status().seedOptions, saved.seedOptions);
  assert.deepEqual(p.farming.status().materialOptions, saved.materialOptions);
  assert.equal(p.farming.status().selectedCropId, null);
  assert.equal(p.farming.harvestCommand(), null);
  assert.equal(p.farming.status().selectedSeedId, saved.selectedSeedId, 'a valid identity is retained with newly read quantity');
  await growUntilPubliclyHarvestable(p);
  p.farming.selectNextCrop();
  await p.interaction.execute(requiredCommand(p.farming.harvestCommand()));
  assert.equal(p.interaction.status().operation.message, '收获成功');
  p.farming.selectNextField();
  assert.ok(p.farming.status().selectedFieldId);
  await p.interaction.execute(LOAD);
  assert.equal(p.farming.status().selectedFieldId, null, 'restored occupancy invalidates the current field selection');
  assert.deepEqual(p.farming.status().seedOptions, saved.seedOptions);
  assert.deepEqual(p.farming.status().materialOptions, saved.materialOptions);
  assert.equal(p.interaction.status().operation.message, '已恢复本地存档', 'old menu results do not replace this load feedback');
});

test('oversized quantity and a stale harvested ID are refused without mutation, then healthy public operations recover', async (t) => {
  const p = await publicFarming();
  t.after(() => p.lifetime.dispose());
  choosePlant(p);
  const before = p.farming.status();
  const seed = before.seedOptions.find((option) => option.id === before.selectedSeedId)!;
  p.farming.adjustSeedAmount(seed.quantity.amount);
  const refusal = await p.interaction.execute(requiredCommand(p.farming.plantCommand()));
  assert.equal(refusal!.command_result.status, 'completed');
  assert.equal(p.interaction.status().operation.status, 'failed');
  assert.equal(p.interaction.status().operation.errorMessage, 'ERR_NOT_ENOUGH_RESOURCE');
  assert.deepEqual(p.farming.status().fieldOptions, before.fieldOptions);
  assert.deepEqual(p.farming.status().seedOptions, before.seedOptions);
  assert.deepEqual(p.farming.status().materialOptions, before.materialOptions);
  p.farming.adjustSeedAmount(-seed.quantity.amount);
  await p.interaction.execute(requiredCommand(p.farming.plantCommand()));
  await growUntilPubliclyHarvestable(p);
  p.farming.selectNextCrop();
  const harvest = requiredCommand(p.farming.harvestCommand());
  await p.interaction.execute(harvest);
  const harvested = p.farming.status();
  const stale = await p.interaction.execute(harvest);
  assert.equal(stale!.command_result.status, 'failed');
  assert.equal(p.interaction.status().operation.status, 'failed');
  assert.match(p.interaction.status().operation.errorMessage!, /ERR_MENU_OPTION_NOT_FOUND/);
  assert.deepEqual(p.farming.status(), harvested);
  await p.interaction.execute(DAY);
  assert.equal(p.interaction.status().operation.status, 'completed');
});

test('selection observations are detached, failed choices clear, and quantity controls do not infer identity or units', async (t) => {
  const p = await publicFarming();
  t.after(() => p.lifetime.dispose());
  const menu = structuredClone(p.menu());
  const farming = new ProbeFarming();
  farming.refresh(menu);
  farming.selectNextField();
  farming.selectNextSeed();
  const selected = farming.status();
  assert.ok(selected.selectedFieldId && selected.selectedSeedId);
  Reflect.set(selected.fieldOptions[0], 'enabled', false);
  Reflect.set(selected.seedOptions[0].quantity, 'amount', -1);
  assert.deepEqual(farming.status().fieldOptions, p.farming.status().fieldOptions);
  assert.deepEqual(farming.status().seedOptions, p.farming.status().seedOptions);
  const inputSeed = menu.selectable_view_model!.seed_lot_options.find((option) => option.id === selected.selectedSeedId)!;
  Reflect.set(inputSeed.quantity, 'amount', inputSeed.quantity.amount + 7);
  Reflect.set(inputSeed.quantity, 'unit', 'bundle');
  farming.refresh(menu);
  const command = requiredCommand(farming.plantCommand());
  assert.equal(command.name, 'menu_confirm');
  if (command.name !== 'menu_confirm' || command.selection.action_type !== 'plant_crop') throw new Error('plant command expected');
  assert.equal(command.selection.seed_quantity.unit, 'bundle', 'units come from the selected public lot');
  const amount = farming.status().seedAmount;
  farming.adjustSeedAmount(NaN);
  farming.adjustSeedAmount(Infinity);
  farming.adjustSeedAmount(0.5);
  farming.adjustSeedAmount(Number.MAX_SAFE_INTEGER);
  assert.equal(farming.status().seedAmount, amount);
  farming.adjustSeedAmount(-10);
  assert.equal(farming.status().seedAmount, 1);
  const inputField = menu.selectable_view_model!.field_options.find((option) => option.id === selected.selectedFieldId)!;
  Reflect.set(inputField, 'enabled', false);
  Reflect.set(inputSeed, 'enabled', false);
  farming.refresh(menu);
  assert.equal(farming.status().selectedFieldId, null);
  assert.equal(farming.status().selectedSeedId, null);
  assert.equal(farming.plantCommand(), null);
  farming.refresh({ selectable_view_model: null });
  assert.deepEqual(farming.status().fieldOptions, []);
  assert.deepEqual(farming.status().materialOptions, []);
  assert.equal(farming.harvestCommand(), null);
});
