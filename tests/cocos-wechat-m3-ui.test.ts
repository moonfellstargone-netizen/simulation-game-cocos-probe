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
  probe.labels = Object.fromEntries(['candidate', 'commit', 'time', 'status', 'result', 'hint', 'farmField', 'farmSeed', 'farmCrop', 'stockLot', 'stockTarget', 'stockHelp', 'splitLot', 'splitUnit', 'splitPreview'].map(name => [name, { string: '' }]));
  probe.farmNode = { active: true }; probe.stockNode = { active: false }; probe.splitNode = { active: false };
  probe.splitInput = { string: '', enabled: false, focused: false, isFocused() { return this.focused; }, blur() { this.focused = false; } };
  const names = ['PageFarm', 'PageStock', 'AdvanceDay', 'FarmField', 'FarmSeed', 'FarmCrop', 'FarmMinus', 'FarmPlus', 'FarmPlant', 'FarmHarvest', 'StockLot', 'StockTarget', 'StockMove', 'StockSplit', 'SplitBack', 'SplitPreview', 'SplitConfirm'];
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
    for (const name of ['FarmMinus', 'FarmPlus', 'FarmPlant', 'FarmHarvest', 'StockMove', 'StockSplit', 'SplitBack', 'SplitPreview', 'SplitConfirm']) {
      const action = rect(probe.menuButtons[name].node);
      assert.ok(control.top <= action.bottom || action.top <= control.bottom || control.right <= action.left || action.right <= control.left,
        `${button.node.name} must not overlap ${name}`);
    }
  }
  assert.ok(probe.labels.hint.lineHeight <= hint.top - hint.bottom, 'hint line fits in its label height');
  probe.onCancelFirst();
  assert.equal(probe.labels.hint.string, '再点一次：撤销未完成首档，保留当前游戏');
  // Check production onLoad registers and onDestroy removes the actual text-change callback.
  let changes = 0;
  const textChanged = probe.onSplitTextChanged.bind(probe);
  probe.onSplitTextChanged = () => { changes++; textChanged(); };
  probe.loadJson = () => new Promise(() => {});
  const oldInfo = console.info; console.info = () => {};
  try {
    probe.onLoad();
    const inputNode = probe.splitInput.node;
    probe.splitInput.string = '0.5';
    inputNode.emit('text-changed');
    assert.equal(changes, 1, 'registered EditBox event reaches the production callback');
    probe.onDestroy();
    inputNode.emit('text-changed');
    assert.equal(changes, 1, 'destroy removes the text-change callback');
  } finally { console.info = oldInfo; }
});
