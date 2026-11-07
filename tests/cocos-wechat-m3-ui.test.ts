import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { WechatProbeController } from '../apps/cocos-wechat-probe/template/assets/scripts/WechatProbeController';
import { WechatSaveStoragePort } from '../apps/cocos-wechat-probe/template/assets/scripts/WechatSaveStoragePort';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import type { RuntimeConfigSnapshot } from '../src/game-core';
import { deriveBuildId } from '../tools/quality/lib/versionSurface.mjs';

// The actual outer methods and controller use real Session, Binding, Queue and ActionPipeline;
// only Creator rendering and platform storage are controlled here.
test('M3 real outer selections drive plant, harvest and whole-lot move, and loading clears stale choices', async () => {
  const bundled = await build({ entryPoints: ['apps/cocos-wechat-probe/template/assets/scripts/CocosWechatProbe.ts'],
    bundle: true, write: false, platform: 'node', format: 'esm',
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    plugins: [{ name: 'cc-test-port', setup(builder) {
      builder.onResolve({ filter: /^cc$/ }, () => ({ path: 'cc', namespace: 'test-port' }));
      builder.onResolve({ filter: /generated\/probe-runtime\.js$/ }, () => ({ path: 'runtime', namespace: 'test-port' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-port' }, args => ({ contents: args.path === 'cc'
        ? `export class Component { constructor() { this.node = {}; } }
           export const _decorator = { ccclass: () => value => value }; export const isValid = () => true;
           export const Button = {}, Camera = {}, Canvas = {}, Color = {}, EditBox = {}, Game = {}, game = {}, Graphics = {}, JsonAsset = {}, Label = {}, Layers = {}, Node = {}, resources = {}, ResolutionPolicy = {}, screen = {}, sys = {}, UITransform = {}, view = {};`
        : 'export const createStage1AHost = () => {}; export class QinglanUiSceneProbeComponent {}', loader: 'js' }));
    } }]
  });
  const { CocosWechatProbe } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0]!.text).toString('base64'));
  const probe = new CocosWechatProbe();
  probe.labels = Object.fromEntries(['candidate', 'commit', 'time', 'status', 'result', 'hint', 'farmField', 'farmSeed', 'farmCrop', 'stockLot', 'stockTarget', 'stockHelp', 'splitLot', 'splitUnit', 'splitPreview', 'processingMethod', 'processingRequirement', 'processingLot', 'processingFacility', 'processingTask', 'processingOutput'].map(name => [name, { string: '' }]));
  probe.farmNode = { active: true }; probe.stockNode = { active: false }; probe.splitNode = { active: false };
  probe.splitInput = { string: '', enabled: false, focused: false, isFocused() { return this.focused; }, blur() { this.focused = false; } };
  probe.processingNode = { active: false }; probe.processingTasksNode = { active: false };
  probe.processingInput = { string: '', enabled: false, focused: false, isFocused() { return this.focused; }, blur() { this.focused = false; } };
  const names = ['PageFarm', 'PageStock', 'PageProcessing', 'AdvanceDay', 'FarmField', 'FarmSeed', 'FarmCrop', 'FarmMinus', 'FarmPlus', 'FarmPlant', 'FarmHarvest', 'StockLot', 'StockTarget', 'StockMove', 'StockSplit', 'SplitBack', 'SplitPreview', 'SplitConfirm', 'ProcessingMethod', 'ProcessingRequirement', 'ProcessingLot', 'ProcessingSlot', 'ProcessingTasks', 'ProcessingFacility', 'ProcessingTask', 'ProcessingBack', 'ProcessingPreview', 'ProcessingStart', 'ProcessingCollect'];
  probe.menuButtons = Object.fromEntries(names.map(name => [name, { node: {}, interactable: false }]));
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  const schemas = Object.fromEntries(snapshot.schema_paths.map(path => [path, JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))]));
  const target = JSON.parse(readFileSync('tools/quality/rules/project-target.json', 'utf8'));
  const buildId = deriveBuildId('cocos_wechat_probe', target.version.snakeVersion);
  const identity = { schema: 'wechat-candidate/v1', candidate_id: 'wechat-11111111-1111-1111-1111-111111111111', source_commit: 'a'.repeat(40), short_commit: 'a'.repeat(12), version: target.version.codePackageVersion, build_id: buildId };
  const values = new Map<string, string>();
  const platform = { get length() { return values.size; }, key(i: number) { return Array.from(values.keys())[i] ?? null; }, getItem(k: string) { return values.get(k) ?? null; }, setItem(k: string, v: string) { values.set(k, v); }, removeItem(k: string) { values.delete(k); } };
  const storage = new WechatSaveStoragePort(() => platform, async () => {});
  let hold = false; let failSplitPatch = false; let unblock!: () => void;
  let cancellations = 0;
  const submittedCommands: string[] = [];
  let gate = new Promise<void>(resolve => { unblock = resolve; });
  const controller = new WechatProbeController({
    load: async () => ({ resources: { snapshot, schemas, buildId }, identity }),
    createHost: input => createStage1AHost({ snapshot: input.snapshot as RuntimeConfigSnapshot, schemas: input.schemas, buildId, storage, nowIso8601: '2026-11-03T00:00:00.000Z' }),
    createBinding: host => {
      const binding = new QinglanUiSceneProbeComponent(host as CocosSessionHost, { applyNodeBindingPatch: async patch => {
        if (hold) await gate;
        if (patch.section === 'menu' && failSplitPatch) { failSplitPatch = false; throw new Error('injected scene update failure after action'); }
        if (patch.section === 'menu') controller.acceptMenuPatch(patch.payload);
      } });
      return { mount: () => binding.mount(), unmount: () => binding.unmount(), execute: command => {
        submittedCommands.push(command.name);
        return binding.execute(command);
      } };
    },
    cancelFirstFailedSave: async () => { cancellations++; },
    onChange: state => probe.render(state)
  });
  probe.controller = controller;
  const click = (name: string) => probe.menuHandler(name)();
  const waitForIdle = async () => { for (let i = 0; i < 500 && controller.snapshot().busy; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(controller.snapshot().busy, false, 'command completed'); await new Promise(resolve => setImmediate(resolve)); };
  const oldInfo = console.info; console.info = () => {};
  await controller.start();
  try {
    probe.onCancelFirst();
    assert.equal(probe.confirmCancelFirst, true);
    click('PageStock');
    assert.equal(probe.confirmCancelFirst, false, 'changing page cancels the pending confirmation');
    probe.onCancelFirst();
    assert.equal(cancellations, 0, 'first click after changing page never cancels a save');
    probe.onCancelFirst();
    await waitForIdle();
    assert.equal(cancellations, 1, 'a separate second confirmation is required');
    click('PageFarm');
    probe.onCancelFirst();
    click('FarmField');
    assert.equal(probe.confirmCancelFirst, false, 'changing a selection cancels the pending confirmation');
    probe.onCancelFirst();
    assert.equal(cancellations, 1, 'first click after selection never cancels a save');
    probe.onCancelFirst();
    await waitForIdle();
    assert.equal(cancellations, 2, 'selection also requires a fresh second confirmation');
    const initial = controller.snapshot();
    assert.ok(initial.menu?.selectable_view_model?.field_options.some(x => x.enabled));
    assert.equal(probe.menuButtons.FarmPlant.interactable, false);
    const beforeSelect = controller.snapshot().accepted_commands;
    click('FarmField'); click('FarmSeed');
    assert.equal(controller.snapshot().accepted_commands, beforeSelect, 'choosing options dispatches no commands');
    assert.ok(probe.fieldId && probe.seedId);
    assert.equal(probe.menuButtons.FarmPlant.interactable, true);
    const fieldId = probe.fieldId; const seedId = probe.seedId;
    const seedBefore = initial.menu!.selectable_view_model!.seed_lot_options.find(x => x.id === seedId)!.quantity.amount;
    click('FarmPlant'); await waitForIdle();
    assert.equal(controller.snapshot().accepted_commands, beforeSelect + 1);
    const planted = controller.snapshot().menu!.selectable_view_model!;
    assert.equal(planted.field_options.find(x => x.id === fieldId)!.enabled, false);
    assert.equal(planted.seed_lot_options.find(x => x.id === seedId)!.quantity.amount, seedBefore - 1);
    assert.equal(probe.fieldId, null, 'occupied field choice is invalidated');
    await controller.save();
    controller.setVisible(false); const oldPage = probe.page; const accepted = controller.snapshot().accepted_commands;
    click('PageStock'); click('AdvanceDay');
    assert.equal(probe.page, oldPage); assert.equal(controller.snapshot().accepted_commands, accepted);
    controller.setVisible(true);
    hold = true; click('AdvanceDay'); assert.equal(controller.snapshot().busy, true);
    click('FarmField'); click('PageStock'); assert.equal(probe.page, oldPage); assert.equal(controller.snapshot().accepted_commands, accepted + 1);
    hold = false; unblock(); await waitForIdle();
    for (let day = 0; day < 10 && !controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.some(x => x.enabled); day++) { click('AdvanceDay'); await waitForIdle(); }
    const harvestable = controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.find(x => x.enabled && x.field_plot_id === fieldId);
    assert.ok(harvestable);
    for (let i = 0; probe.cropId !== harvestable.id && i < 20; i++) click('FarmCrop');
    assert.equal(probe.cropId, harvestable.id);
    const previousLots = new Set(controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.map(x => x.id));
    const beforeHarvest = controller.snapshot().accepted_commands;
    click('FarmHarvest'); await waitForIdle();
    assert.equal(controller.snapshot().accepted_commands, beforeHarvest + 1);
    assert.equal(probe.cropId, null);
    const menu = controller.snapshot().menu!.selectable_view_model!;
    const pair = menu.splittable_lot_options.flatMap(lot => menu.storage_target_options.map(target => ({ lot, target }))).find(({lot, target}) => !previousLots.has(lot.id) && lot.enabled && target.enabled && target.id !== lot.storage_ref.container_id && target.supported_forms.includes(lot.current_form));
    assert.ok(pair, 'harvested lot has a compatible distinct destination');
    click('PageStock');
    for (let i = 0; probe.lotId !== pair.lot.id && i < menu.splittable_lot_options.length + 1; i++) click('StockLot');
    for (let i = 0; probe.targetId !== pair.target.id && i < menu.storage_target_options.length + 1; i++) click('StockTarget');
    assert.equal(probe.lotId, pair.lot.id); assert.equal(probe.targetId, pair.target.id);
    assert.equal(probe.menuButtons.StockMove.interactable, true);
    const beforeMove = controller.snapshot().accepted_commands;
    click('StockMove'); await waitForIdle();
    assert.equal(controller.snapshot().accepted_commands, beforeMove + 1);
    const moved = controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(x => x.id === pair.lot.id)!;
    assert.equal(moved.storage_ref.container_id, pair.target.id);
    assert.deepEqual(moved.quantity, pair.lot.quantity);
    assert.equal(probe.lotId, pair.lot.id);
    // The input helper models an actual EditBox text-changed event; formal results
    // still come from the real Host/Binding/ActionPipeline.
    const enter = (value: string) => { probe.splitInput.string = value; probe.splitInput.focused = true; probe.onSplitTextChanged(); };
    const preview = async () => { click('SplitPreview'); await waitForIdle(); };
    const selectLot = (id: string) => {
      const count = controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.length;
      for (let i = 0; probe.lotId !== id && i <= count; i++) click('StockLot');
      assert.equal(probe.lotId, id);
    };
    click('StockSplit');
    assert.equal(probe.page, 'split');
    for (const invalid of ['', '0', '-1', 'NaN', '1e309', '2tail', '0x10']) {
      enter(invalid);
      const accepted = controller.snapshot().accepted_commands;
      const before = controller.snapshot().menu;
      click('SplitConfirm');
      assert.equal(controller.snapshot().accepted_commands, accepted, 'invalid input cannot confirm');
      assert.deepEqual(controller.snapshot().menu, before, 'invalid input cannot change inventory');
      assert.match(probe.labels.hint.string, /有效数量/, 'invalid input gives the player an explanation');
    }
    enter('300'); await preview();
    assert.equal(probe.splitInput.focused, false, 'preview closes the active edit box');
    assert.equal(controller.snapshot().split_preview?.success, true);
    assert.equal(probe.menuButtons.SplitConfirm.interactable, true);
    enter('301');
    assert.equal(controller.snapshot().split_preview, null, 'typing invalidates the previous receipt');
    assert.equal(probe.menuButtons.SplitConfirm.interactable, true, 'a new quantity can be confirmed directly');
    enter('300'); await preview();
    click('SplitBack');
    assert.equal(controller.snapshot().split_preview, null, 'leaving the page invalidates the receipt');
    click('StockSplit'); await preview();
    probe.onHide();
    assert.equal(controller.snapshot().split_preview, null, 'background invalidates the receipt');
    probe.onShow();
    assert.equal(probe.menuButtons.SplitConfirm.interactable, true, 'optional preview is not required after returning');
    await preview();
    gate = new Promise<void>(resolve => { unblock = resolve; });
    hold = true; click('SplitPreview');
    assert.equal(controller.snapshot().busy, true);
    probe.onHide(); hold = false; unblock(); await waitForIdle(); probe.onShow();
    assert.equal(controller.snapshot().split_preview, null, 'a preview completed after hiding must not revive');
    assert.equal(probe.menuButtons.SplitConfirm.interactable, true, 'an obsolete preview is not required for direct confirmation');
    click('SplitBack'); click('StockLot');
    assert.notEqual(probe.lotId, pair.lot.id);
    assert.equal(controller.snapshot().split_preview, null, 'changing lot invalidates the receipt');
    assert.equal(probe.splitInput.string, '', 'changing lot clears its previous quantity');
    selectLot(seedId); click('StockSplit');
    const seedBeforeReject = controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(x => x.id === seedId)!.quantity.amount;
    enter('0.5'); await preview();
    assert.equal(controller.snapshot().split_preview?.success, false, 'fractional count is rejected by formal preview');
    assert.equal(controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(x => x.id === seedId)!.quantity.amount, seedBeforeReject);
    assert.equal(probe.menuButtons.SplitConfirm.interactable, true, 'confirmation remains available without a preview');
    const beforeFractionalCount = controller.snapshot().menu!.selectable_view_model;
    const oldError = console.error; console.error = () => {};
    try { click('SplitConfirm'); await waitForIdle(); } finally { console.error = oldError; }
    assert.deepEqual(controller.snapshot().menu!.selectable_view_model, beforeFractionalCount, 'direct fractional count leaves inventory unchanged');
    assert.equal(controller.snapshot().split_result, null, 'invalid count has no successful receipt');
    assert.match(controller.snapshot().last_error ?? '', /ERR_WECHAT_PROBE_ACTION_FAILED:ERR_SPLIT_QUANTITY_INVALID/);
    assert.match(probe.labels.hint.string, /数量不符合单位要求/, 'a definite unit rejection is explained');
    assert.doesNotMatch(probe.labels.hint.string, /待确认/, 'a pre-dispatch rejection is not uncertain');
    enter(String(seedBeforeReject + 1)); await preview();
    assert.equal(controller.snapshot().split_preview?.success, false, 'quantity exceeding available stock is rejected');
    assert.equal(controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(x => x.id === seedId)!.quantity.amount, seedBeforeReject);
    const beforeOverQuantity = controller.snapshot().menu!.selectable_view_model;
    console.error = () => {};
    try { click('SplitConfirm'); await waitForIdle(); } finally { console.error = oldError; }
    assert.deepEqual(controller.snapshot().menu!.selectable_view_model, beforeOverQuantity, 'direct over-quantity confirmation leaves inventory unchanged');
    assert.equal(controller.snapshot().split_result, null, 'rejected confirmation produces no successful receipt');
    assert.doesNotMatch(probe.labels.splitPreview.string, /新增/, 'rejection is never displayed as successful');
    assert.match(controller.snapshot().last_error ?? '', /ERR_WECHAT_PROBE_ACTION_FAILED:ERR_NOT_ENOUGH_RESOURCE/);
    assert.match(probe.labels.hint.string, /数量超过当前库存/, 'a definite over-quantity rejection is explained');
    assert.doesNotMatch(probe.labels.hint.string, /待确认/, 'a pre-dispatch rejection is not uncertain');
    click('SplitBack'); selectLot(pair.lot.id); click('StockSplit');
    const beforeFraction = controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(x => x.id === pair.lot.id)!.quantity.amount;
    enter('0.5');
    assert.equal(controller.snapshot().split_preview, null, 'direct split starts without preview');
    const beforeDirect = controller.snapshot().accepted_commands;
    const beforeDirectCommands = submittedCommands.length;
    gate = new Promise<void>(resolve => { unblock = resolve; });
    hold = true; click('SplitConfirm');
    try {
      assert.equal(controller.snapshot().busy, true);
      click('SplitConfirm');
      assert.equal(controller.snapshot().accepted_commands, beforeDirect + 1, 'a second click while busy does not submit another action');
    } finally { hold = false; unblock(); }
    await waitForIdle();
    assert.deepEqual(submittedCommands.slice(beforeDirectCommands), ['menu_confirm_split_direct'], 'direct confirmation sends no separate preview command');
    const first = controller.snapshot().split_result;
    assert.ok(first, 'direct formal confirmation returns the new lot without prior preview');
    assert.equal(first.quantity.amount, 0.5);
    assert.equal(first.remainingQuantity?.amount, beforeFraction - 0.5);
    assert.equal(first.sourceLotId, pair.lot.id);
    enter('1'); await preview();
    assert.equal(controller.snapshot().split_preview?.success, true, 'optional preview is available');
    enter('2');
    assert.equal(controller.snapshot().split_preview, null, 'changing the input invalidates the optional preview');
    click('SplitConfirm'); await waitForIdle();
    const changed = controller.snapshot().split_result;
    assert.ok(changed, 'changed input is directly confirmed');
    assert.equal(changed.quantity.amount, 2, 'direct confirmation uses the new input rather than the preview quantity');
    assert.equal(changed.remainingQuantity?.amount, first.remainingQuantity!.amount - 2);
    enter(String(changed.remainingQuantity!.amount));
    click('SplitConfirm'); await waitForIdle();
    const full = controller.snapshot().split_result;
    assert.ok(full);
    assert.equal(full.remainingQuantity, null, 'full split removes the exhausted source');
    assert.equal(full.quantity.amount, beforeFraction - 2.5);
    assert.equal(probe.lotId, null, 'removed source selection is cleared');
    click('SplitBack'); selectLot(first.newLotId); click('StockSplit');
    enter('0.5'); await preview();
    assert.equal(controller.snapshot().split_preview?.success, true);
    failSplitPatch = true;
    console.error = () => {};
    try { click('SplitConfirm'); await waitForIdle(); } finally { console.error = oldError; }
    assert.match(controller.snapshot().last_error ?? '', /ERR_WECHAT_SPLIT_RESULT_UNCERTAIN/);
    assert.match(probe.labels.status.string, /待确认/, 'uncertain action result remains explicit in the status area');
    assert.match(probe.labels.status.string, /库存/, 'status tells the player to check the inventory');
    assert.doesNotMatch(probe.labels.status.string, /操作失败|拆分失败/, 'uncertain result must not be presented as a definite failure');
    await controller.load();
    assert.equal(controller.snapshot().split_preview, null, 'reading clears the preview receipt');
    assert.equal(probe.menuButtons.SplitConfirm.interactable, false);
    assert.equal(probe.lotId, null, 'reading the earlier save clears a now-absent selected lot');
    assert.equal(controller.snapshot().identity!.candidate_id, identity.candidate_id);
    assert.equal(controller.snapshot().menu!.selectable_view_model!.field_options.find(x => x.id === fieldId)!.enabled, false);

    // Exercise the actual screen through the public menu and formal pipeline.
    for (let day = 0; day < 30 && !controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.some(x => x.field_plot_id === fieldId); day++) {
      click('AdvanceDay'); await waitForIdle();
    }
    const restoredCrop = controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.find(x => x.field_plot_id === fieldId);
    assert.ok(restoredCrop);
    click('PageFarm'); click('FarmCrop'); click('FarmHarvest'); await waitForIdle();
    click('PageProcessing'); click('ProcessingMethod');
    const choices = controller.snapshot().menu!.selectable_view_model!;
    const method = choices.processing_method_options.find(x => x.id === probe.processingMethodId)!;
    assert.ok(method.input_requirements.length >= 2);
    assert.doesNotMatch(probe.labels.processingMethod.string, /操作.*分/, 'configured operation cost must not imply automatic time advancement');
    assert.match(probe.labels.processingMethod.string, /加工.*分/, 'configured process duration remains visible');
    assert.match(probe.labels.processingRequirement.string, /要求1/);
    assert.match(probe.labels.processingMethod.string, /基础刀具/, 'the actual configured tool has a readable name');
    assert.match(probe.labels.processingRequirement.string, /蔬菜/, 'the actual category has a readable name');
    assert.doesNotMatch(probe.labels.processingMethod.string, /knife_basic/);
    assert.doesNotMatch(probe.labels.processingRequirement.string, /vegetable/);
    click('ProcessingTasks'); click('ProcessingFacility'); click('ProcessingBack');
    assert.match(probe.labels.processingFacility.string, /基础腌菜坛/, 'the actual facility has a readable name');
    assert.doesNotMatch(probe.labels.processingFacility.string, /pickling_jar_basic/);
    console.error = () => {};
    try { click('ProcessingStart'); await waitForIdle(); } finally { console.error = oldError; }
    assert.match(probe.labels.hint.string, /请选择材料并填写数量/, 'empty inputs have a specific actionable message');
    const enterProcessing = (value: string) => { probe.processingInput.string = value; probe.processingInput.focused = true; probe.onProcessingTextChanged(); };
    click('ProcessingLot');
    const firstRequirement = method.input_requirements[0]!;
    probe.onCancelFirst();
    assert.equal(probe.confirmCancelFirst, true);
    enterProcessing(String(firstRequirement.min_quantity?.amount ?? 300));
    assert.equal(probe.confirmCancelFirst, false, 'editing processing quantity cancels the first-save cancellation confirmation');
    const cancellationsBeforeProcessingEdit = cancellations;
    probe.onCancelFirst();
    assert.equal(cancellations, cancellationsBeforeProcessingEdit, 'the next click after editing only requests confirmation');
    probe.resetCancelConfirmation();
    click('ProcessingSlot'); click('ProcessingLot'); enterProcessing('1');
    assert.equal(probe.processingSelection()!.input_lots.length, 2, 'a requirement can include more than one input item');
    while (probe.processingInputs[probe.processingKey()]) click('ProcessingLot');
    assert.equal(probe.processingSelection()!.input_lots.length, 1, 'an extra item can be cleared without changing the first');
    click('ProcessingSlot');
    const beforeRefusal = controller.snapshot().menu!.selectable_view_model!;
    const beforeCommands = submittedCommands.length;
    console.error = () => {};
    try { click('ProcessingStart'); await waitForIdle(); } finally { console.error = oldError; }
    assert.deepEqual(submittedCommands.slice(beforeCommands), ['menu_confirm_processing_direct'], 'missing inputs are independently validated without preview');
    assert.deepEqual(controller.snapshot().menu!.selectable_view_model!.processing_task_options, beforeRefusal.processing_task_options);
    assert.deepEqual(controller.snapshot().menu!.selectable_view_model!.processable_lot_options, beforeRefusal.processable_lot_options);
    assert.match(probe.labels.hint.string, /缺少|不足|未完成/);
    for (let index = 1; index < method.input_requirements.length; index++) {
      click('ProcessingRequirement'); click('ProcessingLot');
      assert.ok(method.input_requirements[index]!.min_quantity);
      enterProcessing(String(method.input_requirements[index]!.min_quantity!.amount));
    }
    click('ProcessingPreview'); await waitForIdle();
    assert.equal(controller.snapshot().processing_preview?.success, true);
    assert.match(probe.labels.hint.string, /预览通过/);
    assert.equal(probe.processingInput.focused, false, 'preview closes the keyboard');
    const inputRequirement = method.input_requirements[method.input_requirements.length - 1]!;
    const updatedAmount = inputRequirement.min_quantity!.amount + 1;
    enterProcessing(String(updatedAmount));
    assert.equal(controller.snapshot().processing_preview, null);
    assert.doesNotMatch(probe.labels.hint.string, /预览通过/, 'editing clears the visible preview success');
    click('ProcessingPreview'); await waitForIdle();
    assert.match(probe.labels.hint.string, /预览通过/);
    const selectedLot = probe.processingInputs[probe.processingKey()].lotId;
    click('ProcessingLot');
    assert.equal(controller.snapshot().processing_preview, null);
    assert.doesNotMatch(probe.labels.hint.string, /预览通过/, 'changing the lot clears the visible preview success');
    for (let i = 0; probe.processingInputs[probe.processingKey()]?.lotId !== selectedLot && i <= inputRequirement.lot_ids.length + 1; i++) click('ProcessingLot');
    assert.equal(probe.processingInputs[probe.processingKey()]?.lotId, selectedLot);
    enterProcessing(String(updatedAmount));
    click('ProcessingPreview'); await waitForIdle();
    gate = new Promise<void>(resolve => { unblock = resolve; });
    hold = true; click('ProcessingPreview');
    assert.equal(controller.snapshot().busy, true);
    const busyMethod = probe.processingMethodId;
    click('ProcessingMethod');
    assert.equal(probe.processingMethodId, busyMethod, 'busy screen blocks further selection');
    controller.setVisible(false);
    assert.equal(controller.snapshot().processing_preview, null, 'background invalidates the processing preview');
    const oldValue = probe.processingInputs[probe.processingKey()].amount;
    enterProcessing('999');
    assert.equal(probe.processingInputs[probe.processingKey()].amount, oldValue, 'background cannot change a processing selection');
    hold = false; unblock(); await waitForIdle();
    assert.equal(controller.snapshot().processing_preview, null, 'late background preview cannot reappear');
    controller.setVisible(true);
    click('ProcessingPreview'); await waitForIdle();
    enterProcessing(String(updatedAmount));
    assert.equal(controller.snapshot().processing_preview, null, 'editing clears stale preview');
    assert.doesNotMatch(probe.labels.hint.string, /预览通过/);
    const amountBeforeStart = controller.snapshot().menu!.selectable_view_model!.processable_lot_options.find(x => x.id === selectedLot)!.quantity.amount;
    const beforeStart = submittedCommands.length;
    const originalConfirm = controller.confirmProcessing.bind(controller);
    let releaseReceipt!: () => void;
    let receiptReady!: () => void;
    let receiptGate = new Promise<void>(resolve => { releaseReceipt = resolve; });
    let receiptArrived = new Promise<void>(resolve => { receiptReady = resolve; });
    controller.confirmProcessing = async selection => {
      const receipt = await originalConfirm(selection);
      receiptReady(); await receiptGate;
      return receipt;
    };
    click('ProcessingStart'); await waitForIdle();
    await receiptArrived;
    assert.deepEqual(submittedCommands.slice(beforeStart), ['menu_confirm_processing_direct'], 'confirmation does not require a preview');
    const taskId = controller.snapshot().processing_result?.taskId;
    assert.ok(taskId);
    const amountAfterStart = controller.snapshot().menu!.selectable_view_model!.processable_lot_options.find(x => x.id === selectedLot)?.quantity.amount ?? 0;
    assert.equal(amountAfterStart, amountBeforeStart - updatedAmount, 'direct confirmation uses the newly entered quantity');
    enterProcessing(String(updatedAmount));
    click('PageStock'); click('PageProcessing');
    probe.labels.hint.string = '界面已更新';
    releaseReceipt(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(probe.labels.hint.string, '界面已更新', 'late start receipt cannot revive success after edit and page changes');
    click('ProcessingTasks'); click('ProcessingTask');
    assert.match(probe.labels.processingTask.string, /进行中/, 'an active task is shown in Chinese');
    assert.doesNotMatch(probe.labels.processingTask.string, /active/);
    assert.match(probe.labels.processingOutput.string, /预计产物/);
    assert.match(probe.labels.processingOutput.string, /预计完成 day \d+ minute \d+/);
    assert.equal(probe.menuButtons.ProcessingCollect.interactable, false);
    const task = controller.snapshot().menu!.selectable_view_model!.processing_task_options.find(x => x.id === taskId)!;
    const maxDays = Math.ceil((task.expected_finish_minute - task.start_world_minute) / 1440) + 1;
    for (let day = 0; day < maxDays && !controller.snapshot().menu!.selectable_view_model!.collectable_task_options.some(x => x.id === taskId && x.enabled); day++) {
      click('AdvanceDay'); await waitForIdle();
    }
    assert.equal(probe.menuButtons.ProcessingCollect.interactable, true);
    receiptGate = new Promise<void>(resolve => { releaseReceipt = resolve; });
    receiptArrived = new Promise<void>(resolve => { receiptReady = resolve; });
    click('ProcessingCollect'); await waitForIdle();
    await receiptArrived;
    assert.equal(controller.snapshot().processing_result?.taskId, taskId);
    assert.ok(controller.snapshot().processing_result?.lotId);
    probe.onHide(); probe.onShow();
    probe.labels.hint.string = '已返回游戏';
    releaseReceipt(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(probe.labels.hint.string, '已返回游戏', 'late collection receipt cannot revive success after background');
    controller.confirmProcessing = originalConfirm;
  } finally { console.info = oldInfo; await controller.dispose(); }
});

test('M3 bottom hint geometry fits the design viewport, avoids controls, and retains confirmation text', async () => {
  const bundled = await build({ entryPoints: ['apps/cocos-wechat-probe/template/assets/scripts/CocosWechatProbe.ts'],
    bundle: true, write: false, platform: 'node', format: 'esm',
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    plugins: [{ name: 'cc-layout-port', setup(builder) {
      builder.onResolve({ filter: /^cc$/ }, () => ({ path: 'cc', namespace: 'test-layout' }));
      builder.onResolve({ filter: /generated\/probe-runtime\.js$/ }, () => ({ path: 'runtime', namespace: 'test-layout' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-layout' }, args => ({ contents: args.path === 'cc'
        ? `export class Node { constructor(name) { this.name=name; this.children=[]; this.components=[]; this.position={x:0,y:0,z:0}; } addChild(node) { this.children.push(node); node.parent=this; } addComponent(Type) { const c=new Type(); c.node=this; this.components.push(c); return c; } getComponent(Type) { return this.components.find(c => c instanceof Type) ?? null; } setPosition(x,y,z) { this.position={x,y,z}; } on(event,fn,ctx) { (this.listeners ??= new Map()).set(event,{fn,ctx}); } off(event,fn,ctx) { const e=this.listeners?.get(event); if(e?.fn===fn && e?.ctx===ctx) this.listeners.delete(event); } emit(event) { const e=this.listeners?.get(event); if(e) e.fn.call(e.ctx); } }
           export class Component { constructor() { this.node = new Node('root'); } }
           export class UITransform { setContentSize(width,height) { this.width=width; this.height=height; } setAnchorPoint() {} }
           export class Canvas {} export class Label { static HorizontalAlign={LEFT:0}; } export class Color { constructor(...v) { this.values=v; } }
           export class EditBox { static InputMode={SINGLE_LINE:0}; static InputFlag={DEFAULT:0}; static EventType={TEXT_CHANGED:'text-changed'}; isFocused() { return false; } blur() {} }
           export class Button { static Transition={NONE:0}; static EventType={CLICK:'click'}; } export class Graphics { roundRect() {} fill() {} }
           export class Camera { static ProjectionType={ORTHO:0}; static ClearFlag={SOLID_COLOR:0}; }
           export const _decorator={ccclass:()=>v=>v}, isValid=()=>true, Layers={Enum:{UI_2D:1}}, view={setDesignResolutionSize() {}, getVisibleSize() { return {width:960,height:540}; }}, ResolutionPolicy={SHOW_ALL:0};
           export const Game={EVENT_HIDE:'hide',EVENT_SHOW:'show'}, game={on(){},off(){}}, JsonAsset={}, resources={}, screen={windowSize:{width:960,height:540},devicePixelRatio:1}, sys={};`
        : 'export const createStage1AHost = () => {}; export class QinglanUiSceneProbeComponent {}', loader: 'js' }));
    } }]
  });
  const { CocosWechatProbe } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0]!.text).toString('base64'));
  const probe = new CocosWechatProbe();
  probe.createView();
  const rect = (node: any) => {
    const transform = node.components.find((c: any) => typeof c.width === 'number' && typeof c.height === 'number');
    assert.ok(transform, `missing UITransform for ${node.name}`);
    return { left: node.position.x - transform.width / 2, right: node.position.x + transform.width / 2,
      bottom: node.position.y - transform.height / 2, top: node.position.y + transform.height / 2 };
  };
  const hint = rect(probe.labels.hint.node);
  const result = rect(probe.labels.result.node);
  const quantityInput = rect(probe.splitInput.node);
  const quantityUnit = rect(probe.labels.splitUnit.node);
  const processingInput = rect(probe.processingInput.node);
  const processingLot = rect(probe.labels.processingLot.node);
  assert.ok(processingInput.left >= -480 && processingInput.right <= 480 && processingInput.bottom >= -270 && processingInput.top <= 270,
    'processing quantity input stays within the design viewport');
  assert.ok(processingInput.left >= processingLot.right, 'processing quantity input does not overlap the lot label');
  for (const [name, item] of [['split input', quantityInput], ['split unit', quantityUnit]] as const) {
    assert.ok(item.left >= -480 && item.right <= 480 && item.bottom >= -270 && item.top <= 270,
      `${name} stays within the design viewport`);
  }
  assert.ok(quantityInput.right <= quantityUnit.left || quantityUnit.right <= quantityInput.left
    || quantityInput.top <= quantityUnit.bottom || quantityUnit.top <= quantityInput.bottom,
    'split quantity input and unit label do not overlap');
  assert.ok(hint.bottom >= -250, 'hint needs at least 20 logical pixels above design viewport bottom');
  assert.ok(hint.left >= -480 && hint.right <= 480, 'hint stays within design viewport width');
  assert.ok(result.left >= -480 && result.right <= 480, 'result stays within design viewport width');
  assert.ok(result.right <= hint.left || hint.right <= result.left || result.top <= hint.bottom || hint.top <= result.bottom,
    'result and hint do not overlap');
  for (const button of [probe.saveButton, probe.loadButton, probe.backupButton, probe.cancelFirstButton]) {
    const control = rect(button.node);
    assert.ok(hint.top <= control.bottom || control.top <= hint.bottom || hint.right <= control.left || control.right <= hint.left,
      `hint must not overlap ${button.node.name}`);
    assert.ok(result.top <= control.bottom || control.top <= result.bottom || result.right <= control.left || control.right <= result.left,
      `result must not overlap ${button.node.name}`);
    for (const name of ['FarmMinus', 'FarmPlus', 'FarmPlant', 'FarmHarvest', 'StockMove', 'StockSplit', 'SplitBack', 'SplitPreview', 'SplitConfirm', 'ProcessingTasks', 'ProcessingPreview', 'ProcessingStart', 'ProcessingSlot', 'ProcessingBack', 'ProcessingCollect']) {
      const action = rect(probe.menuButtons[name].node);
      assert.ok(control.top <= action.bottom || action.top <= control.bottom || control.right <= action.left || action.right <= control.left,
        `${button.node.name} must not overlap ${name}`);
    }
  }
  assert.ok(probe.labels.hint.lineHeight <= hint.top - hint.bottom, 'hint line fits in its label height');
  probe.onCancelFirst();
  assert.equal(probe.labels.hint.string, '再点一次：撤销未完成首档，保留当前游戏');
  assert.match(probe.errorText('ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN'), /待确认.*核实/);
  assert.equal(probe.processingTimeLabel(0), 'day 1 minute 0');
  assert.equal(probe.processingTimeLabel(1439), 'day 1 minute 1439');
  assert.equal(probe.processingTimeLabel(1440), 'day 2 minute 0');
  assert.equal(probe.processingTimeLabel(2880), 'day 3 minute 0');
  const renderMenu = probe.renderMenu.bind(probe);
  const processingSelection = probe.processingSelection.bind(probe);
  probe.renderMenu = () => {};
  probe.processingSelection = () => ({ action_type: 'start_processing', method_id: 'test', facility_option_id: 'test', input_lots: [] });
  let fakeReceipt: any = { processing_result: null };
  probe.controller = { snapshot: () => ({ phase: 'ready', busy: false, visible: true, menu: null }),
    invalidateSplitPreview() {}, invalidateProcessingPreview() {}, confirmProcessing: async () => fakeReceipt };
  probe.page = 'processing';
  probe.menuHandler('ProcessingStart')(); await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(probe.labels.hint.string, '加工已开工', 'a missing start receipt cannot report success');
  fakeReceipt = { processing_result: { actionType: 'collect_processing_result', taskId: 'other', lotId: 'lot' } };
  probe.menuHandler('ProcessingStart')(); await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(probe.labels.hint.string, '加工已开工', 'a wrong action cannot report start success');
  probe.page = 'processingTasks'; probe.processingTaskId = 'expected';
  probe.menuHandler('ProcessingCollect')(); await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(probe.labels.hint.string, '加工产物已领取', 'a different task cannot report collection success');
  probe.controller = null; probe.renderMenu = renderMenu; probe.processingSelection = processingSelection;
  // Check production onLoad registers and onDestroy removes the actual text-change callback.
  let changes = 0;
  const textChanged = probe.onSplitTextChanged.bind(probe);
  probe.onSplitTextChanged = () => { changes++; textChanged(); };
  let processingChanges = 0;
  const processingTextChanged = probe.onProcessingTextChanged.bind(probe);
  probe.onProcessingTextChanged = () => { processingChanges++; processingTextChanged(); };
  probe.loadJson = () => new Promise(() => {});
  const oldInfo = console.info; console.info = () => {};
  try {
    probe.onLoad();
    const inputNode = probe.splitInput.node;
    probe.splitInput.string = '0.5';
    inputNode.emit('text-changed');
    assert.equal(changes, 1, 'registered EditBox event reaches the production callback');
    const processingNode = probe.processingInput.node;
    processingNode.emit('text-changed');
    assert.equal(processingChanges, 1, 'processing EditBox callback is registered');
    probe.onDestroy();
    inputNode.emit('text-changed');
    assert.equal(changes, 1, 'destroy removes the text-change callback');
    processingNode.emit('text-changed');
    assert.equal(processingChanges, 1, 'destroy removes the processing text-change callback');
  } finally { console.info = oldInfo; }
});
