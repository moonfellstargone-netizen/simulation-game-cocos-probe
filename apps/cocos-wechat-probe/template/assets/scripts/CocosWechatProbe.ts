import { _decorator, Button, Camera, Canvas, Color, Component, EditBox, Game, game, Graphics, isValid,
  JsonAsset, Label, Layers, Node, resources, ResolutionPolicy, screen, sys, UITransform, view } from 'cc';
import { createStage1AHost, QinglanUiSceneProbeComponent } from '../generated/probe-runtime.js';
import { WechatProbeController, type WechatProbeSnapshot, type WechatResources } from './WechatProbeController';
import { WECHAT_BACKUP_SLOT_ID, WECHAT_SAVE_SLOT_ID, WechatSaveStoragePort } from './WechatSaveStoragePort';
import { createWechatPriorSaveValidator } from './WechatPriorSaveValidator';

const { ccclass } = _decorator;
const UNITS: Record<string, string> = { count: '粒', g: '克', ml: '毫升', bundle: '捆', serving: '份', slot_weight: '容量点' };
const STORAGE: Record<string, string> = { room_temp: '常温储存', cellar: '菜窖' };
const FORMS: Record<string, string> = { fresh: '鲜材', cut: '切好', cured: '腌腊', pickled: '腌菜' };
// These definitions have no display_name_key in the current formal resources.
const PROCESSING_NAMES: Record<string, string> = { pickling_jar_basic: '基础腌菜坛', knife_basic: '基础刀具', vegetable: '蔬菜' };

// Display names come from the formal resource snapshot, never from SaveFile.
function presentationNames(resources: WechatResources): Record<string, string> {
  const docs = (resources.snapshot as { loaded_documents?: Record<string, unknown> }).loaded_documents ?? {};
  const text = docs['configs/text/zh_cn.yaml'] as Record<string, unknown> | undefined;
  const names: Record<string, string> = {};
  for (const value of Object.values(docs)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const doc = value as { id?: unknown; display_name_key?: unknown; forms?: Record<string, { display_name_key?: string }>; field_plot_definitions?: Record<string, { display_name_key?: string }> };
    if (typeof doc.id === 'string' && typeof doc.display_name_key === 'string' && typeof text?.[doc.display_name_key] === 'string') names[doc.id] = text[doc.display_name_key] as string;
    for (const [id, field] of Object.entries(doc.field_plot_definitions ?? {})) {
      if (field.display_name_key && typeof text?.[field.display_name_key] === 'string') names[id] = text[field.display_name_key] as string;
    }
    if (typeof doc.id === 'string') for (const [form, definition] of Object.entries(doc.forms ?? {})) {
      if (definition.display_name_key && typeof text?.[definition.display_name_key] === 'string') names[`${doc.id}:${form}`] = text[definition.display_name_key] as string;
    }
  }
  return names;
}

@ccclass('CocosWechatProbe')
export class CocosWechatProbe extends Component {
  private controller: WechatProbeController | null = null;
  private labels: Record<string, Label> = {};
  private button: Button | null = null;
  private saveButton: Button | null = null;
  private loadButton: Button | null = null;
  private backupButton: Button | null = null;
  private cancelFirstButton: Button | null = null;
  private confirmCancelFirst = false;
  private lastCommandWasRead = false;
  private clickCount = 0;
  private names: Record<string, string> = {};
  private page: 'farm' | 'stock' | 'split' | 'processing' | 'processingMethods' | 'processingMaterials' | 'processingLots' | 'processingQuantity' | 'processingFacilities' | 'processingSummary' | 'processingReview' | 'processingTasks' | 'processingTaskDetail' | 'processingInfo' = 'farm';
  private processingNode: Node | null = null;
  private processingInput: EditBox | null = null;
  private processingMethodId: string | null = null;
  private processingRequirement = 0;
  private processingFacilityId: string | null = null;
  private processingTaskId: string | null = null;
  private processingInputs: Record<string, { lotId: string; amount: string }> = {};
  private processingHintGeneration = 0;
  private processingActionsPending = 0;
  private processingActionInterrupted = false;
  private processingStartLocked = false;
  private processingReviewRequired = false;
  private processingCollectLocks = new Set<string>();
  private processingPages: Record<string, Node> = {};
  private processingBaseNodes: Node[] = [];
  private processingReturnPage: typeof this.page = 'processing';
  private processingPageIndexes: Record<string, number> = {};
  private processingEditingKey: string | null = null;
  private processingPendingLotId: string | null = null;
  private farmNode: Node | null = null;
  private stockNode: Node | null = null;
  private splitNode: Node | null = null;
  private splitInput: EditBox | null = null;
  private splitNeedsReview = false;
  private splitPendingText: string | null = null;
  private splitHintGeneration = 0;
  private menuButtons: Record<string, Button> = {};
  private menuHandlers: Record<string, () => void> = {};
  private fieldId: string | null = null;
  private seedId: string | null = null;
  private cropId: string | null = null;
  private lotId: string | null = null;
  private targetId: string | null = null;
  private seedAmount = 1;

  onLoad(): void {
    this.createView();
    let storage: WechatSaveStoragePort | null = null;
    let validateSaved: ((serialized: string) => Promise<void>) | null = null;
    this.controller = new WechatProbeController({
      load: async () => {
        const [loadedResources, identity] = await Promise.all([this.loadJson('probe-resources'), this.loadJson('candidate-identity')]);
        this.names = presentationNames(loadedResources as WechatResources);
        return { resources: loadedResources as WechatResources, identity };
      },
      createHost: input => {
        validateSaved = createWechatPriorSaveValidator(validationStorage => createStage1AHost({
          ...input, storage: validationStorage, nowIso8601: new Date().toISOString()
        }));
        storage = new WechatSaveStoragePort(() => {
          // Creator may replace sys.localStorage with a warning-only stub on initialization failure.
          if (!window.localStorage || sys.localStorage !== window.localStorage) throw new Error('ERR_WECHAT_STORAGE_UNAVAILABLE');
          return sys.localStorage;
        }, validateSaved);
        return createStage1AHost({ ...input, storage, nowIso8601: new Date().toISOString() });
      },
      createBinding: host => new QinglanUiSceneProbeComponent(host, { applyNodeBindingPatch: patch => {
        if (patch.section === 'menu') this.controller?.acceptMenuPatch(patch.payload);
      } }),
      prepareBackupRecovery: async () => {
        if (!storage || !validateSaved) throw new Error('ERR_WECHAT_STORAGE_UNAVAILABLE');
        await storage.assertBackupRecoveryAvailable();
        const backup = await storage.read(WECHAT_BACKUP_SLOT_ID);
        if (backup === null) throw new Error('ERR_WECHAT_SAVE_BACKUP_MISSING');
        await validateSaved(backup);
      },
      recoverValidatedBackup: () => {
        if (!storage) return Promise.reject(new Error('ERR_WECHAT_STORAGE_UNAVAILABLE'));
        return storage.finishBackupRecoveryAfterValidatedRead();
      },
      cancelFirstFailedSave: async () => {
        if (!storage) throw new Error('ERR_WECHAT_STORAGE_UNAVAILABLE');
        await storage.assertFirstFailedSaveCancelable();
        await storage.cancelFirstFailedSave();
      },
      onChange: state => this.render(state)
    });
    this.button!.node.on(Button.EventType.CLICK, this.onAdvance, this);
    this.saveButton!.node.on(Button.EventType.CLICK, this.onSave, this);
    this.loadButton!.node.on(Button.EventType.CLICK, this.onRead, this);
    this.backupButton!.node.on(Button.EventType.CLICK, this.onReadBackup, this);
    this.cancelFirstButton!.node.on(Button.EventType.CLICK, this.onCancelFirst, this);
    this.splitInput!.node.on(EditBox.EventType.TEXT_CHANGED, this.onSplitTextChanged, this);
    this.processingInput!.node.on(EditBox.EventType.TEXT_CHANGED, this.onProcessingTextChanged, this);
    for (const [name, button] of Object.entries(this.menuButtons)) {
      const handler = this.menuHandler(name);
      this.menuHandlers[name] = handler;
      button.node.on(Button.EventType.CLICK, handler, this);
    }
    game.on(Game.EVENT_HIDE, this.onHide, this);
    game.on(Game.EVENT_SHOW, this.onShow, this);
    console.info('[wechat-m1] viewport', JSON.stringify({ visible: view.getVisibleSize(), window: screen.windowSize,
      devicePixelRatio: screen.devicePixelRatio }));
    void this.controller.start().catch(error => console.error('[wechat-m1] startup-failed', String(error)));
  }

  onDestroy(): void {
    if (this.button && isValid(this.button.node, true)) this.button.node.off(Button.EventType.CLICK, this.onAdvance, this);
    if (this.saveButton && isValid(this.saveButton.node, true)) this.saveButton.node.off(Button.EventType.CLICK, this.onSave, this);
    if (this.loadButton && isValid(this.loadButton.node, true)) this.loadButton.node.off(Button.EventType.CLICK, this.onRead, this);
    if (this.backupButton && isValid(this.backupButton.node, true)) this.backupButton.node.off(Button.EventType.CLICK, this.onReadBackup, this);
    if (this.cancelFirstButton && isValid(this.cancelFirstButton.node, true)) this.cancelFirstButton.node.off(Button.EventType.CLICK, this.onCancelFirst, this);
    if (this.splitInput && isValid(this.splitInput.node, true)) this.splitInput.node.off(EditBox.EventType.TEXT_CHANGED, this.onSplitTextChanged, this);
    if (this.processingInput && isValid(this.processingInput.node, true)) this.processingInput.node.off(EditBox.EventType.TEXT_CHANGED, this.onProcessingTextChanged, this);
    for (const [name, button] of Object.entries(this.menuButtons)) if (isValid(button.node, true)) button.node.off(Button.EventType.CLICK, this.menuHandlers[name], this);
    game.off(Game.EVENT_HIDE, this.onHide, this);
    game.off(Game.EVENT_SHOW, this.onShow, this);
    this.controller?.invalidateSplitPreview();
    this.controller?.invalidateProcessingPreview();
    this.processingHintGeneration++;
    void this.controller?.dispose().catch(error => console.error('[wechat-m1] close-failed', String(error)));
  }

  private onAdvance(): void {
    this.finishSplitEditing();
    this.resetCancelConfirmation();
    this.invalidateSplit();
    this.setCommandReadContext(false);
    this.clickCount++;
    console.info('[wechat-m1] button-click', JSON.stringify({ click_count: this.clickCount, candidate_id: this.controller?.snapshot().identity?.candidate_id }));
    void this.controller?.advance().catch(error => console.error('[wechat-m1] action-failed', String(error)));
  }

  private onSave(): void { this.finishSplitEditing(); this.resetCancelConfirmation(); this.invalidateSplit(); this.setCommandReadContext(false); void this.controller?.save().catch(error => console.error('[wechat-m2] save-failed', String(error))); }
  private onRead(): void {
    this.finishSplitEditing();
    this.resetCancelConfirmation();
    this.invalidateSplit();
    this.setCommandReadContext(true);
    this.clearProcessingSelection();
    void this.controller?.load().catch(error => {
      if (error instanceof Error && error.message === `ERR_SAVE_SLOT_NOT_FOUND:${WECHAT_SAVE_SLOT_ID}`) {
        console.info('[wechat-m2] empty-save-slot', WECHAT_SAVE_SLOT_ID);
      } else console.error('[wechat-m2] load-failed', String(error));
    });
  }
  private onReadBackup(): void { this.finishSplitEditing(); this.resetCancelConfirmation(); this.invalidateSplit(); this.clearProcessingSelection(); this.setCommandReadContext(false); void this.controller?.loadBackup().catch(error => console.error('[wechat-m2] backup-load-failed', String(error))); }
  private onCancelFirst(): void {
    this.finishSplitEditing();
    this.invalidateSplit();
    this.setCommandReadContext(false);
    if (!this.confirmCancelFirst) {
      this.confirmCancelFirst = true;
      this.labels.hint.string = '再点一次：撤销未完成首档，保留当前游戏';
      return;
    }
    this.resetCancelConfirmation();
    void this.controller?.cancelFirstFailedSave().catch(error => console.error('[wechat-m2] cancel-first-failed', String(error)));
  }
  private resetCancelConfirmation(): void {
    this.confirmCancelFirst = false;
    if (this.labels.hint) this.labels.hint.string = '手动保存与读取；可选择恢复失败存档';
  }
  private setCommandReadContext(isRead: boolean): void {
    const state = this.controller?.snapshot();
    if (state?.phase === 'ready' && !state.busy && state.visible) this.lastCommandWasRead = isRead;
  }
  private invalidateSplit(): void { this.splitHintGeneration++; this.controller?.invalidateSplitPreview(); this.controller?.invalidateProcessingPreview(); this.processingHintGeneration++; }
  private finishSplitEditing(): void { if (this.splitInput?.isFocused()) this.splitInput.blur(); if (this.processingInput?.isFocused()) this.processingInput.blur(); }
  private onProcessingTextChanged(): void {
    this.resetCancelConfirmation();
    this.processingHintGeneration++;
    const state = this.controller?.snapshot();
    if (!state || state.phase !== 'ready' || state.busy || !state.visible) { this.syncProcessingInput(); return; }
    this.controller?.invalidateProcessingPreview();
    if (state && isValid(this.node, true)) this.renderMenu(state);
  }
  private onSplitTextChanged(): void {
    const current = this.controller?.snapshot();
    if (!current || current.phase !== 'ready' || current.busy || !current.visible || this.splitNeedsReview) {
      if (this.splitInput && this.splitPendingText !== null) this.splitInput.string = this.splitPendingText;
      return;
    }
    this.resetCancelConfirmation();
    this.invalidateSplit();
    const state = this.controller?.snapshot();
    if (state && isValid(this.node, true)) this.renderMenu(state);
  }
  private onHide(): void {
    if (this.processingActionsPending > 0) this.processingActionInterrupted = true;
    if (this.splitPendingText !== null) this.splitNeedsReview = true;
    this.finishSplitEditing(); this.resetCancelConfirmation(); this.invalidateSplit(); this.controller?.setVisible(false);
  }
  private onShow(): void {
    this.controller?.setVisible(true);
    if (this.processingActionInterrupted) {
      this.processingActionInterrupted = false;
      this.labels.hint.string = '后台操作结果请查看任务和库存核实';
    }
  }

  private menuHandler(name: string): () => void {
    return () => {
      const beforeEditing = this.controller?.snapshot();
      if (!beforeEditing || beforeEditing.phase !== 'ready' || beforeEditing.busy || !beforeEditing.visible) return;
      if (this.menuButtons[name]?.node.activeInHierarchy === false) return;
      this.finishSplitEditing();
      const state = this.controller?.snapshot();
      if (!state || state.phase !== 'ready' || state.busy || !state.visible) return;
      if (name !== 'ProcessingCancel') this.resetCancelConfirmation();
      if (name !== 'SplitConfirm') this.invalidateSplit();
      const options = state.menu?.selectable_view_model;
      if (this.handleProcessing(name, state)) { this.renderMenu(this.controller!.snapshot()); return; }
      if (name === 'PageFarm') this.page = 'farm';
      else if (name === 'PageStock') this.page = 'stock';
      else if (name === 'StockSplit') this.page = 'split';
      else if (name === 'SplitBack') this.page = 'stock';
      else if (name === 'FarmField') this.fieldId = this.next(options?.field_options.filter(x => x.enabled) ?? [], this.fieldId);
      else if (name === 'FarmSeed') { this.seedId = this.next(options?.seed_lot_options.filter(x => x.enabled) ?? [], this.seedId); this.seedAmount = 1; }
      else if (name === 'FarmCrop') this.cropId = this.next(options?.harvestable_crop_options.filter(x => x.enabled) ?? [], this.cropId);
      else if (name === 'FarmMinus' && this.seedId !== null) this.seedAmount = Math.max(1, this.seedAmount - 1);
      else if (name === 'FarmPlus' && this.seedId !== null && Number.isSafeInteger(this.seedAmount + 1)) this.seedAmount++;
      else if (name === 'StockLot') { this.lotId = this.next(options?.splittable_lot_options ?? [], this.lotId); if (this.splitInput) this.splitInput.string = ''; }
      else if (name === 'StockTarget') this.targetId = this.next(options?.storage_target_options ?? [], this.targetId);
      else {
        const seed = options?.seed_lot_options.find(x => x.id === this.seedId && x.enabled);
        const field = options?.field_options.find(x => x.id === this.fieldId && x.enabled);
        const crop = options?.harvestable_crop_options.find(x => x.id === this.cropId && x.enabled);
        const lot = options?.splittable_lot_options.find(x => x.id === this.lotId && x.enabled);
        const target = options?.storage_target_options.find(x => x.id === this.targetId && x.enabled);
        let action: Promise<WechatProbeSnapshot> | null = null;
        let done = '';
        if (name === 'SplitRefresh') this.refreshSplit();
        else if (name === 'SplitConfirm' && lot) this.confirmSplit(lot);
        if (name === 'AdvanceDay') { action = this.controller!.advanceDay(); done = '已推进一天'; }
        else if (name === 'FarmPlant' && field && seed) { action = this.controller!.plant(field.id, seed.id, { amount: this.seedAmount, unit: seed.quantity.unit }); done = '播种完成'; }
        else if (name === 'FarmHarvest' && crop) { action = this.controller!.harvest(crop.id); done = '收获完成'; }
        else if (name === 'StockMove' && lot && target && target.id !== lot.storage_ref.container_id) { action = this.controller!.move(lot.id, target.id); done = '转移完成'; }
        if (action) {
          this.lastCommandWasRead = false;
          const generation = this.splitHintGeneration;
          void action.then(() => { if (isValid(this.node, true) && this.controller?.snapshot().phase === 'ready'
              && this.controller.snapshot().visible && generation === this.splitHintGeneration) this.labels.hint.string = done; })
            .catch(error => { if (isValid(this.node, true) && this.controller?.snapshot().visible && generation === this.splitHintGeneration)
              this.labels.hint.string = this.errorText(String(error));
              console.error('[wechat-m3] action-failed', String(error)); });
        }
      }
      this.renderMenu(this.controller!.snapshot());
    };
  }

  private processingItems(): Array<[string, { lotId: string; amount: string }]> {
    return Object.entries(this.processingInputs).filter(([key]) => Number(key.split(':')[0]) === this.processingRequirement);
  }
  private processingOffset(key: string, count: number, size: number): number {
    const max = Math.max(0, Math.ceil(count / size) - 1);
    this.processingPageIndexes[key] = Math.min(Math.max(0, this.processingPageIndexes[key] ?? 0), max);
    return this.processingPageIndexes[key] * size;
  }
  private changeProcessingPage(key: string, delta: number): void {
    this.processingPageIndexes[key] = Math.max(0, (this.processingPageIndexes[key] ?? 0) + delta);
  }
  private handleProcessing(name: string, state: WechatProbeSnapshot): boolean {
    const options = state.menu?.selectable_view_model;
    const methods = options?.processing_method_options ?? [];
    const method = methods.find(item => item.id === this.processingMethodId);
    const requirement = method?.input_requirements[this.processingRequirement];
    const lots = (options?.processable_lot_options ?? []).filter(item => item.enabled && requirement?.lot_ids.includes(item.id));
    const facilities = (options?.processing_facility_options ?? []).filter(item => method?.compatible_facility_ids.includes(item.id));
    const tasks = options?.processing_task_options ?? [];
    const itemIndex = (prefix: string): number | null => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)) ? Number(name.slice(prefix.length)) : null;
    const navigate = (key: string, prefix: string): boolean => {
      if (name === prefix + 'Prev') { this.changeProcessingPage(key, -1); return true; }
      if (name === prefix + 'Next') { this.changeProcessingPage(key, 1); return true; }
      return false;
    };
    if (name === 'PageProcessing') { this.page = 'processing'; return true; }
    if (!name.startsWith('Processing')) return false;
    if (name === 'ProcessingExit') { this.page = 'farm'; return true; }
    if (name === 'ProcessingInfo') {
      if (this.page !== 'processingInfo') this.processingReturnPage = this.page;
      this.page = 'processingInfo'; return true;
    }
    if (name === 'ProcessingInfoBack') { this.page = this.processingReturnPage; return true; }
    if (name === 'ProcessingSave') { this.onSave(); return true; }
    if (name === 'ProcessingLoad') { this.onRead(); return true; }
    if (name === 'ProcessingBackup') { this.onReadBackup(); return true; }
    if (name === 'ProcessingCancel') { this.onCancelFirst(); return true; }
    if (name === 'ProcessingAdvanceHour') { this.onAdvance(); return true; }
    if (name === 'ProcessingAdvanceDay') { void this.controller!.advanceDay().catch(error => console.error('[wechat-m3] advance-failed', String(error))); return true; }
    if (name === 'ProcessingChooseMethod') { this.page = 'processingMethods'; return true; }
    if (name === 'ProcessingMethodsBack') { this.page = 'processing'; return true; }
    if (navigate('methods', 'ProcessingMethods')) return true;
    const selectedMethod = itemIndex('ProcessingMethod');
    if (selectedMethod !== null) {
      const chosen = methods[this.processingOffset('methods', methods.length, 3) + selectedMethod];
      if (chosen?.enabled) {
        if (chosen.id !== this.processingMethodId) {
          const changed = this.processingMethodId !== null;
          this.clearProcessingSelection(); this.processingMethodId = chosen.id;
          if (changed) this.labels.hint.string = '已切换方法，之前的材料和设施选择已清除';
        }
        this.page = 'processing';
      }
      return true;
    }
    if (navigate('requirements', 'ProcessingRequirements')) return true;
    const selectedRequirement = itemIndex('ProcessingRequirement');
    if (selectedRequirement !== null) {
      if (this.processingReviewRequired) { this.labels.hint.string = '请先重新核对任务和库存'; return true; }
      const index = this.processingOffset('requirements', method?.input_requirements.length ?? 0, 2) + selectedRequirement;
      if (method?.input_requirements[index]) { this.processingRequirement = index; this.processingPageIndexes.materials = 0; this.page = 'processingMaterials'; }
      return true;
    }
    if (name === 'ProcessingChooseFacility') { this.page = 'processingFacilities'; return true; }
    if (name === 'ProcessingSummary') { this.page = 'processingSummary'; return true; }
    if (name === 'ProcessingTasks') { this.page = 'processingTasks'; return true; }
    if (name === 'ProcessingMaterialsBack') { this.page = 'processing'; return true; }
    if (name === 'ProcessingAddLot') {
      if (this.processingReviewRequired) { this.labels.hint.string = '请先重新核对任务和库存'; return true; }
      this.processingPageIndexes.lots = 0; this.page = 'processingLots'; return true;
    }
    if (navigate('materials', 'ProcessingMaterials')) return true;
    const edit = itemIndex('ProcessingEdit');
    const remove = itemIndex('ProcessingRemove');
    if (edit !== null || remove !== null) {
      if (this.processingReviewRequired) { this.labels.hint.string = '请先重新核对任务和库存'; return true; }
      const items = this.processingItems();
      const item = items[this.processingOffset('materials', items.length, 2) + (edit ?? remove!)];
      if (item && remove !== null) delete this.processingInputs[item[0]];
      else if (item) {
        this.processingEditingKey = item[0]; this.processingPendingLotId = item[1].lotId;
        if (this.processingInput) this.processingInput.string = item[1].amount;
        this.page = 'processingQuantity';
      }
      return true;
    }
    if (name === 'ProcessingLotsBack') { this.page = 'processingMaterials'; return true; }
    if (navigate('lots', 'ProcessingLots')) return true;
    const lotIndex = itemIndex('ProcessingLot');
    if (lotIndex !== null) {
      const lot = lots[this.processingOffset('lots', lots.length, 3) + lotIndex];
      if (lot) {
        this.processingPendingLotId = lot.id; this.processingEditingKey = null;
        if (this.processingInput) this.processingInput.string = '';
        this.page = 'processingQuantity';
      }
      return true;
    }
    if (name === 'ProcessingQuantityBack') { this.page = this.processingEditingKey ? 'processingMaterials' : 'processingLots'; return true; }
    if (name === 'ProcessingQuantitySave') {
      if (this.processingReviewRequired) { this.labels.hint.string = '请先重新核对任务和库存'; return true; }
      const text = this.processingInput?.string.trim() ?? '';
      const amount = Number(text);
      if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(amount) || amount <= 0) {
        this.labels.hint.string = '请输入大于零的有效数量'; return true;
      }
      if (!lots.some(item => item.id === this.processingPendingLotId)) { this.labels.hint.string = '材料已变化，请重新选择'; return true; }
      let key = this.processingEditingKey;
      if (!key) { let slot = 0; while (this.processingInputs[`${this.processingRequirement}:${slot}`]) slot++; key = `${this.processingRequirement}:${slot}`; }
      this.processingInputs[key] = { lotId: this.processingPendingLotId!, amount: text };
      this.processingEditingKey = null; this.processingPendingLotId = null; this.page = 'processingMaterials';
      return true;
    }
    if (name === 'ProcessingFacilitiesBack') { this.page = 'processing'; return true; }
    if (navigate('facilities', 'ProcessingFacilities')) return true;
    const facilityIndex = itemIndex('ProcessingFacility');
    if (facilityIndex !== null) {
      const facility = facilities[this.processingOffset('facilities', facilities.length, 3) + facilityIndex];
      if (facility?.enabled) { this.processingFacilityId = facility.id; this.page = 'processing'; }
      return true;
    }
    if (name === 'ProcessingSummaryBack') { this.page = 'processing'; return true; }
    if ((name === 'ProcessingStartRefresh' || name === 'ProcessingSummaryRefresh') && this.processingReviewRequired) {
      const page = this.page; const generation = this.processingHintGeneration;
      if (page !== 'processing' && page !== 'processingSummary') return true;
      void this.controller!.refreshProcessingView().then(result => {
        if (!this.canShowProcessingHint(generation, page)) return;
        const fresh = result.menu?.selectable_view_model;
        if (!fresh || !Array.isArray(fresh.processing_task_options) || !Array.isArray(fresh.collectable_task_options)
            || !Array.isArray(fresh.processable_lot_options) || !Array.isArray(fresh.splittable_lot_options)) {
          this.labels.hint.string = '核对未完成，请再次核对'; return;
        }
        this.processingInputs = {};
        this.processingEditingKey = null;
        this.processingPendingLotId = null;
        this.syncProcessingInput();
        this.processingReviewRequired = false;
        this.page = 'processingReview';
        this.renderMenu(this.controller!.snapshot());
        this.labels.hint.string = '请查看任务和库存，再重新选择材料';
      }).catch(error => {
        if (this.canShowProcessingHint(generation, page)) this.labels.hint.string = '核对未完成，请再次核对';
        console.error('[wechat-m3] processing-review-failed', String(error));
      });
      return true;
    }
    if (name === 'ProcessingReviewTasks') { this.page = 'processingTasks'; return true; }
    if (name === 'ProcessingReviewStock') { this.page = 'stock'; return true; }
    if (name === 'ProcessingReviewBack') { this.page = 'processing'; return true; }
    if (navigate('summary', 'ProcessingSummary')) return true;
    if (name === 'ProcessingSummaryPreview' || name === 'ProcessingSummaryStart') {
      if (name === 'ProcessingSummaryStart' && this.processingStartLocked) {
        this.labels.hint.string = '上次开工仍在处理，请查看任务和库存核实'; return true;
      }
      if (name === 'ProcessingSummaryStart' && this.processingReviewRequired) {
        this.labels.hint.string = '请先核实任务和库存，再重新选择材料'; return true;
      }
      const selection = this.processingSelection();
      if (!selection) { this.labels.hint.string = '请选择方法、设施并填写有效材料数量'; return true; }
      const generation = this.processingHintGeneration;
      const previewing = name === 'ProcessingSummaryPreview';
      const submitted = Object.entries(this.processingInputs).map(([key, input]) => [key, { ...input }] as const);
      const submittedMethodId = this.processingMethodId;
      this.lastCommandWasRead = false;
      if (!previewing) { this.processingActionsPending++; this.processingStartLocked = true; }
      const command = previewing ? this.controller!.previewProcessing(selection) : this.controller!.confirmProcessing(selection);
      void command.then(result => {
        if (previewing) {
          if (!this.canShowProcessingHint(generation, 'processingSummary')) return;
          const preview = result.processing_preview;
          if (preview?.actionType === 'start_processing') this.labels.hint.string = preview.success ? '预览通过，尚未开工' : `预览未通过：${this.processingError(preview.statusCode)}`;
        } else {
          this.clearSubmittedProcessingInputs(submittedMethodId, submitted);
          if (this.canShowProcessingHint(generation, 'processingSummary') && result.processing_result?.actionType === 'start_processing' && result.processing_result.taskId) {
            this.processingReviewRequired = false;
            this.processingTaskId = result.processing_result.taskId;
            this.page = 'processingTaskDetail';
            this.renderMenu(this.controller!.snapshot());
            this.labels.hint.string = '加工已开工，可查看任务';
          } else this.processingReviewRequired = true;
        }
      }).catch(error => {
        const reason = error instanceof Error ? error.message : String(error);
        if (!previewing && !reason.startsWith('ERR_WECHAT_PROBE_ACTION_FAILED:')) {
          this.clearSubmittedProcessingInputs(submittedMethodId, submitted);
          this.processingReviewRequired = true;
        }
        if (this.canShowProcessingHint(generation, 'processingSummary')) this.labels.hint.string = this.processingError(reason);
        console.error('[wechat-m3] processing-failed', reason);
      }).finally(() => {
        if (!previewing) {
          this.processingActionsPending--; this.processingStartLocked = false;
          if (isValid(this.node, true) && this.controller?.snapshot().phase === 'ready') this.renderMenu(this.controller.snapshot());
        }
      });
      return true;
    }
    if (name === 'ProcessingTasksBack') { this.page = 'processing'; return true; }
    if (navigate('tasks', 'ProcessingTasks')) return true;
    const taskIndex = itemIndex('ProcessingTask');
    if (taskIndex !== null) {
      const task = tasks[this.processingOffset('tasks', tasks.length, 3) + taskIndex];
      if (task) { this.processingTaskId = task.id; this.page = 'processingTaskDetail'; }
      return true;
    }
    if (name === 'ProcessingTaskDetailBack') { this.page = 'processingTasks'; return true; }
    if (name === 'ProcessingTaskDetailRefresh' && this.processingTaskId && this.processingCollectLocks.has(this.processingTaskId)) {
      const taskId = this.processingTaskId; const generation = this.processingHintGeneration;
      void this.controller!.refreshProcessingView().then(result => {
        if (!this.canShowProcessingHint(generation, 'processingTaskDetail')) return;
        const outcome = this.processingCollectState(result.menu?.selectable_view_model ?? null, taskId);
        if (outcome === 'invalid') { this.labels.hint.string = '任务状态待核实，暂不能领取'; return; }
        this.processingCollectLocks.delete(taskId);
        this.labels.hint.string = '已重新核对任务，请查看当前状态';
        this.renderMenu(this.controller!.snapshot());
      }).catch(error => {
        if (this.canShowProcessingHint(generation, 'processingTaskDetail')) this.labels.hint.string = '重新核对未完成，领取仍待核实';
        console.error('[wechat-m3] processing-refresh-failed', String(error));
      });
      return true;
    }
    if (name === 'ProcessingTaskDetailCollect' && this.processingTaskId) {
      const taskId = this.processingTaskId; const generation = this.processingHintGeneration;
      if (this.processingCollectLocks.has(taskId)) { this.labels.hint.string = '领取结果待核实，请查看任务和库存'; return true; }
      if (this.processingCollectState(options ?? null, taskId) !== 'ready') { this.labels.hint.string = '任务当前不可领取，请重新核对'; return true; }
      this.lastCommandWasRead = false;
      this.processingCollectLocks.add(taskId);
      this.processingActionsPending++;
      void this.controller!.confirmProcessing({ action_type: 'collect_processing_result', task_option_id: taskId }).then(result => {
        if (this.canShowProcessingHint(generation, 'processingTaskDetail') && result.processing_result?.actionType === 'collect_processing_result'
            && result.processing_result.taskId === taskId && result.processing_result.lotId) {
          this.processingCollectLocks.delete(taskId);
          this.labels.hint.string = '加工产物已领取';
        }
      }).catch(error => {
        const reason = error instanceof Error ? error.message : String(error);
        if (reason.startsWith('ERR_WECHAT_PROBE_ACTION_FAILED:')) this.processingCollectLocks.delete(taskId);
        if (this.canShowProcessingHint(generation, 'processingTaskDetail')) this.labels.hint.string = this.processingError(reason);
        console.error('[wechat-m3] processing-collect-failed', reason);
      }).finally(() => {
        this.processingActionsPending--;
        if (isValid(this.node, true) && this.controller?.snapshot().phase === 'ready') this.renderMenu(this.controller.snapshot());
      });
      return true;
    }
    return true;
  }
  private clearSubmittedProcessingInputs(methodId: string | null, submitted: ReadonlyArray<readonly [string, { readonly lotId: string; readonly amount: string }]>): void {
    if (methodId !== this.processingMethodId) return;
    for (const [key, old] of submitted) {
      const current = this.processingInputs[key];
      if (current?.lotId === old.lotId) delete this.processingInputs[key];
    }
  }
  private processingCollectState(options: NonNullable<WechatProbeSnapshot['menu']>['selectable_view_model'], taskId: string): 'ready' | 'not_ready' | 'invalid' {
    if (!options || !Array.isArray(options.processing_task_options) || !Array.isArray(options.collectable_task_options)) return 'invalid';
    const matchingTasks = options.processing_task_options.filter(item => item.id === taskId);
    const matchingChoices = options.collectable_task_options.filter(item => item.id === taskId);
    if (matchingTasks.length !== 1 || matchingChoices.length > 1) return 'invalid';
    const task = matchingTasks[0];
    if (task.status === 'ready_to_collect') {
      return task.enabled && matchingChoices.length === 1 && matchingChoices[0].enabled ? 'ready' : 'invalid';
    }
    if (['active', 'paused', 'completed', 'cancelled', 'failed'].includes(task.status)
        && !task.enabled && !matchingChoices.some(item => item.enabled)) return 'not_ready';
    return 'invalid';
  }
  private canShowProcessingHint(generation: number, page: 'processing' | 'processingTasks' | 'processingSummary' | 'processingTaskDetail'): boolean {
    const current = this.controller?.snapshot();
    return isValid(this.node, true) && generation === this.processingHintGeneration && this.page === page
      && current?.phase === 'ready' && current.visible;
  }
  private clearProcessingSelection(): void {
    this.processingMethodId = null; this.processingRequirement = 0; this.processingFacilityId = null;
    this.processingEditingKey = null; this.processingPendingLotId = null; this.processingPageIndexes = {};
    this.processingTaskId = null; this.processingInputs = {}; this.syncProcessingInput();
  }
  private syncProcessingInput(): void {
    if (this.processingInput) this.processingInput.string = (this.processingEditingKey ? this.processingInputs[this.processingEditingKey]?.amount : undefined) ?? '';
  }
  private processingSelection(): { action_type: 'start_processing'; method_id: string; input_lots: Array<{ lot_option_id: string; quantity: { amount: number; unit: string } }>; facility_option_id: string } | null {
    const options = this.controller?.snapshot().menu?.selectable_view_model;
    const method = options?.processing_method_options.find(x => x.id === this.processingMethodId);
    if (!method || !this.processingFacilityId || !method.compatible_facility_ids.includes(this.processingFacilityId)) return null;
    const input_lots: Array<{ lot_option_id: string; quantity: { amount: number; unit: string } }> = [];
    for (const [index, input] of Object.entries(this.processingInputs)) {
      const requirement = method.input_requirements[Number(index.split(':')[0])];
      const lot = options?.processable_lot_options.find(x => x.id === input.lotId && x.enabled && requirement?.lot_ids.includes(x.id));
      const text = input.amount.trim();
      if (!lot || !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
      const amount = Number(text);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      input_lots.push({ lot_option_id: lot.id, quantity: { amount, unit: lot.quantity.unit } });
    }
    return { action_type: 'start_processing', method_id: method.id, input_lots, facility_option_id: this.processingFacilityId };
  }
  private processingError(error: string): string {
    if (error.includes('UNCERTAIN')) return '结果待确认，请查看加工任务和库存核实';
    if (error.includes('ERR_DRAFT_INPUT_LOTS_EMPTY')) return '请选择材料并填写数量';
    if (error.includes('ERR_PROCESSING_INPUT_MISSING')) return '缺少必需材料，请逐项核对';
    if (error.includes('ERR_NOT_ENOUGH_RESOURCE')) return '材料不足，请核对数量';
    if (error.includes('ERR_STORAGE_CAPACITY_OVERFLOW')) return '储存空间不足，请整理库存';
    if (error.includes('ERR_PROCESSING_TASK_NOT_READY')) return '任务尚未完成，请先推进时间';
    return '加工未完成，请核对材料、设施和任务状态';
  }
  private processingTimeLabel(minute: number): string {
    return Number.isSafeInteger(minute) && minute >= 0
      ? `day ${Math.floor(minute / 1440) + 1} minute ${minute % 1440}` : `累计${minute}分钟`;
  }

  private splitAmount(): number | null {
    const text = this.splitInput?.string?.trim() ?? '';
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
    const value = Number(text);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private splitInputProblem(lot: { quantity: { amount: number; unit: string } } | undefined): string | null {
    const amount = this.splitAmount();
    if (!lot) return '请返回库存选择材料批次';
    if (amount === null) return '请输入大于零的有效数量';
    if (lot.quantity.unit === 'count' && !Number.isInteger(amount)) return '种子数量须为整数';
    if (amount > lot.quantity.amount) return '数量超过当前库存';
    return null;
  }

  private confirmSplit(lot: { id: string; quantity: { amount: number; unit: string } }): void {
    if (this.splitNeedsReview || this.splitPendingText !== null) return;
    const problem = this.splitInputProblem(lot);
    if (problem) { this.labels.hint.string = problem; return; }
    const amount = this.splitAmount()!;
    const generation = this.splitHintGeneration;
    this.lastCommandWasRead = false;
    this.splitPendingText = this.splitInput!.string;
    void this.controller!.confirmSplit(lot.id, { amount, unit: lot.quantity.unit }).then(state => {
      if (!state.split_result || state.split_result.sourceLotId !== lot.id || generation !== this.splitHintGeneration || !state.visible) {
        this.splitNeedsReview = true;
        return;
      }
      this.splitInput!.string = '';
    }).catch(error => {
      const reason = error instanceof Error ? error.message : String(error);
      const rejection = reason.match(/^ERR_WECHAT_PROBE_ACTION_FAILED:([^\s]+)$/);
      if (!rejection) this.splitNeedsReview = true;
      if (isValid(this.node, true) && generation === this.splitHintGeneration && this.controller?.snapshot().visible) {
        this.labels.hint.string = rejection ? `拆分未通过：${this.splitRejection(rejection[1])}` : '拆分结果待确认，请先核对库存';
      }
      console.error('[wechat-m3] split-confirm-failed', String(error));
    }).finally(() => {
      this.splitPendingText = null;
      if (isValid(this.node, true) && this.controller) this.renderMenu(this.controller.snapshot());
    });
  }

  private refreshSplit(): void {
    if (!this.splitNeedsReview) return;
    const generation = this.splitHintGeneration;
    void this.controller!.refreshSplitView().then(state => {
      if (generation !== this.splitHintGeneration || !state.visible || state.phase !== 'ready') return;
      this.splitNeedsReview = false;
      this.splitInput!.string = '';
      this.labels.hint.string = '库存已更新，请核对数量后重新输入';
    }).catch(error => {
      if (isValid(this.node, true) && generation === this.splitHintGeneration && this.controller?.snapshot().visible) this.labels.hint.string = '库存核对未完成，请稍后重新核对';
      console.error('[wechat-m3] split-refresh-failed', String(error));
    }).finally(() => {
      if (isValid(this.node, true) && this.controller) this.renderMenu(this.controller.snapshot());
    });
  }

  private splitRejection(code: string): string {
    if (code === 'ERR_NOT_ENOUGH_RESOURCE') return '数量超过当前库存';
    if (code === 'ERR_SPLIT_QUANTITY_INVALID') return '数量不符合单位要求';
    if (code === 'ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE') return '请调整拆分数量';
    if (code.startsWith('ERR_STORAGE_CAPACITY_OVERFLOW')) return '当前储存空间不足';
    if (code.startsWith('ERR_MENU_OPTION_')) return '请重新选择批次';
    return '请调整选择或数量';
  }

  private next(options: readonly { readonly id: string }[], selected: string | null): string | null {
    if (!options.length) return null;
    return options[(options.findIndex(item => item.id === selected) + 1) % options.length].id;
  }

  private renderMenu(state: WechatProbeSnapshot): void {
    if (!this.farmNode || !this.stockNode || !this.splitNode || !this.splitInput) return;
    const options = state.menu?.selectable_view_model;
    const fields = options?.field_options ?? [];
    const seeds = options?.seed_lot_options ?? [];
    const crops = options?.harvestable_crop_options ?? [];
    const lots = options?.splittable_lot_options ?? [];
    const targets = options?.storage_target_options ?? [];
    if (!fields.some(x => x.id === this.fieldId && x.enabled)) this.fieldId = null;
    if (!seeds.some(x => x.id === this.seedId && x.enabled)) { this.seedId = null; this.seedAmount = 1; }
    if (!crops.some(x => x.id === this.cropId && x.enabled)) this.cropId = null;
    if (!lots.some(x => x.id === this.lotId)) this.lotId = null;
    if (!targets.some(x => x.id === this.targetId)) this.targetId = null;
    const field = fields.find(x => x.id === this.fieldId);
    const seed = seeds.find(x => x.id === this.seedId);
    const crop = crops.find(x => x.id === this.cropId);
    const lot = lots.find(x => x.id === this.lotId);
    const target = targets.find(x => x.id === this.targetId);
    const unit = (value: string) => UNITS[value] ?? value;
    const place = (value: string) => STORAGE[value] ?? value;
    const inProcessing = this.page.startsWith('processing');
    for (const node of this.processingBaseNodes) node.active = !inProcessing;
    this.farmNode.active = this.page === 'farm';
    this.stockNode.active = this.page === 'stock';
    this.splitNode.active = this.page === 'split';
    if (this.processingNode) this.processingNode.active = inProcessing;
    for (const [page, node] of Object.entries(this.processingPages)) node.active = this.page === page;
    this.labels.farmField.string = field ? `地块：${this.names[field.definition_id] ?? '已选地块'} · 空余${field.available_tiles}/${field.capacity_tiles}格` : `地块：请选择（可用${fields.filter(x => x.enabled).length}/${fields.length}）`;
    const plantProblem = seed && field ? this.seedAmount > seed.quantity.amount ? '种子不足' : this.seedAmount > field.available_tiles ? '土地空间不足' : null : null;
    this.labels.farmSeed.string = seed ? `${this.names[seed.base_id] ?? '种子'}${seed.quantity.amount}${unit(seed.quantity.unit)} · 播${this.seedAmount}粒 → ${this.seedAmount}株/占${this.seedAmount}格${plantProblem ? ` · ${plantProblem}` : ''}` : '种子：请选择种子批次';
    this.labels.farmCrop.string = crop ? `作物${crops.findIndex(x => x.id === crop.id) + 1}/${crops.length}：${this.names[crop.crop_base_id] ?? '已选作物'} · 可收获${crops.filter(x => x.enabled).length}株` : `作物：可收获${crops.filter(x => x.enabled).length}株`;
    this.labels.stockLot.string = lot ? `批次${lots.findIndex(x => x.id === lot.id) + 1}/${lots.length}：${this.names[lot.base_id] ?? '材料'} ${lot.quantity.amount}${unit(lot.quantity.unit)} · ${place(lot.storage_ref.storage_type)}${lot.enabled ? '' : ' · 不可用'}` : `库存：${lots.length}批，请选择材料`;
    this.labels.stockTarget.string = target ? `目标：${place(target.storage_type)} · 空间占用${target.used_capacity}/${target.capacity.amount}${unit(target.capacity.unit)}${target.enabled ? '' : ' · 不可用'}` : `目标：${targets.length}处，请选择储存位置`;
    this.labels.stockHelp.string = lot ? `形态：${this.names[`${lot.base_id}:${lot.current_form}`] ?? FORMS[lot.current_form] ?? lot.current_form} · 目标支持：${target?.supported_forms.map(form => FORMS[form] ?? form).join('/') || '未列出'} · 整批转移` : '选择材料批次与目标后可整批转移';
    this.labels.splitLot.string = lot ? `拆分：${this.names[lot.base_id] ?? '材料'} · 当前${lot.quantity.amount}${unit(lot.quantity.unit)}` : '请返回库存选择材料批次';
    this.labels.splitUnit.string = lot ? `数量单位：${unit(lot.quantity.unit)}` : '数量单位：—';
    const result = state.split_result;
    const resultIndex = result ? lots.findIndex(x => x.id === result.newLotId) : -1;
    const splitProblem = this.splitInputProblem(lot);
    const splitAmount = this.splitAmount();
    this.labels.splitSummary.string = this.splitNeedsReview ? '拆分结果待确认，请先核对库存' : result ? `${resultIndex < 0 ? '新增批次' : `新增第${resultIndex + 1}批`}：${result.quantity.amount}${unit(result.quantity.unit)} · ${result.remainingQuantity ? `来源剩余${result.remainingQuantity.amount}${unit(result.remainingQuantity.unit)}` : '来源已全部拆出'}`
      : splitProblem ?? `拆出${splitAmount}${unit(lot!.quantity.unit)} · 原批次剩${lot!.quantity.amount - splitAmount!}${unit(lot!.quantity.unit)}`;
    const enabled = state.phase === 'ready' && state.visible && !state.busy;
    this.splitInput.enabled = enabled && this.page === 'split' && !!lot?.enabled && !this.splitNeedsReview;
    const set = (name: string, value: boolean) => { const button = this.menuButtons[name]; if (button && isValid(button.node, true)) button.interactable = enabled && value; };
    set('PageFarm', true); set('PageStock', true); set('PageProcessing', true); set('AdvanceDay', true);
    set('FarmField', fields.some(x => x.enabled)); set('FarmSeed', seeds.some(x => x.enabled)); set('FarmCrop', crops.some(x => x.enabled));
    set('FarmMinus', !!seed && this.seedAmount > 1); set('FarmPlus', !!seed && Number.isSafeInteger(this.seedAmount + 1));
    set('FarmPlant', !!field && !!seed && !plantProblem); set('FarmHarvest', !!crop);
    set('StockLot', lots.length > 0); set('StockTarget', targets.length > 0);
    set('StockMove', !!lot?.enabled && !!target?.enabled && target.id !== lot.storage_ref.container_id);
    set('StockSplit', !!lot?.enabled || this.splitNeedsReview); set('SplitBack', true);
    this.menuButtons.SplitRefresh.node.active = this.splitNeedsReview;
    set('SplitRefresh', this.splitNeedsReview);
    set('SplitConfirm', !!lot?.enabled && !splitProblem && !this.splitNeedsReview && this.splitPendingText === null);
    if (this.processingNode && this.processingInput && inProcessing) this.renderProcessingSteps(state, enabled, set);
  }

  private renderProcessingSteps(state: WechatProbeSnapshot, enabled: boolean, set: (name: string, value: boolean) => void): void {
    const options = state.menu?.selectable_view_model;
    const methods = options?.processing_method_options ?? [];
    let method = methods.find(item => item.id === this.processingMethodId);
    if (!method && this.processingMethodId) this.clearProcessingSelection();
    if (!this.processingMethodId && methods.length === 1 && methods[0].enabled) {
      this.processingMethodId = methods[0].id; method = methods[0];
    }
    const allLots = options?.processable_lot_options ?? [];
    const requirement = method?.input_requirements[this.processingRequirement];
    const lots = allLots.filter(item => item.enabled && requirement?.lot_ids.includes(item.id));
    const facilities = (options?.processing_facility_options ?? []).filter(item => method?.compatible_facility_ids.includes(item.id));
    const facility = facilities.find(item => item.id === this.processingFacilityId && item.enabled);
    if (!facility) this.processingFacilityId = null;
    const tasks = options?.processing_task_options ?? [];
    const task = tasks.find(item => item.id === this.processingTaskId);
    if (!task && this.processingTaskId && !this.processingCollectLocks.has(this.processingTaskId)) this.processingTaskId = null;
    const unit = (value: string) => UNITS[value] ?? value;
    const named = (value: string) => this.names[value] ?? PROCESSING_NAMES[value] ?? value;
    const lotText = (id: string) => {
      const lot = allLots.find(item => item.id === id);
      return lot ? `${named(lot.base_id)} · ${FORMS[lot.current_form] ?? lot.current_form} · 现有${lot.quantity.amount}${unit(lot.quantity.unit)} · ${STORAGE[lot.storage_ref.storage_type] ?? lot.storage_ref.storage_type} · 第${allLots.findIndex(item => item.id === id) + 1}批${lot.enabled ? '' : ' · 不可用'}` : '原材料已变化，请重新选择';
    };
    const requirementText = (index: number) => {
      const req = method?.input_requirements[index];
      if (!req) return '';
      const c = req.constraints;
      const parts = [c.base_id && named(c.base_id), c.category && named(c.category),
        c.allowed_base_ids.map(named).join('/'), c.allowed_forms.map(form => FORMS[form] ?? form).join('/'),
        c.min_freshness === null ? '' : `新鲜度≥${c.min_freshness}`].filter(Boolean);
      return `要求${index + 1}：${parts.join(' · ') || '材料'}${req.min_quantity ? ` · 至少${req.min_quantity.amount}${unit(req.min_quantity.unit)}` : ''}`;
    };
    const pages = (key: string, count: number, size: number, prefix: string) => {
      const offset = this.processingOffset(key, count, size);
      set(prefix + 'Prev', offset > 0); set(prefix + 'Next', offset + size < count);
      return offset;
    };
    const row = (key: string, index: number, value: string) => { this.labels[`${key}Row${index}`].string = value; };
    this.labels.processingHeader.string = `加工 · ${this.processingPageTitle()} · ${state.time_label ?? '等待启动'}`;
    this.labels.processingStatus.string = state.last_error
      ? this.lastCommandWasRead && state.last_error === `ERR_SAVE_SLOT_NOT_FOUND:${WECHAT_SAVE_SLOT_ID}`
        ? '未找到主存档；无备份时可先保存' : this.errorText(state.last_error)
      : state.busy ? '正在处理，请稍候' : !state.visible ? '已切到后台'
        : this.processingReviewRequired ? '请先重新核对任务和库存'
          : this.processingCollectLocks.size ? '领取结果待核实，请选择任务并重新核对' : '';
    this.labels.processingOverviewMethod.string = method ? `方法：${named(method.id)} · 加工${method.process_duration_minutes}分钟${method.tool_requirements.length ? ` · 工具：${method.tool_requirements.map(named).join('/')}` : ''}` : '方法：尚未选择';
    this.labels.processingOverviewFacility.string = facility ? `设施：${named(facility.definition_id)} · 第${facilities.findIndex(item => item.id === facility.id) + 1}处` : '设施：尚未选择';
    const reqOffset = pages('requirements', method?.input_requirements.length ?? 0, 2, 'ProcessingRequirements');
    for (let i = 0; i < 2; i++) {
      const index = reqOffset + i; const req = method?.input_requirements[index];
      const selected = Object.entries(this.processingInputs).filter(([key]) => Number(key.split(':')[0]) === index);
      const invalid = selected.some(([, input]) => !allLots.some(lot => lot.id === input.lotId && lot.enabled && req?.lot_ids.includes(lot.id)));
      const selectedLot = selected.length === 1 ? allLots.find(lot => lot.id === selected[0][1].lotId) : undefined;
      const selectedText = selected.length === 1 ? `已选${selected[0][1].amount}${selectedLot ? unit(selectedLot.quantity.unit) : ''}` : `已选${selected.length}项`;
      row('processingOverview', i, req ? `${requirementText(index)} · ${selected.length ? `${selectedText}${invalid ? ' · 材料已变化' : ''}` : '未选择'}` : '');
      set('ProcessingRequirement' + i, !!req && !this.processingReviewRequired);
    }
    const methodOffset = pages('methods', methods.length, 3, 'ProcessingMethods');
    for (let i = 0; i < 3; i++) {
      const item = methods[methodOffset + i];
      row('processingMethods', i, item ? `${named(item.id)} · 加工${item.process_duration_minutes}分钟${item.enabled ? '' : ' · 不可用'}` : '');
      set('ProcessingMethod' + i, !!item?.enabled);
    }
    this.labels.processingMaterialsTitle.string = requirement ? requirementText(this.processingRequirement) : '请选择材料要求';
    const inputs = this.processingItems();
    const inputOffset = pages('materials', inputs.length, 2, 'ProcessingMaterials');
    for (let i = 0; i < 2; i++) {
      const item = inputs[inputOffset + i];
      const lot = item && allLots.find(x => x.id === item[1].lotId);
      row('processingMaterials', i, item ? `${lotText(item[1].lotId)} · 使用${item[1].amount}${lot ? unit(lot.quantity.unit) : ''}` : i === 0 ? '尚未选择材料' : '');
      set('ProcessingEdit' + i, !!item && !this.processingReviewRequired);
      set('ProcessingRemove' + i, !!item && !this.processingReviewRequired);
    }
    const lotOffset = pages('lots', lots.length, 3, 'ProcessingLots');
    for (let i = 0; i < 3; i++) {
      const item = lots[lotOffset + i];
      row('processingLots', i, item ? lotText(item.id) : i === 0 ? '暂无符合此要求的材料' : '');
      set('ProcessingLot' + i, !!item);
    }
    const pending = allLots.find(item => item.id === this.processingPendingLotId);
    this.labels.processingQuantityTitle.string = pending ? lotText(pending.id) : '材料已变化，请返回重新选择';
    this.labels.processingQuantityUnit.string = pending ? `请输入数量，单位：${unit(pending.quantity.unit)}` : '无法填写数量';
    this.processingInput!.enabled = enabled && this.page === 'processingQuantity' && !!pending && lots.some(item => item.id === pending.id);
    const facilityOffset = pages('facilities', facilities.length, 3, 'ProcessingFacilities');
    for (let i = 0; i < 3; i++) {
      const item = facilities[facilityOffset + i];
      row('processingFacilities', i, item ? `第${facilityOffset + i + 1}处 · ${named(item.definition_id)}${item.enabled ? '' : ' · 不可用'}` : i === 0 ? '暂无匹配设施' : '');
      set('ProcessingFacility' + i, !!item?.enabled);
    }
    this.labels.processingSummaryTitle.string = `方法：${method ? named(method.id) : '未选择'} · 设施：${facility ? `${named(facility.definition_id)} · 第${facilities.findIndex(item => item.id === facility.id) + 1}处` : '未选择'}`;
    const summary: Array<[string, { lotId: string; amount: string } | null]> = [];
    (method?.input_requirements ?? []).forEach((_, index) => {
      const selected = Object.entries(this.processingInputs).filter(([key]) => Number(key.split(':')[0]) === index);
      if (selected.length) summary.push(...selected); else summary.push([`${index}:missing`, null]);
    });
    const summaryOffset = pages('summary', summary.length, 2, 'ProcessingSummary');
    for (let i = 0; i < 2; i++) {
      const item = summary[summaryOffset + i]; const lot = item?.[1] && allLots.find(x => x.id === item[1]!.lotId);
      const req = item && method?.input_requirements[Number(item[0].split(':')[0])];
      const invalid = item?.[1] && (!lot?.enabled || !req?.lot_ids.includes(item[1].lotId));
      row('processingSummary', i, item ? item[1] ? `要求${Number(item[0].split(':')[0]) + 1} · ${lotText(item[1].lotId)} · 使用${item[1].amount}${lot ? unit(lot.quantity.unit) : ''}${invalid ? ' · 请重新选择' : ''}` : `要求${Number(item[0].split(':')[0]) + 1} · 未选择材料` : i === 0 ? '请选择加工方法' : '');
    }
    const statuses: Record<string, string> = { active: '进行中', in_progress: '进行中', ready_to_collect: '可领取', completed: '已领取' };
    const taskOffset = pages('tasks', tasks.length, 3, 'ProcessingTasks');
    for (let i = 0; i < 3; i++) {
      const item = tasks[taskOffset + i];
      row('processingTasks', i, item ? `任务${taskOffset + i + 1} · ${named(item.method_id)} · ${statuses[item.status] ?? item.status} · 预计${this.processingTimeLabel(item.expected_finish_minute)}` : i === 0 ? '暂无加工任务' : '');
      set('ProcessingTask' + i, !!item);
    }
    this.labels.processingTaskDetailTitle.string = task ? `任务${tasks.findIndex(item => item.id === task.id) + 1} · ${named(task.method_id)} · ${statuses[task.status] ?? task.status}` : this.processingTaskId ? '任务暂未显示，请重新核对' : '请返回选择任务';
    this.labels.processingTaskDetailTime.string = task ? `预计完成：${this.processingTimeLabel(task.expected_finish_minute)}` : '';
    const output = task?.expected_output;
    this.labels.processingTaskDetailOutput.string = task ? `预计产物：${output?.base_id ? named(output.base_id) : '未列出'}${output?.quantity ? ` ${output.quantity.amount}${unit(output.quantity.unit)}` : ''}${this.processingCollectLocks.has(task.id) ? ' · 待核实，请重新核对' : ''}` : '';
    this.labels.processingInfoIdentity.string = state.identity ? `${state.identity.version} · ${state.identity.short_commit}\n${state.identity.candidate_id}` : '正在读取候选身份';
    this.labels.processingReviewTitle.string = `当前任务 ${tasks.length} 项 · 库存 ${options?.splittable_lot_options.length ?? 0} 批`;
    this.labels.processingReviewHelp.string = '请先查看任务与库存，核实后重新选择材料';
    const pagination: Record<string, [string, number, number, number]> = {
      processing: ['requirements', method?.input_requirements.length ?? 0, 2, -95], processingMethods: ['methods', methods.length, 3, -75],
      processingMaterials: ['materials', inputs.length, 2, -50], processingLots: ['lots', lots.length, 3, -75],
      processingFacilities: ['facilities', facilities.length, 3, -75], processingSummary: ['summary', summary.length, 2, -50],
      processingTasks: ['tasks', tasks.length, 3, -75]
    };
    const pageInfo = pagination[this.page];
    this.labels.processingPagination.node.active = !!pageInfo;
    if (pageInfo) {
      const [key, count, size, y] = pageInfo;
      this.labels.processingPagination.string = `第${(this.processingPageIndexes[key] ?? 0) + 1}/${Math.max(1, Math.ceil(count / size))}页`;
      this.labels.processingPagination.node.setPosition(330, y, 0);
    }
    for (const name of ['ProcessingExit', 'ProcessingInfo', 'ProcessingInfoBack', 'ProcessingMethodsBack', 'ProcessingMaterialsBack', 'ProcessingLotsBack',
      'ProcessingQuantityBack', 'ProcessingFacilitiesBack', 'ProcessingSummaryBack', 'ProcessingTasksBack', 'ProcessingTaskDetailBack',
      'ProcessingSave', 'ProcessingLoad', 'ProcessingBackup', 'ProcessingCancel', 'ProcessingAdvanceHour', 'ProcessingAdvanceDay']) set(name, true);
    set('ProcessingChooseMethod', true); set('ProcessingChooseFacility', !!method); set('ProcessingSummary', true);
    set('ProcessingTasks', true); set('ProcessingAddLot', !!requirement && !this.processingReviewRequired);
    set('ProcessingQuantitySave', !!pending && !this.processingReviewRequired);
    set('ProcessingSummaryPreview', !!method && !!facility);
    set('ProcessingSummaryStart', !!method && !!facility && !this.processingStartLocked && !this.processingReviewRequired);
    set('ProcessingStartRefresh', this.processingReviewRequired);
    set('ProcessingSummaryRefresh', this.processingReviewRequired);
    set('ProcessingReviewTasks', true); set('ProcessingReviewStock', true); set('ProcessingReviewBack', true);
    set('ProcessingTaskDetailCollect', !!task && !this.processingCollectLocks.has(task.id) && this.processingCollectState(options ?? null, task.id) === 'ready');
    set('ProcessingTaskDetailRefresh', !!this.processingTaskId && this.processingCollectLocks.has(this.processingTaskId));
  }
  private processingPageTitle(): string {
    const titles: Record<string, string> = { processing: '准备加工', processingMethods: '选择方法', processingMaterials: '材料要求',
      processingLots: '选择材料批次', processingQuantity: '填写数量', processingFacilities: '选择设施',
      processingSummary: '核对并开工', processingReview: '查看核对结果', processingTasks: '加工任务', processingTaskDetail: '任务详情', processingInfo: '信息与存档' };
    return titles[this.page] ?? '加工';
  }

  private render(state: WechatProbeSnapshot): void {
    if (!isValid(this.node, true)) return;
    const identity = state.identity;
    this.labels.candidate.string = identity ? `candidate_id: ${identity.candidate_id}` : 'candidate_id: 加载中';
    this.labels.commit.string = identity ? `${identity.version}  commit: ${identity.short_commit}` : '读取运行包身份';
    this.labels.time.string = state.time_label ?? '等待正式资源启动';
    this.labels.status.string = state.last_error
      ? this.lastCommandWasRead && state.last_error === `ERR_SAVE_SLOT_NOT_FOUND:${WECHAT_SAVE_SLOT_ID}`
        ? '未找到主存档；无备份时可先保存' : this.errorText(state.last_error)
      : `状态: ${state.phase}${state.busy ? ' · 执行中' : ''}${state.visible ? '' : ' · 后台'}`;
    this.labels.result.string = `推进按钮 ${this.clickCount} · 已完成命令 ${state.completed_commands}`;
    for (const button of [this.button, this.saveButton, this.loadButton, this.backupButton, this.cancelFirstButton]) {
      if (button && isValid(button, true)) button.interactable = state.phase === 'ready' && !state.busy && state.visible;
    }
    this.renderMenu(state);
    const { menu: _menu, ...diagnostics } = state;
    console.info('[wechat-m1] state', JSON.stringify({ ...diagnostics, click_count: this.clickCount }));
  }

  private loadJson(name: string): Promise<unknown> {
    return new Promise((accept, reject) => resources.load(name, JsonAsset, (error, asset) => {
      if (error) reject(error);
      else if (!asset) reject(new Error('ERR_WECHAT_RESOURCE_MISSING:' + name));
      else accept(asset.json);
    }));
  }

  private errorText(error: string): string {
    if (error.includes('ERR_WECHAT_ACTION_RESULT_UNCERTAIN')) return '操作结果待确认，请查看土地和库存核实';
    if (error.includes('ERR_FIELD_CAPACITY_EXCEEDED')) return '土地空间不足，请减少播种数量';
    if (error.includes('ERR_PLANT_QUANTITY_INVALID')) return '播种数量须为正整数';
    if (error.includes('ERR_STORAGE_CAPACITY_OVERFLOW')) return '储存空间不足，请整理库存后再操作';
    if (error.includes('ERR_NOT_ENOUGH_RESOURCE')) return '材料数量不足，请核对当前库存';
    if (error.includes('ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN')) return '结果待确认，请查看加工任务和库存核实';
    if (error.includes('ERR_WECHAT_SPLIT_RESULT_UNCERTAIN')) return '拆分结果待确认，请查看库存核实';
    if (error.includes('ERR_WECHAT_BACKUP_RECOVERY_INCOMPLETE')) return '存储恢复未完成，当前游戏未变';
    if (error.includes('ERR_WECHAT_BACKUP_RESTORED_RESULT_UNCERTAIN')) return '存储已恢复，读取或显示未完成，请检查游戏';
    if (error.includes('ERR_WECHAT_SAVE_RECOVERY_REQUIRED')) return '存档待恢复，请恢复备份或撤销首档';
    if (error.includes('ERR_WECHAT_SAVE_RECOVERY_NOT_PENDING')) return '当前没有待恢复的存档';
    if (error.includes('ERR_WECHAT_SAVE_BACKUP_MISSING')) return '没有可用备份，请保留当前数据';
    if (error.includes('ERR_WECHAT_SAVE_COMMIT_UNCERTAIN')) return '存档状态待确认，请恢复备份或撤销首档';
    if (error.includes('ERR_WECHAT_STORAGE_UNAVAILABLE')) return '微信存储不可用，请稍后重试';
    if (error.includes('ERR_WECHAT_SAVE_RECOVERY_NOT_ALLOWED') || error.includes('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED')
        || error.includes('ERR_WECHAT_SAVE_BACKUP_CONFLICT') || error.includes('ERR_WECHAT_SAVE_NOT_STRING')) return '存档状态异常，请保留数据并反馈';
    return '操作失败，请查看日志';
  }

  private createView(): void {
    view.setDesignResolutionSize(960, 540, ResolutionPolicy.SHOW_ALL);
    const root = new Node('WechatProbeCanvas');
    root.layer = Layers.Enum.UI_2D;
    this.node.addChild(root);
    root.addComponent(UITransform).setContentSize(960, 540);
    const canvas = root.addComponent(Canvas);
    const cameraNode = new Node('WechatProbeCamera');
    this.node.addChild(cameraNode);
    cameraNode.setPosition(0, 0, 1000);
    const camera = cameraNode.addComponent(Camera);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.orthoHeight = 270;
    camera.near = 0;
    camera.far = 2000;
    camera.visibility = Layers.Enum.UI_2D;
    camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    camera.clearColor = new Color(22, 31, 42, 255);
    canvas.cameraComponent = camera;
    canvas.alignCanvasWithScreen = true;
    this.label(root, 'title', '青岚 · 种植、库存与加工', 242, 23);
    this.labels.commit = this.label(root, 'commit', '读取运行包身份', 211, 16);
    this.labels.candidate = this.label(root, 'candidate', 'candidate_id: 加载中', 187, 16);
    this.labels.time = this.label(root, 'time', '等待正式资源启动', 158, 22);
    this.labels.status = this.label(root, 'status', '状态: idle', 128, 18);
    this.menuButtons.PageFarm = this.smallButton(root, 'PageFarm', '种植', -380, 80);
    this.menuButtons.PageStock = this.smallButton(root, 'PageStock', '库存', -190, 80);
    this.menuButtons.PageProcessing = this.smallButton(root, 'PageProcessing', '加工', 0, 80);
    this.button = this.smallButton(root, 'AdvanceOneHour', '推进一小时', 190, 80);
    this.menuButtons.AdvanceDay = this.smallButton(root, 'AdvanceDay', '推进一天', 380, 80);

    this.farmNode = new Node('FarmingPage');
    this.farmNode.layer = Layers.Enum.UI_2D;
    root.addChild(this.farmNode);
    this.farmNode.addComponent(UITransform).setContentSize(960, 540);
    this.menuButtons.FarmField = this.smallButton(this.farmNode, 'FarmField', '选择地块', -350, 25);
    this.menuButtons.FarmSeed = this.smallButton(this.farmNode, 'FarmSeed', '选择种子', -350, -30);
    this.menuButtons.FarmCrop = this.smallButton(this.farmNode, 'FarmCrop', '选择作物', -350, -85);
    this.labels.farmField = this.menuLabel(this.farmNode, 'farmField', 80, 25);
    this.labels.farmSeed = this.menuLabel(this.farmNode, 'farmSeed', 80, -30);
    this.labels.farmCrop = this.menuLabel(this.farmNode, 'farmCrop', 80, -85);
    this.menuButtons.FarmMinus = this.smallButton(this.farmNode, 'FarmMinus', '种子 −1', -330, -140);
    this.menuButtons.FarmPlus = this.smallButton(this.farmNode, 'FarmPlus', '种子 +1', -110, -140);
    this.menuButtons.FarmPlant = this.smallButton(this.farmNode, 'FarmPlant', '播种', 110, -140);
    this.menuButtons.FarmHarvest = this.smallButton(this.farmNode, 'FarmHarvest', '收获', 330, -140);

    this.stockNode = new Node('InventoryPage');
    this.stockNode.layer = Layers.Enum.UI_2D;
    root.addChild(this.stockNode);
    this.stockNode.addComponent(UITransform).setContentSize(960, 540);
    this.menuButtons.StockLot = this.smallButton(this.stockNode, 'StockLot', '选择材料', -350, 25);
    this.menuButtons.StockTarget = this.smallButton(this.stockNode, 'StockTarget', '选择目标', -350, -30);
    this.labels.stockLot = this.menuLabel(this.stockNode, 'stockLot', 80, 25);
    this.labels.stockTarget = this.menuLabel(this.stockNode, 'stockTarget', 80, -30);
    this.labels.stockHelp = this.menuLabel(this.stockNode, 'stockHelp', 80, -85);
    this.menuButtons.StockMove = this.smallButton(this.stockNode, 'StockMove', '整批转移', 110, -140);
    this.menuButtons.StockSplit = this.smallButton(this.stockNode, 'StockSplit', '拆分批次', 330, -140);

    this.splitNode = new Node('SplitPage');
    this.splitNode.layer = Layers.Enum.UI_2D;
    root.addChild(this.splitNode);
    this.splitNode.addComponent(UITransform).setContentSize(960, 540);
    this.labels.splitLot = this.menuLabel(this.splitNode, 'splitLot', 0, 25);
    this.splitInput = this.quantityInput(this.splitNode, -300, -30);
    this.labels.splitUnit = this.menuLabel(this.splitNode, 'splitUnit', 140, -30);
    this.labels.splitSummary = this.menuLabel(this.splitNode, 'splitSummary', 0, -85);
    this.menuButtons.SplitBack = this.smallButton(this.splitNode, 'SplitBack', '返回库存', -330, -140);
    this.menuButtons.SplitRefresh = this.smallButton(this.splitNode, 'SplitRefresh', '核对库存', -110, -140);
    this.menuButtons.SplitConfirm = this.smallButton(this.splitNode, 'SplitConfirm', '确认拆分', 110, -140);

    this.saveButton = this.smallButton(root, 'Save', '保存', -330, -197);
    this.loadButton = this.smallButton(root, 'Load', '读取', -110, -197);
    this.backupButton = this.smallButton(root, 'LoadBackup', '恢复备份', 110, -197);
    this.cancelFirstButton = this.smallButton(root, 'CancelFirstSave', '撤销首档', 330, -197);
    this.labels.result = this.label(root, 'result', '推进按钮 0 · 已完成命令 0', -237, 14);
    this.labels.result.node.setPosition(-300, -237, 0);
    this.labels.result.node.getComponent(UITransform)!.setContentSize(270, 22);
    this.labels.hint = this.label(root, 'hint', '手动保存与读取；可选择恢复失败存档', -237, 15);
    this.labels.hint.node.setPosition(150, -237, 0);
    this.labels.hint.node.getComponent(UITransform)!.setContentSize(600, 22);
    this.createProcessingView(root);
  }

  private createProcessingView(root: Node): void {
    this.processingBaseNodes = root.children.filter(node => node !== this.labels.hint.node);
    const shell = new Node('ProcessingSteps');
    shell.layer = Layers.Enum.UI_2D; root.addChild(shell);
    shell.addComponent(UITransform).setContentSize(960, 540);
    this.processingNode = shell;
    const addButton = (parent: Node, name: string, caption: string, x: number, y: number) => {
      this.menuButtons[name] = this.smallButton(parent, name, caption, x, y);
    };
    addButton(shell, 'ProcessingExit', '返回游戏', -370, 222);
    addButton(shell, 'ProcessingInfo', '信息与存档', 370, 222);
    this.labels.processingHeader = this.menuLabel(shell, 'processingHeader', 0, 222);
    this.labels.processingHeader.node.getComponent(UITransform)!.setContentSize(500, 42);
    this.labels.processingStatus = this.menuLabel(shell, 'processingStatus', 0, 182);
    this.labels.processingPagination = this.menuLabel(shell, 'processingPagination', 330, -95);
    this.labels.processingPagination.node.getComponent(UITransform)!.setContentSize(180, 40);
    const page = (name: string) => {
      const node = new Node(name); node.layer = Layers.Enum.UI_2D; shell.addChild(node);
      node.addComponent(UITransform).setContentSize(960, 540); this.processingPages[name] = node; return node;
    };
    const line = (parent: Node, key: string, x: number, y: number, width = 620) => {
      const label = this.menuLabel(parent, key, x, y); label.node.getComponent(UITransform)!.setContentSize(width, 46);
      label.enableWrapText = true;
      label.lineHeight = 20;
      this.labels[key] = label;
    };
    const list = (parent: Node, key: string, prefix: string) => {
      for (let i = 0; i < 3; i++) {
        const y = 125 - i * 60;
        addButton(parent, prefix + i, '选择', -350, y);
        line(parent, key + 'Row' + i, 70, y, 650);
      }
    };
    const pageArrows = (parent: Node, prefix: string, y: number) => {
      addButton(parent, prefix + 'Prev', '上一页', -110, y);
      addButton(parent, prefix + 'Next', '下一页', 110, y);
    };
    const overview = page('processing');
    addButton(overview, 'ProcessingChooseMethod', '选择方法', -350, 135);
    line(overview, 'processingOverviewMethod', 70, 135, 650);
    for (let i = 0; i < 2; i++) {
      const y = 75 - i * 55;
      addButton(overview, 'ProcessingRequirement' + i, '选择材料', -350, y);
      line(overview, 'processingOverviewRow' + i, 70, y, 650);
    }
    addButton(overview, 'ProcessingChooseFacility', '选择设施', -350, -35);
    line(overview, 'processingOverviewFacility', 70, -35, 650);
    pageArrows(overview, 'ProcessingRequirements', -95);
    addButton(overview, 'ProcessingSummary', '核对并开工', -110, -160);
    addButton(overview, 'ProcessingTasks', '查看任务', 110, -160);
    addButton(overview, 'ProcessingStartRefresh', '重新核对', 330, -160);
    const methodPage = page('processingMethods');
    list(methodPage, 'processingMethods', 'ProcessingMethod');
    pageArrows(methodPage, 'ProcessingMethods', -75);
    addButton(methodPage, 'ProcessingMethodsBack', '返回', -330, -160);
    const materialPage = page('processingMaterials');
    line(materialPage, 'processingMaterialsTitle', 0, 145, 850);
    for (let i = 0; i < 2; i++) {
      const y = 80 - i * 60;
      line(materialPage, 'processingMaterialsRow' + i, -165, y, 430);
      addButton(materialPage, 'ProcessingEdit' + i, '修改数量', 145, y);
      addButton(materialPage, 'ProcessingRemove' + i, '移除', 350, y);
    }
    pageArrows(materialPage, 'ProcessingMaterials', -50);
    addButton(materialPage, 'ProcessingMaterialsBack', '返回要求', -330, -160);
    addButton(materialPage, 'ProcessingAddLot', '添加材料批次', -110, -160);
    const lotsPage = page('processingLots');
    list(lotsPage, 'processingLots', 'ProcessingLot');
    pageArrows(lotsPage, 'ProcessingLots', -75);
    addButton(lotsPage, 'ProcessingLotsBack', '返回', -330, -160);
    const quantityPage = page('processingQuantity');
    line(quantityPage, 'processingQuantityTitle', 0, 135, 850);
    line(quantityPage, 'processingQuantityUnit', 0, 75, 850);
    this.processingInput = this.quantityInput(quantityPage, 0, 10, '输入材料数量');
    addButton(quantityPage, 'ProcessingQuantityBack', '返回', -330, -160);
    addButton(quantityPage, 'ProcessingQuantitySave', '保存选择', 110, -160);
    const facilityPage = page('processingFacilities');
    list(facilityPage, 'processingFacilities', 'ProcessingFacility');
    pageArrows(facilityPage, 'ProcessingFacilities', -75);
    addButton(facilityPage, 'ProcessingFacilitiesBack', '返回', -330, -160);
    const summaryPage = page('processingSummary');
    line(summaryPage, 'processingSummaryTitle', 0, 145, 850);
    for (let i = 0; i < 2; i++) line(summaryPage, 'processingSummaryRow' + i, 0, 80 - i * 60, 850);
    pageArrows(summaryPage, 'ProcessingSummary', -50);
    addButton(summaryPage, 'ProcessingSummaryBack', '返回修改', -330, -160);
    addButton(summaryPage, 'ProcessingSummaryPreview', '可选预览', -110, -160);
    addButton(summaryPage, 'ProcessingSummaryStart', '确认开工', 110, -160);
    addButton(summaryPage, 'ProcessingSummaryRefresh', '重新核对', 330, -160);
    const reviewPage = page('processingReview');
    line(reviewPage, 'processingReviewTitle', 0, 135, 850);
    line(reviewPage, 'processingReviewHelp', 0, 75, 850);
    addButton(reviewPage, 'ProcessingReviewBack', '返回加工', -330, -160);
    addButton(reviewPage, 'ProcessingReviewTasks', '查看任务', -110, -160);
    addButton(reviewPage, 'ProcessingReviewStock', '查看库存', 110, -160);
    const taskPage = page('processingTasks');
    list(taskPage, 'processingTasks', 'ProcessingTask');
    pageArrows(taskPage, 'ProcessingTasks', -75);
    addButton(taskPage, 'ProcessingTasksBack', '返回', -330, -160);
    addButton(taskPage, 'ProcessingAdvanceHour', '推进一小时', -110, -160);
    addButton(taskPage, 'ProcessingAdvanceDay', '推进一天', 110, -160);
    const detailPage = page('processingTaskDetail');
    line(detailPage, 'processingTaskDetailTitle', 0, 135, 850);
    line(detailPage, 'processingTaskDetailTime', 0, 75, 850);
    line(detailPage, 'processingTaskDetailOutput', 0, 15, 850);
    addButton(detailPage, 'ProcessingTaskDetailBack', '返回任务', -330, -160);
    addButton(detailPage, 'ProcessingTaskDetailCollect', '领取产物', 110, -160);
    addButton(detailPage, 'ProcessingTaskDetailRefresh', '重新核对', 330, -160);
    const infoPage = page('processingInfo');
    line(infoPage, 'processingInfoIdentity', 0, 115, 850);
    addButton(infoPage, 'ProcessingSave', '保存', -330, 15);
    addButton(infoPage, 'ProcessingLoad', '读取', -110, 15);
    addButton(infoPage, 'ProcessingBackup', '恢复备份', 110, 15);
    addButton(infoPage, 'ProcessingCancel', '撤销首档', 330, 15);
    addButton(infoPage, 'ProcessingInfoBack', '返回', -330, -160);
  }

  private quantityInput(parent: Node, x: number, y: number, placeholderText = '输入拆分数量'): EditBox {
    const node = new Node('SplitQuantity');
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(240, 48);
    const background = new Node('Background');
    background.layer = Layers.Enum.UI_2D;
    node.addChild(background);
    background.addComponent(UITransform).setContentSize(240, 48);
    const graphics = background.addComponent(Graphics);
    graphics.fillColor = new Color(40, 57, 70, 255);
    graphics.roundRect(-120, -24, 240, 48, 6);
    graphics.fill();
    const text = this.label(node, 'Text', '', 0, 20);
    const placeholder = this.label(node, 'Placeholder', placeholderText, 0, 18);
    for (const label of [text, placeholder]) {
      label.node.getComponent(UITransform)!.setContentSize(220, 48);
      label.node.getComponent(UITransform)!.setAnchorPoint(0, 1);
      label.horizontalAlign = Label.HorizontalAlign.LEFT;
    }
    placeholder.color = new Color(151, 164, 170, 255);
    const input = node.addComponent(EditBox);
    input.textLabel = text;
    input.placeholderLabel = placeholder;
    input.inputMode = EditBox.InputMode.SINGLE_LINE;
    input.inputFlag = EditBox.InputFlag.DEFAULT;
    input.tabIndex = -1;
    input.maxLength = -1;
    input.enabled = false;
    return input;
  }

  private menuLabel(parent: Node, name: string, x: number, y: number): Label {
    const value = this.label(parent, name, '', y, 18);
    value.node.setPosition(x, y, 0);
    value.node.getComponent(UITransform)!.setContentSize(620, 40);
    return value;
  }

  private smallButton(parent: Node, name: string, caption: string, x: number, y: number): Button {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(180, 54);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(62, 118, 125, 255);
    graphics.roundRect(-90, -27, 180, 54, 8);
    graphics.fill();
    const button = node.addComponent(Button);
    button.transition = Button.Transition.NONE;
    button.interactable = false;
    this.label(node, 'caption', caption, 0, 22).node.getComponent(UITransform)!.setContentSize(170, 50);
    return button;
  }

  private label(parent: Node, name: string, text: string, y: number, fontSize: number): Label {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(0, y, 0);
    node.addComponent(UITransform).setContentSize(900, 42);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 6;
    label.horizontalAlign = 1;
    label.verticalAlign = 1;
    label.color = new Color(230, 238, 240, 255);
    return label;
  }
}
