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
        ? `export class Node { constructor(name) { this.name=name; this.children=[]; this.components=[]; this.position={x:0,y:0,z:0}; this.active=true; } addChild(node) { this.children.push(node); node.parent=this; } addComponent(Type) { const c=new Type(); c.node=this; this.components.push(c); return c; } getComponent(Type) { return this.components.find(c => c instanceof Type) ?? null; } setPosition(x,y,z) { this.position={x,y,z}; } on(event,fn,ctx) { (this.listeners ??= new Map()).set(event,{fn,ctx}); } off(event,fn,ctx) { const e=this.listeners?.get(event); if(e?.fn===fn && e?.ctx===ctx) this.listeners.delete(event); } emit(event) { const e=this.listeners?.get(event); if(e) e.fn.call(e.ctx); } }
           export class Component { constructor() { this.node = new Node('root'); } }
           export class UITransform { setContentSize(width,height) { this.width=width; this.height=height; } setAnchorPoint() {} }
           export class Canvas {} export class Label { static HorizontalAlign={LEFT:0}; } export class Color { constructor(...v) { this.values=v; } }
           export class EditBox { static InputMode={SINGLE_LINE:0}; static InputFlag={DEFAULT:0}; static EventType={TEXT_CHANGED:'text-changed'}; focused=false; isFocused() { return this.focused; } blur() { this.focused=false; } }
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
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  const schemas = Object.fromEntries(snapshot.schema_paths.map(path => [path, JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))]));
  const target = JSON.parse(readFileSync('tools/quality/rules/project-target.json', 'utf8'));
  const buildId = deriveBuildId('cocos_wechat_probe', target.version.snakeVersion);
  const identity = { schema: 'wechat-candidate/v1', candidate_id: 'wechat-11111111-1111-1111-1111-111111111111', source_commit: 'a'.repeat(40), short_commit: 'a'.repeat(12), version: target.version.codePackageVersion, build_id: buildId };
  const values = new Map<string, string>();
  const platform = { get length() { return values.size; }, key(i: number) { return Array.from(values.keys())[i] ?? null; }, getItem(k: string) { return values.get(k) ?? null; }, setItem(k: string, v: string) { values.set(k, v); }, removeItem(k: string) { values.delete(k); } };
  const storage = new WechatSaveStoragePort(() => platform, async () => {});
  let hold = false; let failSplitPatch = false; let unblock!: () => void;
  let injectedPatchReason = 'injected scene update failure after action';
  let abortBeforeCollect = false;
  let omitRefreshField: string | null = null;
  let liveHost: CocosSessionHost;
  let cancellations = 0;
  const submittedCommands: string[] = [];
  let gate = new Promise<void>(resolve => { unblock = resolve; });
  const controller = new WechatProbeController({
    load: async () => ({ resources: { snapshot, schemas, buildId }, identity }),
    createHost: input => liveHost = createStage1AHost({ snapshot: input.snapshot as RuntimeConfigSnapshot, schemas: input.schemas, buildId, storage, nowIso8601: '2026-11-03T00:00:00.000Z', randomSeed: 'farming-test-23' }),
    createBinding: host => {
      const binding = new QinglanUiSceneProbeComponent(host as CocosSessionHost, { applyNodeBindingPatch: async patch => {
        if (hold) await gate;
        if (patch.section === 'menu' && failSplitPatch) { failSplitPatch = false; throw new Error(injectedPatchReason); }
        if (patch.section === 'menu') controller.acceptMenuPatch(patch.payload);
      } });
      return { mount: () => binding.mount(), unmount: () => binding.unmount(), execute: command => {
        submittedCommands.push(command.name);
        if (abortBeforeCollect && command.name === 'menu_confirm_processing_direct' && command.selection.action_type === 'collect_processing_result') {
          abortBeforeCollect = false; return Promise.reject(new Error('injected transport interruption before dispatch'));
        }
        return binding.execute(command).then(result => {
          if (command.name !== 'refresh' || omitRefreshField === null) return result;
          const copy = structuredClone(result);
          Reflect.deleteProperty(copy.command_result.snapshot!.menu.selectable_view_model!, omitRefreshField);
          omitRefreshField = null;
          return copy;
        });
      } };
    },
    cancelFirstFailedSave: async () => { cancellations++; },
    onChange: state => probe.render(state)
  });
  probe.controller = controller;
  for (const [name, button] of Object.entries(probe.menuButtons) as Array<[string, any]>) {
    button.node.on('click', probe.menuHandler(name), probe);
  }
  const click = (name: string) => {
    const button = probe.menuButtons[name];
    assert.ok(button, `missing button ${name}`);
    for (let node = button.node; node; node = node.parent) if (node.active === false) return;
    if (button.interactable !== false) button.node.emit('click');
  };
  const waitForIdle = async () => { for (let i = 0; i < 500 && controller.snapshot().busy; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(controller.snapshot().busy, false, 'command completed'); await new Promise(resolve => setImmediate(resolve)); };
  const oldInfo = console.info; console.info = () => {};
  await controller.start();
  try {
    probe.names = { cabbage: '白菜', salt: '盐', pickling_cabbage_basic: '基础腌白菜' };
    assert.equal(probe.menuButtons.PageProcessing.interactable, true, 'processing entry is enabled when ready');
    click('PageProcessing');
    assert.equal(probe.page, 'processing', 'processing entry opens overview');
    click('ProcessingInfo'); click('ProcessingInfo'); click('ProcessingLoad'); await waitForIdle();
    assert.match(probe.labels.processingStatus.string, /未找到主存档/, 'empty slot is explained inside the processing screen');
    click('ProcessingInfoBack'); assert.equal(probe.page, 'processing', 'repeated information entry preserves the original return page');
    assert.match(probe.labels.processingOverviewRow0.string, /白菜.*未选择/);
    assert.match(probe.labels.processingOverviewRow1.string, /盐.*至少8克.*未选择/);
    click('ProcessingRequirement0'); click('ProcessingAddLot');
    assert.match(probe.labels.processingLotsRow0.string, /暂无符合此要求的材料/, 'empty inventory has an explicit player-visible message');
    assert.equal(probe.menuButtons.ProcessingLot0.interactable, false);
    click('ProcessingLotsBack'); click('ProcessingMaterialsBack'); click('ProcessingExit');
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
    for (let i = 0; i < 9; i++) click('FarmPlus');
    assert.equal(probe.seedAmount, 10, 'the UI never silently truncates the requested quantity');
    assert.match(probe.labels.farmField.string, /空余6\/6格/);
    assert.match(probe.labels.farmSeed.string, /种10位.*共10粒/);
    assert.match(probe.labels.farmSeed.string, /土地空间不足/);
    assert.equal(probe.menuButtons.FarmPlant.interactable, false);
    click('FarmPlant');
    assert.equal(controller.snapshot().accepted_commands, beforeSelect, 'over-capacity input cannot consume seeds');
    for (let i = 0; i < 9; i++) click('FarmMinus');
    assert.match(probe.labels.farmSeed.string, /每位成苗率80%/);
    click('FarmSeeds2');
    assert.match(probe.labels.farmSeed.string, /种1位.*每位2粒.*共2粒/);
    assert.match(probe.labels.farmSeed.string, /每位成苗率96%/);
    click('FarmSeeds3');
    assert.match(probe.labels.farmSeed.string, /每位成苗率99.2%/);
    for (let i = 0; i < 3; i++) click('FarmPlus');
    assert.match(probe.labels.farmSeed.string, /种4位.*共12粒/);
    assert.match(probe.labels.farmSeed.string, /种子不足/);
    assert.equal(probe.menuButtons.FarmPlant.interactable, false);
    click('FarmPlant');
    assert.equal(controller.snapshot().accepted_commands, beforeSelect);
    for (let i = 0; i < 3; i++) click('FarmMinus');
    click('FarmSeeds1');
    click('FarmSeeds2');

    const seedBefore = initial.menu!.selectable_view_model!.seed_lot_options.find(x => x.id === seedId)!.quantity.amount;
    click('FarmPlant'); await waitForIdle();
    assert.equal(controller.snapshot().accepted_commands, beforeSelect + 1);
    const planted = controller.snapshot().menu!.selectable_view_model!;
    assert.equal(planted.field_options.find(x => x.id === fieldId)!.enabled, true);
    assert.equal(planted.field_options.find(x => x.id === fieldId)!.available_tiles, 5);
    assert.equal(planted.seed_lot_options.find(x => x.id === seedId)!.quantity.amount, seedBefore - 2, 'one position consumes the selected two seeds, not one or two positions');
    assert.equal(probe.fieldId, fieldId, 'a partly occupied field remains selected');
    assert.match(probe.labels.farmCrop.string, /待出苗1.*生长中0/);
    assert.match(probe.labels.farmCrop.string, /出苗失败0/);
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
    const selectLot = (id: string) => {
      const count = controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.length;
      for (let i = 0; probe.lotId !== id && i < count + 1; i++) click('StockLot');
      assert.equal(probe.lotId, id);
    };
    click('StockSplit');
    assert.equal(probe.page, 'split');
    assert.equal(probe.menuButtons.SplitPreview, undefined, 'splitting has no separate preview control');
    const beforeInvalid = controller.snapshot().accepted_commands;
    for (const text of ['', 'NaN', 'Infinity', '0', '-1', '2x']) {
      enter(text); click('SplitConfirm');
      assert.equal(probe.menuButtons.SplitConfirm.interactable, false);
      assert.equal(controller.snapshot().accepted_commands, beforeInvalid, 'invalid text submits no command');
    }
    click('SplitBack'); selectLot(seedId); click('StockSplit');
    const seedBeforeReject = controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(x => x.id === seedId)!.quantity.amount;
    enter('0.5');
    assert.match(probe.labels.splitSummary.string, /须为整数/);
    click('SplitConfirm');
    assert.equal(controller.snapshot().accepted_commands, beforeInvalid);
    enter(String(seedBeforeReject + 1));
    assert.match(probe.labels.splitSummary.string, /超过当前库存/);
    click('SplitConfirm');
    assert.equal(controller.snapshot().accepted_commands, beforeInvalid);
    assert.equal(controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(x => x.id === seedId)!.quantity.amount, seedBeforeReject);
    enter('2');
    assert.match(probe.labels.splitSummary.string, new RegExp(`拆出2粒.*原批次剩${seedBeforeReject - 2}粒`));
    assert.equal(controller.snapshot().accepted_commands, beforeInvalid, 'live explanation is local and dispatches no preview');
    click('SplitBack'); selectLot(pair.lot.id); click('StockSplit');
    const beforeFraction = controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(x => x.id === pair.lot.id)!.quantity.amount;
    enter('0.5');
    assert.equal(controller.snapshot().split_preview, null);
    const beforeDirect = controller.snapshot().accepted_commands;
    const beforeDirectCommands = submittedCommands.length;
    gate = new Promise<void>(resolve => { unblock = resolve; });
    hold = true; click('SplitConfirm');
    try {
      assert.equal(probe.splitInput.focused, false, 'confirm closes the active edit box');
      assert.equal(controller.snapshot().busy, true);
      click('SplitConfirm'); enter('2');
      assert.equal(probe.splitInput.string, '0.5', 'late keyboard input cannot alter an in-flight request');
      assert.equal(controller.snapshot().accepted_commands, beforeDirect + 1);
    } finally { hold = false; unblock(); }
    await waitForIdle();
    assert.deepEqual(submittedCommands.slice(beforeDirectCommands), ['menu_confirm_split_direct']);
    const first = controller.snapshot().split_result;
    assert.ok(first);
    assert.equal(first.quantity.amount, 0.5);
    assert.equal(first.remainingQuantity?.amount, beforeFraction - 0.5);
    assert.equal(first.sourceLotId, pair.lot.id);
    assert.equal(probe.splitInput.string, '', 'success clears the submitted quantity');
    click('SplitConfirm');
    assert.equal(controller.snapshot().accepted_commands, beforeDirect + 1, 'the old quantity cannot be submitted by another click');
    enter('1'); enter('2');
    click('SplitConfirm'); await waitForIdle();
    const changed = controller.snapshot().split_result;
    assert.ok(changed);
    assert.equal(changed.quantity.amount, 2, 'direct confirmation uses the current input');
    assert.equal(changed.remainingQuantity?.amount, first.remainingQuantity!.amount - 2);
    enter(String(changed.remainingQuantity!.amount));
    click('SplitConfirm'); await waitForIdle();
    const full = controller.snapshot().split_result;
    assert.ok(full);
    assert.equal(full.remainingQuantity, null);
    assert.equal(full.quantity.amount, beforeFraction - 2.5);
    assert.equal(probe.lotId, null);
    click('SplitBack'); selectLot(first.newLotId); click('StockSplit');
    enter('0.5'); failSplitPatch = true;
    const oldError = console.error; console.error = () => {};
    try { click('SplitConfirm'); await waitForIdle(); } finally { console.error = oldError; }
    assert.match(controller.snapshot().last_error ?? '', /ERR_WECHAT_SPLIT_RESULT_UNCERTAIN/);
    assert.equal(probe.splitNeedsReview, true);
    assert.match(probe.labels.splitSummary.string, /待确认.*核对库存/);
    const afterUncertain = submittedCommands.length;
    click('SplitConfirm'); probe.menuHandler('SplitConfirm')();
    assert.equal(submittedCommands.length, afterUncertain, 'uncertain results block duplicate submission');
    omitRefreshField = 'splittable_lot_options';
    console.error = () => {};
    try { click('SplitRefresh'); await waitForIdle(); } finally { console.error = oldError; }
    assert.equal(probe.splitNeedsReview, true, 'incomplete refresh cannot unlock splitting');
    const beforeReview = submittedCommands.length;
    click('SplitRefresh'); await waitForIdle();
    assert.deepEqual(submittedCommands.slice(beforeReview), ['refresh'], 'review only reads the current session');
    assert.equal(probe.splitNeedsReview, false);
    assert.equal(probe.splitInput.string, '');
    assert.equal(probe.lotId, null, 'refresh observes the source already consumed by the uncertain action');
    click('SplitBack'); selectLot(changed.newLotId); click('StockSplit'); enter('1');
    gate = new Promise<void>(resolve => { unblock = resolve; });
    hold = true; click('SplitConfirm'); probe.onHide(); hold = false; unblock(); await waitForIdle();
    probe.onShow();
    assert.equal(probe.splitNeedsReview, true, 'background completion needs explicit review');
    assert.equal(probe.menuButtons.SplitConfirm.interactable, false);
    click('SplitRefresh'); await waitForIdle();
    assert.equal(probe.splitNeedsReview, false);
    assert.equal(probe.splitInput.string, '');
    await controller.load();
    assert.equal(controller.snapshot().split_preview, null, 'reading clears the preview receipt');
    assert.equal(probe.menuButtons.SplitConfirm.interactable, false);
    assert.equal(probe.lotId, null, 'reading the earlier save clears a now-absent selected lot');
    assert.equal(controller.snapshot().identity!.candidate_id, identity.candidate_id);
    assert.equal(controller.snapshot().menu!.selectable_view_model!.field_options.find(x => x.id === fieldId)!.enabled, true);

    // Exercise the actual screen through the public menu and formal pipeline.
    for (let day = 0; day < 30 && !controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.some(x => x.field_plot_id === fieldId); day++) {
      click('AdvanceDay'); await waitForIdle();
    }
    const restoredCrop = controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.find(x => x.field_plot_id === fieldId);
    assert.ok(restoredCrop);
    click('PageFarm'); click('FarmCrop'); click('FarmHarvest'); await waitForIdle();
    const lotsBefore = controller.snapshot().menu!.selectable_view_model!.processable_lot_options;
    const cabbage = lotsBefore.find(item => item.base_id === 'cabbage' && item.enabled)!;
    assert.ok(cabbage);
    const split = await controller.confirmSplit(cabbage.id, { amount: 250, unit: cabbage.quantity.unit });
    const secondCabbage = split.split_result!.newLotId;
    for (let i = 0; i < 3; i++) await controller.confirmSplit(cabbage.id, { amount: 1, unit: cabbage.quantity.unit });
    probe.names = { cabbage: '白菜', salt: '盐', pickling_cabbage_basic: '基础腌白菜' };
    click('PageProcessing');
    assert.equal(probe.page, 'processing');
    assert.match(probe.labels.processingOverviewMethod.string, /腌白菜/);
    assert.match(probe.labels.processingOverviewRow0.string, /白菜/);
    assert.match(probe.labels.processingOverviewRow1.string, /盐.*至少8克/);
    assert.match(probe.labels.processingOverviewFacility.string, /尚未选择/);
    click('ProcessingChooseMethod'); assert.equal(probe.page, 'processingMethods');
    assert.match(probe.labels.processingMethodsRow0.string, /腌白菜/);
    click('ProcessingMethod0'); assert.equal(probe.page, 'processing');
    click('ProcessingChooseFacility'); assert.equal(probe.page, 'processingFacilities');
    assert.match(probe.labels.processingFacilitiesRow0.string, /第1处.*基础腌菜坛/);
    click('ProcessingFacility0'); assert.equal(probe.page, 'processing');
    assert.match(probe.labels.processingOverviewFacility.string, /基础腌菜坛/);
    const enterProcessing = (value: string) => { probe.processingInput.string = value; probe.processingInput.focused = true; probe.onProcessingTextChanged(); };
    click('ProcessingRequirement0'); assert.equal(probe.page, 'processingMaterials');
    assert.match(probe.labels.processingMaterialsRow0.string, /尚未选择/);
    click('ProcessingAddLot'); assert.equal(probe.page, 'processingLots');
    assert.match(probe.labels.processingLotsRow0.string, /白菜.*现有/);
    assert.equal(probe.menuButtons.ProcessingLotsNext.interactable, true, 'all batches remain reachable beyond the first page');
    assert.match(probe.labels.processingPagination.string, /第1\/2页/);
    click('ProcessingLotsNext'); assert.match(probe.labels.processingPagination.string, /第2\/2页/);
    assert.match(probe.labels.processingLotsRow0.string, /白菜.*现有/);
    click('ProcessingLotsPrev'); assert.match(probe.labels.processingPagination.string, /第1\/2页/);
    click('ProcessingLot0'); assert.equal(probe.page, 'processingQuantity');
    assert.equal(probe.processingInput.string, '', 'new selections do not silently prefill a quantity');
    enterProcessing('0'); click('ProcessingQuantitySave');
    assert.equal(probe.page, 'processingQuantity');
    assert.match(probe.labels.hint.string, /大于零.*有效数量/, 'invalid input tells the player how to fix it');
    enterProcessing('150'); click('ProcessingQuantityBack'); click('ProcessingLotsBack');
    assert.match(probe.labels.processingMaterialsRow0.string, /尚未选择/, 'abandoning a new quantity leaves no selection');
    click('ProcessingAddLot'); click('ProcessingLot0'); enterProcessing('150'); click('ProcessingQuantitySave');
    assert.equal(probe.page, 'processingMaterials');
    assert.match(probe.labels.processingMaterialsRow0.string, /白菜.*使用150克/);
    click('ProcessingEdit0'); enterProcessing('999'); click('ProcessingQuantityBack');
    assert.match(probe.labels.processingMaterialsRow0.string, /使用150克/, 'back discards an unsaved edit');
    click('ProcessingEdit0'); assert.equal(probe.processingInput.string, '150'); click('ProcessingQuantityBack');
    click('ProcessingAddLot'); click('ProcessingLot0'); enterProcessing('10'); click('ProcessingQuantitySave');
    assert.match(probe.labels.processingMaterialsRow1.string, /白菜.*使用10克/, 'the existing formal duplicate-lot option remains selectable');
    click('ProcessingRemove1');
    click('ProcessingAddLot');
    const currentChoices = controller.snapshot().menu!.selectable_view_model!;
    const method = currentChoices.processing_method_options.find(item => item.id === probe.processingMethodId)!;
    const candidates = currentChoices.processable_lot_options.filter(item => item.enabled && method.input_requirements[0]!.lot_ids.includes(item.id));
    const otherIndex = candidates.findIndex(item => item.id === secondCabbage);
    assert.ok(otherIndex >= 0 && otherIndex < 3, 'the second actual batch is visible in the test fixture');
    click('ProcessingLot' + otherIndex); enterProcessing('100'); click('ProcessingQuantitySave');
    assert.match(probe.labels.processingMaterialsRow1.string, /白菜.*使用100克/);
    click('ProcessingRemove1');
    assert.equal(probe.labels.processingMaterialsRow1.string, '', 'remove affects only the chosen input');
    assert.match(probe.labels.processingMaterialsRow0.string, /使用150克/);
    click('ProcessingAddLot'); click('ProcessingLot' + otherIndex); enterProcessing('100'); click('ProcessingQuantitySave');
    click('ProcessingMaterialsBack');
    assert.match(probe.labels.processingOverviewRow0.string, /已选2项/);
    assert.match(probe.labels.processingOverviewRow1.string, /未选择/);
    click('ProcessingSummary');
    assert.match(probe.labels.processingSummaryTitle.string, /腌白菜.*基础腌菜坛/);
    assert.match(probe.labels.processingSummaryRow0.string, /白菜.*150克/);
    assert.match(probe.labels.processingSummaryRow1.string, /白菜.*100克/);
    const beforeRefusal = controller.snapshot().menu!.selectable_view_model!;
    const draftBeforeRefusal = structuredClone(probe.processingInputs);
    const beforeCommands = submittedCommands.length;
    console.error = () => {};
    try { click('ProcessingSummaryStart'); await waitForIdle(); } finally { console.error = oldError; }
    assert.deepEqual(submittedCommands.slice(beforeCommands), ['menu_confirm_processing_direct']);
    assert.deepEqual(controller.snapshot().menu!.selectable_view_model!.processing_task_options, beforeRefusal.processing_task_options);
    assert.deepEqual(controller.snapshot().menu!.selectable_view_model!.processable_lot_options, beforeRefusal.processable_lot_options);
    assert.match(probe.labels.hint.string, /缺少|不足|未完成/);
    assert.deepEqual(probe.processingInputs, draftBeforeRefusal, 'a definite pre-dispatch refusal leaves the draft editable');
    assert.equal(probe.menuButtons.ProcessingSummaryStart.interactable, true, 'a rejected draft can be corrected and retried');
    click('ProcessingSummaryBack'); click('ProcessingRequirement1');
    click('ProcessingAddLot'); click('ProcessingLot0'); enterProcessing('8'); click('ProcessingQuantitySave');
    assert.match(probe.labels.processingMaterialsRow0.string, /盐.*使用8克/);
    click('ProcessingMaterialsBack'); click('ProcessingSummary');
    assert.equal(probe.menuButtons.ProcessingSummaryNext.interactable, true, 'a third selected input has another page');
    click('ProcessingSummaryNext'); assert.match(probe.labels.processingSummaryRow0.string, /盐.*8克/);
    assert.equal(probe.menuButtons.ProcessingSummaryNext.interactable, false);
    click('ProcessingSummaryPrev'); assert.match(probe.labels.processingSummaryRow0.string, /白菜.*150克/);
    gate = new Promise<void>(resolve => { unblock = resolve; });
    hold = true; click('ProcessingSummaryPreview'); assert.equal(controller.snapshot().busy, true);
    probe.onHide(); hold = false; unblock(); await waitForIdle(); probe.onShow();
    assert.equal(controller.snapshot().processing_preview, null, 'late background preview is discarded');
    assert.doesNotMatch(probe.labels.hint.string, /预览通过/, 'background preview cannot restore a stale success hint');
    click('ProcessingSummaryPreview'); await waitForIdle();
    assert.equal(controller.snapshot().processing_preview?.success, true);
    assert.match(probe.labels.hint.string, /预览通过/);
    click('ProcessingSummaryBack'); click('ProcessingRequirement1'); click('ProcessingEdit0');
    enterProcessing('9'); click('ProcessingQuantitySave'); click('ProcessingMaterialsBack'); click('ProcessingSummary');
    assert.equal(controller.snapshot().processing_preview, null, 'editing invalidates the old optional preview');
    const beforeStart = submittedCommands.length;
    const originalConfirm = controller.confirmProcessing.bind(controller);
    let releaseReceipt!: () => void; let receiptReady!: () => void;
    let receiptGate = new Promise<void>(resolve => { releaseReceipt = resolve; });
    let receiptArrived = new Promise<void>(resolve => { receiptReady = resolve; });
    controller.confirmProcessing = async selection => { const receipt = await originalConfirm(selection); receiptReady(); await receiptGate; return receipt; };
    click('ProcessingSummaryStart'); await waitForIdle(); await receiptArrived;
    assert.deepEqual(submittedCommands.slice(beforeStart), ['menu_confirm_processing_direct'], 'confirmation does not require a preview');
    const taskId = controller.snapshot().processing_result?.taskId;
    assert.ok(taskId);
    const afterStart = controller.snapshot().menu!.selectable_view_model!;
    assert.equal(afterStart.processable_lot_options.find(item => item.id === cabbage.id)!.quantity.amount, cabbage.quantity.amount - 250 - 3 - 150);
    assert.equal(afterStart.processable_lot_options.find(item => item.id === secondCabbage)!.quantity.amount, 150);
    assert.equal(probe.menuButtons.ProcessingSummaryStart.interactable, false, 'the submitted draft stays locked while its receipt is delayed');
    const beforeRepeatedClick = submittedCommands.length;
    click('ProcessingSummaryStart');
    assert.equal(submittedCommands.length, beforeRepeatedClick, 'delayed receipt cannot trigger a second action');
    probe.onHide(); probe.onShow();
    assert.match(probe.labels.hint.string, /后台操作结果.*核实/);
    click('ProcessingSummaryBack'); probe.labels.hint.string = '界面已更新';
    releaseReceipt(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(probe.labels.hint.string, '界面已更新', 'late start receipt cannot revive success after leaving');
    assert.equal(Object.keys(probe.processingInputs).length, 0, 'a committed action cannot leave its old materials as an active draft');
    assert.match(probe.labels.processingStatus.string, /核对.*任务.*库存|任务.*库存.*核实/, 'an obsolete successful receipt requires a fresh review');
    assert.equal(submittedCommands.length, beforeRepeatedClick, 'late receipt does not resend the start action');
    controller.confirmProcessing = originalConfirm;
    click('ProcessingStartRefresh'); await waitForIdle();
    assert.equal(probe.page, 'processingReview', 'the player sees a fresh review before creating a new draft');
    click('ProcessingReviewBack');
    click('ProcessingInfo'); click('ProcessingSave'); await waitForIdle(); click('ProcessingInfoBack');
    click('ProcessingTasks'); assert.match(probe.labels.processingTasksRow0.string, /任务1.*进行中/);
    click('ProcessingTask0'); assert.match(probe.labels.processingTaskDetailTitle.string, /进行中/);
    assert.match(probe.labels.processingTaskDetailOutput.string, /预计产物/);
    assert.equal(probe.menuButtons.ProcessingTaskDetailCollect.interactable, false);
    click('ProcessingTaskDetailBack'); click('ProcessingAdvanceDay'); await waitForIdle();
    click('ProcessingInfo'); click('ProcessingLoad'); await waitForIdle(); click('ProcessingInfoBack');
    const restored = controller.snapshot().menu!.selectable_view_model!.processing_task_options.find(item => item.id === taskId)!;
    assert.equal(restored.status, 'active', 'reading restores the saved active task');
    assert.equal(Object.keys(probe.processingInputs).length, 0, 'reading clears stale material selections');
    for (let day = 0; day < 4 && !controller.snapshot().menu!.selectable_view_model!.collectable_task_options.some(item => item.id === taskId && item.enabled); day++) {
      click('ProcessingAdvanceDay'); await waitForIdle();
    }
    click('ProcessingTask0'); assert.match(probe.labels.processingTaskDetailTitle.string, /可领取/);
    assert.equal(probe.menuButtons.ProcessingTaskDetailCollect.interactable, true);
    receiptGate = new Promise<void>(resolve => { releaseReceipt = resolve; });
    receiptArrived = new Promise<void>(resolve => { receiptReady = resolve; });
    controller.confirmProcessing = async selection => { const receipt = await originalConfirm(selection); receiptReady(); await receiptGate; return receipt; };
    gate = new Promise<void>(resolve => { unblock = resolve; }); hold = true;
    click('ProcessingTaskDetailCollect'); assert.equal(controller.snapshot().busy, true);
    probe.onHide(); hold = false; unblock(); await waitForIdle(); await receiptArrived;
    assert.equal(controller.snapshot().processing_result, null, 'background invalidates the delayed collection presentation');
    probe.onShow(); assert.match(probe.labels.hint.string, /后台操作结果.*任务.*库存.*核实/);
    probe.labels.hint.string = '已返回游戏';
    releaseReceipt(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(probe.labels.hint.string, '已返回游戏', 'late collection receipt cannot revive success after background');
    controller.confirmProcessing = originalConfirm;
    assert.equal(probe.menuButtons.ProcessingTaskDetailCollect.interactable, false, 'completed task cannot be collected twice');
    click('ProcessingTaskDetailBack'); click('ProcessingTasksBack'); click('ProcessingChooseFacility'); click('ProcessingFacility0');
    click('ProcessingRequirement0'); click('ProcessingAddLot'); click('ProcessingLot0'); enterProcessing('50'); click('ProcessingQuantitySave'); click('ProcessingMaterialsBack');
    click('ProcessingRequirement1'); click('ProcessingAddLot'); click('ProcessingLot0'); enterProcessing('8'); click('ProcessingQuantitySave'); click('ProcessingMaterialsBack');
    click('ProcessingSummary'); click('ProcessingSummaryStart'); await waitForIdle();
    assert.equal(probe.page, 'processingTaskDetail', 'successful start opens the created task details');
    assert.match(probe.labels.processingTaskDetailTitle.string, /进行中/);
    assert.equal(Object.keys(probe.processingInputs).length, 0, 'successful start clears the submitted material draft');
    const secondTask = controller.snapshot().processing_result!.taskId;
    click('ProcessingTaskDetailBack');
    for (let day = 0; day < 4 && !controller.snapshot().menu!.selectable_view_model!.collectable_task_options.some(item => item.id === secondTask && item.enabled); day++) {
      click('ProcessingAdvanceDay'); await waitForIdle();
    }
    click('ProcessingTask1'); assert.equal(probe.processingTaskId, secondTask);
    failSplitPatch = true; injectedPatchReason = 'after collect commit ERR_WECHAT_PROBE_ACTION_FAILED:misleading';
    const collectCommands = submittedCommands.length;
    console.error = () => {};
    try { click('ProcessingTaskDetailCollect'); await waitForIdle(); } finally { console.error = oldError; }
    assert.equal(liveHost!.requireSession().getSelectableViewModel().processing_task_options.find(item => item.id === secondTask)!.status, 'completed',
      'collection actually committed before the injected UI failure');
    assert.equal(probe.menuButtons.ProcessingTaskDetailCollect.interactable, false, 'uncertain collection is locked');
    click('ProcessingTaskDetailCollect');
    assert.deepEqual(submittedCommands.slice(collectCommands), ['menu_confirm_processing_direct'], 'uncertain collection is never reissued automatically or on accidental press');
    failSplitPatch = true; injectedPatchReason = 'injected refresh failure';
    console.error = () => {};
    try { click('ProcessingTaskDetailRefresh'); await waitForIdle(); } finally { console.error = oldError; }
    assert.equal(probe.menuButtons.ProcessingTaskDetailCollect.interactable, false, 'failed read-only refresh keeps the lock');
    click('ProcessingTaskDetailRefresh'); await waitForIdle();
    assert.equal(probe.menuButtons.ProcessingTaskDetailCollect.interactable, false, 'refresh discovers completed tasks cannot be collected again');
    assert.deepEqual(submittedCommands.slice(collectCommands), ['menu_confirm_processing_direct', 'refresh', 'refresh'], 'checking never reads or writes a save or issues another action');
    click('ProcessingTaskDetailBack'); click('ProcessingTasksBack');
    click('ProcessingRequirement0'); click('ProcessingAddLot'); click('ProcessingLot0'); enterProcessing('40'); click('ProcessingQuantitySave'); click('ProcessingMaterialsBack');
    click('ProcessingRequirement1'); click('ProcessingAddLot'); click('ProcessingLot0'); enterProcessing('8'); click('ProcessingQuantitySave'); click('ProcessingMaterialsBack');
    click('ProcessingSummary');
    const tasksBeforeFault = liveHost!.requireSession().getSelectableViewModel().processing_task_options.length;
    const commandsBeforeFault = submittedCommands.length;
    failSplitPatch = true; injectedPatchReason = 'after commit ERR_WECHAT_PROBE_ACTION_FAILED:misleading';
    console.error = () => {};
    try { click('ProcessingSummaryStart'); await waitForIdle(); } finally { console.error = oldError; }
    assert.equal(liveHost!.requireSession().getSelectableViewModel().processing_task_options.length, tasksBeforeFault + 1,
      'the formal action actually committed before the injected display failure');
    assert.equal(controller.snapshot().menu!.selectable_view_model!.processing_task_options.length, tasksBeforeFault,
      'the dropped patch leaves the previously displayed menu stale');
    assert.match(controller.snapshot().last_error ?? '', /ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN/);
    assert.equal(Object.keys(probe.processingInputs).length, 0, 'uncertain results remove the old submitted draft');
    assert.match(probe.labels.processingStatus.string, /待确认.*任务.*库存/);
    assert.deepEqual(submittedCommands.slice(commandsBeforeFault), ['menu_confirm_processing_direct']);
    click('ProcessingSummaryStart');
    assert.deepEqual(submittedCommands.slice(commandsBeforeFault), ['menu_confirm_processing_direct'], 'uncertain operation is not automatically or accidentally resent');
    assert.equal(probe.menuButtons.ProcessingSummaryStart.interactable, false);
    assert.equal(probe.menuButtons.ProcessingSummaryRefresh.interactable, true);
    failSplitPatch = true; injectedPatchReason = 'injected processing review failure';
    console.error = () => {};
    try { click('ProcessingSummaryRefresh'); await waitForIdle(); } finally { console.error = oldError; }
    assert.equal(probe.page, 'processingSummary');
    assert.equal(probe.menuButtons.ProcessingSummaryStart.interactable, false, 'failed refresh does not permit a new start');
    gate = new Promise<void>(resolve => { unblock = resolve; }); hold = true;
    click('ProcessingSummaryRefresh'); assert.equal(controller.snapshot().busy, true);
    probe.onHide(); hold = false; unblock(); await waitForIdle(); probe.onShow();
    assert.equal(probe.page, 'processingSummary');
    assert.equal(probe.menuButtons.ProcessingSummaryStart.interactable, false, 'background refresh cannot clear the review requirement');
    for (const field of ['processing_method_options', 'processing_facility_options', 'processable_lot_options',
      'splittable_lot_options', 'processing_task_options', 'collectable_task_options']) {
      omitRefreshField = field; console.error = () => {};
      try { click('ProcessingSummaryRefresh'); await waitForIdle(); } finally { console.error = oldError; }
      assert.equal(probe.page, 'processingSummary', `missing ${field} cannot finish review`);
      assert.equal(probe.menuButtons.ProcessingSummaryStart.interactable, false, `missing ${field} keeps the start locked`);
    }
    click('ProcessingSummaryRefresh'); await waitForIdle();
    assert.equal(probe.page, 'processingReview');
    assert.equal(controller.snapshot().menu!.selectable_view_model!.processing_task_options.length, tasksBeforeFault + 1,
      'the read-only refresh exposes the previously committed task');
    assert.deepEqual(controller.snapshot().menu!.selectable_view_model!.processable_lot_options.map(item => [item.id, item.quantity]),
      liveHost!.requireSession().getSelectableViewModel().processable_lot_options.map(item => [item.id, item.quantity]),
      'the refreshed choices expose the actual post-consumption inventory');
    assert.match(probe.labels.processingReviewTitle.string, /任务.*库存/);
    assert.deepEqual(submittedCommands.slice(commandsBeforeFault), ['menu_confirm_processing_direct', ...Array(9).fill('refresh')]);
    click('ProcessingReviewTasks');
    assert.match(probe.labels.processingTasksRow0.string, /任务/);
    click('ProcessingTasksBack');
    click('ProcessingRequirement0'); click('ProcessingAddLot'); click('ProcessingLot0'); enterProcessing('40'); click('ProcessingQuantitySave'); click('ProcessingMaterialsBack');
    click('ProcessingRequirement1'); click('ProcessingAddLot'); click('ProcessingLot0'); enterProcessing('8'); click('ProcessingQuantitySave'); click('ProcessingMaterialsBack');
    click('ProcessingSummary'); click('ProcessingSummaryStart'); await waitForIdle();
    assert.equal(probe.page, 'processingTaskDetail', 'after the player checks and reselects inputs, healthy processing works again');
    const thirdTask = controller.snapshot().processing_result!.taskId;
    click('ProcessingTaskDetailBack');
    for (let day = 0; day < 4 && !controller.snapshot().menu!.selectable_view_model!.collectable_task_options.some(item => item.id === thirdTask && item.enabled); day++) {
      click('ProcessingAdvanceDay'); await waitForIdle();
    }
    const thirdTaskIndex = controller.snapshot().menu!.selectable_view_model!.processing_task_options.findIndex(item => item.id === thirdTask);
    assert.ok(thirdTaskIndex >= 0);
    for (let page = 0; page < Math.floor(thirdTaskIndex / 3); page++) click('ProcessingTasksNext');
    click('ProcessingTask' + (thirdTaskIndex % 3)); assert.equal(probe.processingTaskId, thirdTask);
    const readyCommands = submittedCommands.length;
    abortBeforeCollect = true; console.error = () => {};
    try { click('ProcessingTaskDetailCollect'); await waitForIdle(); } finally { console.error = oldError; }
    assert.equal(liveHost!.requireSession().getSelectableViewModel().processing_task_options.find(item => item.id === thirdTask)!.status, 'ready_to_collect');
    assert.equal(probe.menuButtons.ProcessingTaskDetailCollect.interactable, false, 'even an uncommitted interruption remains uncertain until checked');
    const originalRefresh = controller.refreshProcessingView.bind(controller);
    controller.refreshProcessingView = async () => {
      const result = await originalRefresh();
      return { ...result, menu: { ...result.menu!, selectable_view_model: { ...result.menu!.selectable_view_model!,
        processing_task_options: result.menu!.selectable_view_model!.processing_task_options.filter(item => item.id !== thirdTask) } } };
    };
    click('ProcessingTaskDetailRefresh'); await waitForIdle();
    assert.equal(probe.menuButtons.ProcessingTaskDetailCollect.interactable, false, 'a refresh receipt missing this task keeps the lock');
    assert.match(probe.labels.hint.string, /任务状态待核实/);
    for (const mode of ['completed-enabled', 'ready-missing', 'ready-duplicate', 'unknown-status', 'duplicate-task'] as const) {
      controller.refreshProcessingView = async () => {
        const result = await originalRefresh();
        const source = result.menu!.selectable_view_model!;
        const task = source.processing_task_options.find(item => item.id === thirdTask)!;
        const choice = source.collectable_task_options.find(item => item.id === thirdTask)!;
        const processing_task_options = mode === 'completed-enabled'
          ? source.processing_task_options.map(item => item.id === thirdTask ? { ...item, status: 'completed', enabled: false } : item)
          : mode === 'unknown-status' ? source.processing_task_options.map(item => item.id === thirdTask ? { ...item, status: 'unknown' } : item)
            : mode === 'duplicate-task' ? [...source.processing_task_options, { ...task }] : source.processing_task_options;
        const collectable_task_options = mode === 'ready-missing' ? source.collectable_task_options.filter(item => item.id !== thirdTask)
          : mode === 'ready-duplicate' ? [...source.collectable_task_options, { ...choice }] : source.collectable_task_options;
        return { ...result, menu: { ...result.menu!, selectable_view_model: { ...source, processing_task_options, collectable_task_options } } };
      };
      click('ProcessingTaskDetailRefresh'); await waitForIdle();
      assert.equal(probe.menuButtons.ProcessingTaskDetailCollect.interactable, false, `${mode} must not unlock collection`);
      assert.match(probe.labels.hint.string, /任务状态待核实/);
    }
    controller.refreshProcessingView = originalRefresh;
    gate = new Promise<void>(resolve => { unblock = resolve; }); hold = true;
    click('ProcessingTaskDetailRefresh'); assert.equal(controller.snapshot().busy, true);
    probe.onHide(); hold = false; unblock(); await waitForIdle(); probe.onShow();
    assert.equal(probe.menuButtons.ProcessingTaskDetailCollect.interactable, false, 'a refresh completed in the background cannot unlock collection');
    click('ProcessingTaskDetailRefresh'); await waitForIdle();
    assert.equal(probe.menuButtons.ProcessingTaskDetailCollect.interactable, true, 'a visible read-only check confirms the task is still ready');
    assert.deepEqual(submittedCommands.slice(readyCommands), ['menu_confirm_processing_direct', ...Array(8).fill('refresh')],
      'read-only checks never automatically collect or access saves');
    click('ProcessingTaskDetailCollect'); await waitForIdle();
    assert.equal(liveHost!.requireSession().getSelectableViewModel().processing_task_options.find(item => item.id === thirdTask)!.status, 'completed');
    assert.deepEqual(submittedCommands.slice(readyCommands), ['menu_confirm_processing_direct', ...Array(8).fill('refresh'), 'menu_confirm_processing_direct'],
      'only the user explicitly triggers the later collection');
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
  const processingLot = rect(probe.labels.processingQuantityUnit.node);
  assert.ok(processingInput.left >= -480 && processingInput.right <= 480 && processingInput.bottom >= -270 && processingInput.top <= 270,
    'processing quantity input stays within the design viewport');
  assert.ok(processingInput.top <= processingLot.bottom || processingLot.top <= processingInput.bottom,
    'processing quantity input does not overlap its unit explanation');
  for (const [name, item] of [['split input', quantityInput], ['split unit', quantityUnit]] as const) {
    assert.ok(item.left >= -480 && item.right <= 480 && item.bottom >= -270 && item.top <= 270,
      `${name} stays within the design viewport`);
  }
  assert.ok(quantityInput.right <= quantityUnit.left || quantityUnit.right <= quantityInput.left
    || quantityInput.top <= quantityUnit.bottom || quantityUnit.top <= quantityInput.bottom,
    'split quantity input and unit label do not overlap');
  const separate = (a: any, b: any) => a.right <= b.left || b.right <= a.left || a.top <= b.bottom || b.top <= a.bottom;
  const farmItems = probe.farmNode.children.map((node: any) => ({ name: node.name, rect: rect(node) }));
  for (let i = 0; i < farmItems.length; i++) {
    const { name, rect: item } = farmItems[i];
    assert.ok(item.left >= -480 && item.right <= 480 && item.bottom >= -250 && item.top <= 250, `farm/${name} remains within the design viewport`);
    for (let j = 0; j < i; j++) assert.ok(separate(item, farmItems[j].rect), `farm/${name} overlaps ${farmItems[j].name}`);
  }
  for (const [pageName, page] of Object.entries(probe.processingPages) as Array<[string, any]>) {
    const items = page.children.map((node: any) => ({ name: node.name, rect: rect(node) }));
    for (let i = 0; i < items.length; i++) {
      const { name, rect: item } = items[i];
      assert.ok(item.left >= -480 && item.right <= 480 && item.bottom >= -250 && item.top <= 250,
        `${pageName}/${name} remains within the design viewport and bottom reserve`);
      for (let j = 0; j < i; j++) assert.ok(separate(item, items[j].rect), `${pageName}/${name} overlaps ${items[j].name}`);
    }
  }
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
    for (const name of ['FarmMinus', 'FarmPlus', 'FarmSeeds1', 'FarmSeeds2', 'FarmSeeds3', 'FarmPlant', 'FarmHarvest', 'StockMove', 'StockSplit', 'SplitBack', 'SplitRefresh', 'SplitConfirm']) {
      const action = rect(probe.menuButtons[name].node);
      assert.ok(control.top <= action.bottom || action.top <= control.bottom || control.right <= action.left || action.right <= control.left,
        `${button.node.name} must not overlap ${name}`);
    }
  }
  assert.ok(probe.labels.hint.lineHeight <= hint.top - hint.bottom, 'hint line fits in its label height');
  probe.onCancelFirst();
  assert.equal(probe.labels.hint.string, '再点一次：撤销未完成首档，保留当前游戏');
  assert.match(probe.errorText('ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN'), /待确认.*核实/);
  assert.match(probe.errorText('ERR_WECHAT_PROBE_ACTION_FAILED:ERR_STORAGE_CAPACITY_OVERFLOW'), /储存空间不足.*整理库存/);
  assert.match(probe.errorText('ERR_WECHAT_PROBE_ACTION_FAILED:ERR_FIELD_CAPACITY_EXCEEDED'), /土地空间不足/);
  assert.match(probe.errorText('ERR_WECHAT_PROBE_ACTION_FAILED:ERR_NOT_ENOUGH_RESOURCE'), /材料数量不足/);
  assert.match(probe.errorText('ERR_WECHAT_PROBE_ACTION_FAILED:ERR_PLANT_QUANTITY_INVALID'), /正整数/);
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
  probe.page = 'processingSummary';
  probe.menuHandler('ProcessingSummaryStart')(); await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(probe.labels.hint.string, '加工已开工', 'a missing start receipt cannot report success');
  fakeReceipt = { processing_result: { actionType: 'collect_processing_result', taskId: 'other', lotId: 'lot' } };
  probe.menuHandler('ProcessingSummaryStart')(); await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(probe.labels.hint.string, '加工已开工', 'a wrong action cannot report start success');
  probe.page = 'processingTaskDetail'; probe.processingTaskId = 'expected';
  probe.menuHandler('ProcessingTaskDetailCollect')(); await new Promise(resolve => setImmediate(resolve));
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
