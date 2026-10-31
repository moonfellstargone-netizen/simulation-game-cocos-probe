import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProbeInventory } from '../apps/cocos-probe/template/assets/scripts/ProbeInventory';
import { ProbeInteraction } from '../apps/cocos-probe/template/assets/scripts/ProbeInteraction';
import { ProbeLifetime, type ProbeCommand, type ProbeMenuSnapshot } from '../apps/cocos-probe/template/assets/scripts/ProbeLifetime';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot } from '../src/game-core';

const DAY = { name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 1440 } } as const;
const SAVE = { name: 'save', selection: { slot_id: 'web_probe' } } as const;
const LOAD = { name: 'load', selection: { slot_id: 'web_probe' } } as const;

async function publicInventory() {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  const inventory = new ProbeInventory();
  let host: CocosSessionHost | null = null;
  let lastMenu: ProbeMenuSnapshot | null = null;
  let calls = 0;
  const lifetime = new ProbeLifetime({
    loadResources: async () => ({ snapshot, buildId: 'web_inventory_contract', schemas: Object.fromEntries(snapshot.schema_paths.map((path) => [path,
      JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))])) }),
    createHost: (input) => {
      host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot,
        storage: new InMemorySaveStoragePort(), nowIso8601: '2026-10-31T00:00:00.000Z' });
      return host;
    },
    createBinding: (current) => new QinglanUiSceneProbeComponent(current as CocosSessionHost, {
      applyNodeBindingPatch: (patch) => {
        if (patch.section === 'menu') { lastMenu = patch.payload as ProbeMenuSnapshot; inventory.refresh(lastMenu); }
      }
    })
  });
  const interaction = new ProbeInteraction({ isAvailable: () => !lifetime.isDisposed() && lifetime.status().phase === 'ready',
    execute: (command) => { calls++; return lifetime.execute(command); }, onChange: () => {} });
  await lifetime.start();
  return { lifetime, interaction, inventory, calls: () => calls,
    session: () => host!.requireSession(), menu: () => lastMenu! };
}

type PublicInventory = Awaited<ReturnType<typeof publicInventory>>;

function choose(p: PublicInventory, lotId: string, targetId: string) {
  const initial = p.inventory.status();
  for (let i = 0; p.inventory.status().selectedLotId !== lotId && i <= initial.lotOptions.length; i++) p.inventory.selectNextLot();
  for (let i = 0; p.inventory.status().selectedTargetId !== targetId && i <= initial.targetOptions.length; i++) p.inventory.selectNextTarget();
  assert.equal(p.inventory.status().selectedLotId, lotId);
  assert.equal(p.inventory.status().selectedTargetId, targetId);
  const command = p.inventory.moveCommand();
  assert.ok(command, 'explicit enabled non-current selections must produce a move command');
  return command;
}

function compatiblePair(p: PublicInventory) {
  const view = p.inventory.status();
  const lot = view.lotOptions.find((item) => item.enabled && view.targetOptions.some((target) => target.enabled
    && target.id !== item.storage_ref.container_id && target.supported_forms.includes(item.current_form)));
  assert.ok(lot);
  const target = view.targetOptions.find((item) => item.enabled && item.id !== lot.storage_ref.container_id && item.supported_forms.includes(lot.current_form));
  assert.ok(target);
  return { lot, target };
}

async function harvestOne(p: PublicInventory) {
  const selectable = p.session().getSelectableViewModel();
  const field = selectable.field_options.find((item) => item.enabled);
  const seed = selectable.seed_lot_options.find((item) => item.enabled);
  assert.ok(field && seed);
  await p.interaction.execute({ name: 'menu_confirm', selection: { action_type: 'plant_crop', field_option_id: field.id,
    seed_lot_option_id: seed.id, seed_quantity: { amount: 1, unit: seed.quantity.unit } } });
  assert.equal(p.interaction.status().operation.status, 'completed');
  for (let day = 0; day < 30 && !p.session().getSelectableViewModel().harvestable_crop_options.some((crop) => crop.field_plot_id === field.id); day++) {
    await p.interaction.execute(DAY);
    assert.equal(p.interaction.status().operation.status, 'completed');
  }
  const crop = p.session().getSelectableViewModel().harvestable_crop_options.find((item) => item.field_plot_id === field.id);
  assert.ok(crop, 'normal formal time must eventually expose a harvestable crop');
  const result = await p.interaction.execute({ name: 'menu_confirm', selection: { action_type: 'harvest_crop', crop_option_id: crop.id } });
  assert.equal(p.interaction.status().operation.status, 'completed');
  const lotId = result!.command_result.snapshot!.menu!.last_action_result!.created_objects.find((item) => item.object_type === 'MaterialLot')?.object_id;
  assert.ok(lotId);
  return lotId;
}

test('all current public lots can be browsed without commands, then whole-lot transfer preserves identity, quantity and world time', async (t) => {
  const p = await publicInventory(); t.after(() => p.lifetime.dispose());
  const initial = p.inventory.status();
  assert.equal(initial.selectedLotId, null); assert.equal(initial.selectedTargetId, null); assert.equal(initial.canMove, false);
  const visited = new Set<string>();
  for (let i = 0; i < initial.lotOptions.length; i++) { p.inventory.selectNextLot(); visited.add(p.inventory.status().selectedLotId!); }
  assert.deepEqual([...visited].sort(), initial.lotOptions.map((lot) => lot.id).sort(), 'browsing includes every public lot, not only the last three');
  assert.equal(p.calls(), 0); assert.equal(p.interaction.status().operation.sequence, 0);
  assert.deepEqual(p.inventory.status().lotOptions, initial.lotOptions);
  const { lot, target } = compatiblePair(p);
  const command = choose(p, lot.id, target.id);
  const before = p.inventory.status(); const timeBefore = p.lifetime.status().timeLabel;
  const result = await p.interaction.execute(command);
  assert.equal(result!.command_result.status, 'completed');
  assert.equal(p.interaction.status().operation.status, 'completed');
  assert.equal(p.interaction.status().operation.message, '整批转移成功');
  const after = p.inventory.status(); const moved = after.lotOptions.find((item) => item.id === lot.id)!;
  assert.deepEqual({ ...moved, storage_ref: lot.storage_ref }, lot, 'only the storage reference changes in the material projection');
  assert.deepEqual(moved.storage_ref, { location_id: target.location_id, storage_type: target.storage_type, container_id: target.id });
  assert.equal(p.lifetime.status().timeLabel, timeBefore); assert.equal(p.calls(), 1);
  const sourceBefore = before.targetOptions.find((item) => item.id === lot.storage_ref.container_id)!;
  const sourceAfter = after.targetOptions.find((item) => item.id === lot.storage_ref.container_id)!;
  const targetAfter = after.targetOptions.find((item) => item.id === target.id)!;
  assert.ok(sourceAfter.used_capacity < sourceBefore.used_capacity);
  assert.ok(targetAfter.used_capacity > target.used_capacity);
  assert.equal(sourceBefore.used_capacity - sourceAfter.used_capacity, targetAfter.used_capacity - target.used_capacity);
  assert.equal(after.canMove, false, 'the UI prevents resubmitting to the current container');
  assert.equal(p.inventory.moveCommand(), null);
});

test('form rejection and missing selections preserve public state and a healthy move recovers', async (t) => {
  const p = await publicInventory(); t.after(() => p.lifetime.dispose());
  const initial = p.inventory.status();
  const lot = initial.lotOptions.find((item) => item.enabled && initial.targetOptions.some((target) => target.enabled
    && target.id !== item.storage_ref.container_id && !target.supported_forms.includes(item.current_form)));
  assert.ok(lot);
  const target = initial.targetOptions.find((item) => item.enabled && item.id !== lot.storage_ref.container_id && !item.supported_forms.includes(lot.current_form))!;
  const command = choose(p, lot.id, target.id);
  assert.equal(p.inventory.status().canMove, true, 'outer does not replace formal form validation');
  const before = p.session().getSelectableViewModel(); const timeBefore = p.lifetime.status().timeLabel;
  const rejected = await p.interaction.execute(command);
  assert.equal(rejected!.command_result.status, 'completed', 'queue completion remains distinct from preview rejection');
  assert.equal(rejected!.command_result.snapshot!.menu!.last_preview_result!.success, false);
  assert.equal(p.interaction.status().operation.status, 'failed');
  assert.match(p.interaction.status().operation.errorMessage!, /^ERR_STORAGE_FORM_NOT_SUPPORTED/);
  assert.equal(p.interaction.status().operation.message, '该位置不支持这种物料形态');
  assert.deepEqual(p.session().getSelectableViewModel(), before); assert.equal(p.lifetime.status().timeLabel, timeBefore);
  const missing = await p.interaction.execute({ name: 'menu_confirm', selection: {
    action_type: 'store_item', source_lot_option_id: 'not_a_current_public_lot', target_storage_option_id: target.id
  } });
  assert.equal(missing!.command_result.status, 'failed'); assert.equal(p.interaction.status().operation.status, 'failed');
  assert.deepEqual(p.session().getSelectableViewModel(), before);
  const healthy = compatiblePair(p); await p.interaction.execute(choose(p, healthy.lot.id, healthy.target.id));
  assert.equal(p.interaction.status().operation.status, 'completed');
});

test('manual loading restores moved location and current choices, and clears a lot absent from the loaded world', async (t) => {
  const p = await publicInventory(); t.after(() => p.lifetime.dispose());
  const { lot, target } = compatiblePair(p);
  await p.interaction.execute(choose(p, lot.id, target.id));
  await p.interaction.execute(SAVE);
  const saved = p.inventory.status(); const savedTime = p.lifetime.status().timeLabel;
  await p.interaction.execute(choose(p, lot.id, lot.storage_ref.container_id));
  assert.equal(p.interaction.status().operation.status, 'completed');
  await p.interaction.execute(LOAD);
  assert.equal(p.interaction.status().operation.message, '已恢复本地存档');
  assert.deepEqual(p.inventory.status().lotOptions, saved.lotOptions);
  assert.deepEqual(p.inventory.status().targetOptions, saved.targetOptions);
  assert.equal(p.lifetime.status().timeLabel, savedTime);
  assert.equal(p.inventory.status().selectedLotId, lot.id, 'a still-existing identity is refreshed rather than guessed');
  assert.equal(p.inventory.status().selectedTargetId, lot.storage_ref.container_id);
  assert.equal(p.inventory.status().canMove, true, 'move eligibility uses the restored source location');
  const newLotId = await harvestOne(p);
  choose(p, newLotId, target.id);
  await p.interaction.execute(LOAD);
  assert.equal(p.inventory.status().selectedLotId, null);
  assert.equal(p.inventory.status().canMove, false);
  assert.equal(p.inventory.moveCommand(), null);
  assert.deepEqual(p.inventory.status().lotOptions, saved.lotOptions);
  assert.equal(p.interaction.status().operation.message, '已恢复本地存档', 'old menu success must not replace the load-specific result');
});

test('ordinary harvests naturally reach a partially free target that rejects an oversized whole lot without mutation', async (t) => {
  const p = await publicInventory(); t.after(() => p.lifetime.dispose());
  let targetId: string | null = null; let successes = 0; let rejected = false;
  for (let cycle = 0; cycle < 5; cycle++) {
    const lotId = await harvestOne(p); const view = p.inventory.status();
    const lot = view.lotOptions.find((item) => item.id === lotId)!;
    targetId ??= view.targetOptions.find((item) => item.enabled && item.id !== lot.storage_ref.container_id && item.supported_forms.includes(lot.current_form))?.id ?? null;
    assert.ok(targetId);
    const target = view.targetOptions.find((item) => item.id === targetId)!;
    assert.ok(target.enabled && target.used_capacity < target.capacity.amount, 'the refusal case must have a target that appears non-full');
    const before = p.session().getSelectableViewModel(); const timeBefore = p.lifetime.status().timeLabel;
    const result = await p.interaction.execute(choose(p, lotId, targetId));
    if (p.interaction.status().operation.status === 'failed') {
      assert.ok(successes > 0, 'ordinary whole-lot transfers first occupy the target');
      assert.equal(result!.command_result.status, 'completed');
      assert.equal(result!.command_result.snapshot!.menu!.last_preview_result!.success, false);
      assert.match(p.interaction.status().operation.errorMessage!, /^ERR_STORAGE_CAPACITY_OVERFLOW/);
      assert.equal(p.interaction.status().operation.message, '储存容量不足，请选择其他位置');
      assert.deepEqual(p.session().getSelectableViewModel(), before);
      assert.equal(p.lifetime.status().timeLabel, timeBefore);
      rejected = true;
      break;
    }
    successes++;
  }
  assert.equal(rejected, true, 'the canonical new game can reach real capacity refusal without changing config or fixtures');
  const current = p.inventory.status(); const destination = current.targetOptions.find((item) => item.id === targetId)!;
  const smallLot = current.lotOptions.find((item) => item.enabled && item.storage_ref.container_id !== targetId && destination.supported_forms.includes(item.current_form));
  assert.ok(smallLot);
  await p.interaction.execute(choose(p, smallLot.id, destination.id));
  assert.equal(p.interaction.status().operation.status, 'completed', 'a healthy smaller whole-lot transfer still succeeds after refusal');
});

test('detached inventory views keep disabled choices readable, prevent invalid moves and clear missing IDs', async (t) => {
  const p = await publicInventory(); t.after(() => p.lifetime.dispose());
  const { lot, target } = compatiblePair(p); choose(p, lot.id, target.id);
  const observation = p.inventory.status();
  Reflect.set(observation.lotOptions[0].quantity, 'amount', -1);
  Reflect.set(observation.targetOptions[0], 'used_capacity', -1);
  assert.ok(p.inventory.status().lotOptions[0].quantity.amount > 0);
  assert.ok(p.inventory.status().targetOptions[0].used_capacity >= 0);
  const menu = structuredClone(p.menu());
  const disabledLot = menu.selectable_view_model!.splittable_lot_options.find((item) => item.id === lot.id)!;
  Reflect.set(disabledLot, 'enabled', false);
  p.inventory.refresh(menu);
  assert.equal(p.inventory.status().selectedLotId, lot.id, 'disabled lots remain inspectable');
  assert.equal(p.inventory.status().canMove, false); assert.equal(p.inventory.moveCommand(), null);
  Reflect.set(disabledLot, 'enabled', true);
  const disabledTarget = menu.selectable_view_model!.storage_target_options.find((item) => item.id === target.id)!;
  Reflect.set(disabledTarget, 'enabled', false);
  p.inventory.refresh(menu);
  assert.equal(p.inventory.status().selectedTargetId, target.id, 'a full location remains inspectable');
  assert.equal(p.inventory.moveCommand(), null);
  p.inventory.refresh({ selectable_view_model: null });
  assert.deepEqual(p.inventory.status(), { lotOptions: [], targetOptions: [], selectedLotId: null, selectedTargetId: null, canMove: false });
});
