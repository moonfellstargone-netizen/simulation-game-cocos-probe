import { _decorator, Button, Camera, Canvas, Color, Component, EditBox, Game, game, Graphics, isValid,
  JsonAsset, Label, Layers, Node, resources, ResolutionPolicy, screen, sys, UITransform, view } from 'cc';
import { createStage1AHost, QinglanUiSceneProbeComponent } from '../generated/probe-runtime.js';
import { WechatProbeController, type WechatProbeSnapshot, type WechatResources } from './WechatProbeController';
import { WECHAT_BACKUP_SLOT_ID, WECHAT_SAVE_SLOT_ID, WechatSaveStoragePort } from './WechatSaveStoragePort';
import { createWechatPriorSaveValidator } from './WechatPriorSaveValidator';

const { ccclass } = _decorator;
const UNITS: Record<string, string> = { count: '粒', g: '克', ml: '毫升', bundle: '捆', serving: '份' };
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
  private page: 'farm' | 'stock' | 'split' | 'processing' | 'processingTasks' = 'farm';
  private processingNode: Node | null = null;
  private processingTasksNode: Node | null = null;
  private processingInput: EditBox | null = null;
  private processingMethodId: string | null = null;
  private processingRequirement = 0;
  private processingSlot = 0;
  private processingFacilityId: string | null = null;
  private processingTaskId: string | null = null;
  private processingInputs: Record<string, { lotId: string; amount: string }> = {};
  private processingHintGeneration = 0;
  private farmNode: Node | null = null;
  private stockNode: Node | null = null;
  private splitNode: Node | null = null;
  private splitInput: EditBox | null = null;
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
  private invalidateSplit(): void { this.controller?.invalidateSplitPreview(); this.controller?.invalidateProcessingPreview(); this.processingHintGeneration++; }
  private finishSplitEditing(): void { if (this.splitInput?.isFocused()) this.splitInput.blur(); if (this.processingInput?.isFocused()) this.processingInput.blur(); }
  private onProcessingTextChanged(): void {
    this.resetCancelConfirmation();
    this.processingHintGeneration++;
    const state = this.controller?.snapshot();
    if (!state || state.phase !== 'ready' || state.busy || !state.visible) { this.syncProcessingInput(); return; }
    const item = this.processingInputs[this.processingKey()];
    if (item && this.processingInput) item.amount = this.processingInput.string;
    this.controller?.invalidateProcessingPreview();
    if (state && isValid(this.node, true)) this.renderMenu(state);
  }
  private onSplitTextChanged(): void {
    this.resetCancelConfirmation();
    this.invalidateSplit();
    const state = this.controller?.snapshot();
    if (state && isValid(this.node, true)) this.renderMenu(state);
  }
  private onHide(): void { this.finishSplitEditing(); this.resetCancelConfirmation(); this.invalidateSplit(); this.controller?.setVisible(false); }
  private onShow(): void { this.controller?.setVisible(true); }

  private menuHandler(name: string): () => void {
    return () => {
      const beforeEditing = this.controller?.snapshot();
      if (!beforeEditing || beforeEditing.phase !== 'ready' || beforeEditing.busy || !beforeEditing.visible) return;
      this.finishSplitEditing();
      const state = this.controller?.snapshot();
      if (!state || state.phase !== 'ready' || state.busy || !state.visible) return;
      this.resetCancelConfirmation();
      if (name !== 'SplitConfirm') this.invalidateSplit();
      const options = state.menu?.selectable_view_model;
      if (name === 'PageFarm') this.page = 'farm';
      else if (name === 'PageStock') this.page = 'stock';
      else if (name === 'PageProcessing') this.page = 'processing';
      else if (name === 'ProcessingTasks') this.page = 'processingTasks';
      else if (name === 'ProcessingBack') this.page = 'processing';
      else if (name === 'ProcessingMethod') {
        this.processingMethodId = this.next(options?.processing_method_options ?? [], this.processingMethodId);
        this.processingRequirement = 0; this.processingSlot = 0; this.processingInputs = {}; this.processingFacilityId = null; this.syncProcessingInput();
      } else if (name === 'ProcessingRequirement') {
        const method = options?.processing_method_options.find(x => x.id === this.processingMethodId);
        if (method?.input_requirements.length) this.processingRequirement = (this.processingRequirement + 1) % method.input_requirements.length;
        this.processingSlot = 0;
        this.syncProcessingInput();
      } else if (name === 'ProcessingSlot') {
        const slots = Object.keys(this.processingInputs).filter(key => key.startsWith(`${this.processingRequirement}:`)).length;
        this.processingSlot = (this.processingSlot + 1) % (slots + 1);
        this.syncProcessingInput();
      } else if (name === 'ProcessingLot') {
        const requirement = options?.processing_method_options.find(x => x.id === this.processingMethodId)?.input_requirements[this.processingRequirement];
        const candidates = (options?.processable_lot_options ?? []).filter(x => x.enabled && requirement?.lot_ids.includes(x.id));
        const key = this.processingKey();
        const previous = this.processingInputs[key]?.lotId ?? null;
        const index = candidates.findIndex(x => x.id === previous);
        const id = index === candidates.length - 1 && previous !== null ? null : this.next(candidates, previous);
        if (id) this.processingInputs[key] = { lotId: id, amount: '' };
        else {
          delete this.processingInputs[key];
          let slot = this.processingSlot + 1;
          while (this.processingInputs[`${this.processingRequirement}:${slot}`]) {
            this.processingInputs[`${this.processingRequirement}:${slot - 1}`] = this.processingInputs[`${this.processingRequirement}:${slot}`];
            delete this.processingInputs[`${this.processingRequirement}:${slot}`];
            slot++;
          }
        }
        this.syncProcessingInput();
      } else if (name === 'ProcessingFacility') {
        const method = options?.processing_method_options.find(x => x.id === this.processingMethodId);
        this.processingFacilityId = this.next((options?.processing_facility_options ?? []).filter(x => x.enabled && method?.compatible_facility_ids.includes(x.id)), this.processingFacilityId);
      } else if (name === 'ProcessingTask') this.processingTaskId = this.next(options?.processing_task_options ?? [], this.processingTaskId);
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
        if (name === 'ProcessingPreview' || name === 'ProcessingStart') {
          const selection = this.processingSelection();
          if (!selection) this.labels.hint.string = '请选择方法、设施并填写有效材料数量';
          else {
            this.lastCommandWasRead = false;
            const generation = this.processingHintGeneration;
            const command = name === 'ProcessingPreview' ? this.controller!.previewProcessing(selection) : this.controller!.confirmProcessing(selection);
            void command.then(result => {
              if (!this.canShowProcessingHint(generation, 'processing')) return;
              const preview = result.processing_preview;
              if (name === 'ProcessingPreview') {
                if (!preview || preview.actionType !== 'start_processing') return;
                this.labels.hint.string = preview.success ? '预览通过，尚未开工' : `预览未通过：${this.processingError(preview.statusCode)}`;
              } else if (result.processing_result?.actionType === 'start_processing' && result.processing_result.taskId) this.labels.hint.string = '加工已开工';
            }).catch(error => { if (this.canShowProcessingHint(generation, 'processing')) this.labels.hint.string = this.processingError(String(error)); console.error('[wechat-m3] processing-failed', String(error)); });
          }
        } else if (name === 'ProcessingCollect' && this.processingTaskId) {
          this.lastCommandWasRead = false;
          const taskId = this.processingTaskId;
          const generation = this.processingHintGeneration;
          void this.controller!.confirmProcessing({ action_type: 'collect_processing_result', task_option_id: taskId })
            .then(result => {
              if (this.canShowProcessingHint(generation, 'processingTasks') && result.processing_result?.actionType === 'collect_processing_result'
                  && result.processing_result.taskId === taskId && result.processing_result.lotId) this.labels.hint.string = '加工产物已领取';
            })
            .catch(error => { if (this.canShowProcessingHint(generation, 'processingTasks')) this.labels.hint.string = this.processingError(String(error)); console.error('[wechat-m3] processing-collect-failed', String(error)); });
        } else if (name === 'SplitPreview' && lot) {
          this.lastCommandWasRead = false;
          const amount = this.splitAmount();
          if (amount === null) this.labels.hint.string = '请输入大于零的有效数量';
          else void this.controller!.previewSplit(lot.id, { amount, unit: lot.quantity.unit })
            .catch(error => { if (isValid(this.node, true)) this.labels.hint.string = '预览未完成，请重试'; console.error('[wechat-m3] split-preview-failed', String(error)); });
        } else if (name === 'SplitConfirm' && lot) {
          this.lastCommandWasRead = false;
          const amount = this.splitAmount();
          if (amount === null) this.labels.hint.string = '请输入大于零的有效数量';
          else {
            void this.controller!.confirmSplit(lot.id, { amount, unit: lot.quantity.unit }).catch(error => {
              const reason = String(error);
              const rejection = reason.match(/ERR_WECHAT_PROBE_ACTION_FAILED:([^\s]+)/);
              if (isValid(this.node, true)) this.labels.hint.string = reason.includes('ERR_WECHAT_SPLIT_RESULT_UNCERTAIN')
                ? '拆分结果待确认，请查看库存核实' : rejection ? `拆分未通过：${this.splitRejection(rejection[1])}` : '拆分未完成，请查看状态';
              console.error('[wechat-m3] split-confirm-failed', String(error));
            });
          }
        }
        if (name === 'AdvanceDay') { action = this.controller!.advanceDay(); done = '已推进一天'; }
        else if (name === 'FarmPlant' && field && seed) { action = this.controller!.plant(field.id, seed.id, { amount: this.seedAmount, unit: seed.quantity.unit }); done = '播种完成'; }
        else if (name === 'FarmHarvest' && crop) { action = this.controller!.harvest(crop.id); done = '收获完成'; }
        else if (name === 'StockMove' && lot && target && target.id !== lot.storage_ref.container_id) { action = this.controller!.move(lot.id, target.id); done = '转移完成'; }
        if (action) {
          this.lastCommandWasRead = false;
          void action.then(() => { if (isValid(this.node, true) && this.controller?.snapshot().phase === 'ready') this.labels.hint.string = done; })
            .catch(error => { if (isValid(this.node, true)) this.labels.hint.string = '操作未完成，请核对选择'; console.error('[wechat-m3] action-failed', String(error)); });
        }
      }
      this.renderMenu(this.controller!.snapshot());
    };
  }

  private canShowProcessingHint(generation: number, page: 'processing' | 'processingTasks'): boolean {
    const current = this.controller?.snapshot();
    return isValid(this.node, true) && generation === this.processingHintGeneration && this.page === page
      && current?.phase === 'ready' && current.visible;
  }
  private clearProcessingSelection(): void {
    this.processingMethodId = null; this.processingRequirement = 0; this.processingSlot = 0; this.processingFacilityId = null;
    this.processingTaskId = null; this.processingInputs = {}; this.syncProcessingInput();
  }
  private processingKey(): string { return `${this.processingRequirement}:${this.processingSlot}`; }
  private syncProcessingInput(): void {
    if (this.processingInput) this.processingInput.string = this.processingInputs[this.processingKey()]?.amount ?? '';
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
    const text = this.splitInput?.string.trim() ?? '';
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
    const value = Number(text);
    return Number.isFinite(value) && value > 0 ? value : null;
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
    this.farmNode.active = this.page === 'farm';
    this.stockNode.active = this.page === 'stock';
    this.splitNode.active = this.page === 'split';
    if (this.processingNode) this.processingNode.active = this.page === 'processing';
    if (this.processingTasksNode) this.processingTasksNode.active = this.page === 'processingTasks';
    this.labels.farmField.string = field ? `地块${fields.findIndex(x => x.id === field.id) + 1}/${fields.length}：${this.names[field.definition_id] ?? '已选地块'} · 可用${fields.filter(x => x.enabled).length}` : `地块：请选择（可用${fields.filter(x => x.enabled).length}/${fields.length}）`;
    this.labels.farmSeed.string = seed ? `种子${seeds.findIndex(x => x.id === seed.id) + 1}/${seeds.length}：${this.names[seed.base_id] ?? '种子批次'} · 现有${seed.quantity.amount}${unit(seed.quantity.unit)} · 播种${this.seedAmount}${unit(seed.quantity.unit)}` : '种子：请选择种子批次';
    this.labels.farmCrop.string = crop ? `作物${crops.findIndex(x => x.id === crop.id) + 1}/${crops.length}：${this.names[crop.crop_base_id] ?? '已选作物'} · 可收获${crops.filter(x => x.enabled).length}株` : `作物：可收获${crops.filter(x => x.enabled).length}株`;
    this.labels.stockLot.string = lot ? `批次${lots.findIndex(x => x.id === lot.id) + 1}/${lots.length}：${this.names[lot.base_id] ?? '材料'} ${lot.quantity.amount}${unit(lot.quantity.unit)} · ${place(lot.storage_ref.storage_type)}${lot.enabled ? '' : ' · 不可用'}` : `库存：${lots.length}批，请选择材料`;
    this.labels.stockTarget.string = target ? `目标${targets.findIndex(x => x.id === target.id) + 1}/${targets.length}：${place(target.storage_type)} · 已用${target.used_capacity}/${target.capacity.amount}${unit(target.capacity.unit)}${target.enabled ? '' : ' · 不可用'}` : `目标：${targets.length}处，请选择储存位置`;
    this.labels.stockHelp.string = lot ? `形态：${this.names[`${lot.base_id}:${lot.current_form}`] ?? FORMS[lot.current_form] ?? lot.current_form} · 目标支持：${target?.supported_forms.map(form => FORMS[form] ?? form).join('/') || '未列出'} · 整批转移` : '选择材料批次与目标后可整批转移';
    this.labels.splitLot.string = lot ? `拆分：${this.names[lot.base_id] ?? '材料'} · 当前${lot.quantity.amount}${unit(lot.quantity.unit)}` : '请返回库存选择材料批次';
    this.labels.splitUnit.string = lot ? `数量单位：${unit(lot.quantity.unit)}` : '数量单位：—';
    const preview = state.split_preview;
    const result = state.split_result;
    const resultIndex = result ? lots.findIndex(x => x.id === result.newLotId) : -1;
    this.labels.splitPreview.string = result ? `${resultIndex < 0 ? '新增批次' : `新增第${resultIndex + 1}批`}：${result.quantity.amount}${unit(result.quantity.unit)} · ${result.remainingQuantity ? `来源剩余${result.remainingQuantity.amount}${unit(result.remainingQuantity.unit)}` : '来源已全部拆出'}`
      : preview ? preview.success ? '校验通过，尚未执行' : `校验未通过：${this.splitRejection(preview.statusCode)}` : '填写数量后可直接拆分，也可先预览';
    const enabled = state.phase === 'ready' && state.visible && !state.busy;
    this.splitInput.enabled = enabled && this.page === 'split' && !!lot?.enabled;
    const set = (name: string, value: boolean) => { const button = this.menuButtons[name]; if (button && isValid(button.node, true)) button.interactable = enabled && value; };
    set('PageFarm', true); set('PageStock', true); set('AdvanceDay', true);
    set('FarmField', fields.some(x => x.enabled)); set('FarmSeed', seeds.some(x => x.enabled)); set('FarmCrop', crops.some(x => x.enabled));
    set('FarmMinus', !!seed && this.seedAmount > 1); set('FarmPlus', !!seed && Number.isSafeInteger(this.seedAmount + 1));
    set('FarmPlant', !!field && !!seed); set('FarmHarvest', !!crop);
    set('StockLot', lots.length > 0); set('StockTarget', targets.length > 0);
    set('StockMove', !!lot?.enabled && !!target?.enabled && target.id !== lot.storage_ref.container_id);
    set('StockSplit', !!lot?.enabled); set('SplitBack', true); set('SplitPreview', !!lot?.enabled);
    set('SplitConfirm', !!lot?.enabled);
    if (this.processingNode && this.processingTasksNode && this.processingInput) this.renderProcessing(state, enabled, set);
  }

  private renderProcessing(state: WechatProbeSnapshot, enabled: boolean, set: (name: string, value: boolean) => void): void {
    const options = state.menu?.selectable_view_model;
    const methods = options?.processing_method_options ?? [];
    const method = methods.find(x => x.id === this.processingMethodId);
    if (!method && this.processingMethodId) this.clearProcessingSelection();
    const requirement = method?.input_requirements[this.processingRequirement];
    const entry = this.processingInputs[this.processingKey()];
    const lot = options?.processable_lot_options.find(x => x.id === entry?.lotId && x.enabled && requirement?.lot_ids.includes(x.id));
    const facilities = options?.processing_facility_options ?? [];
    const facility = facilities.find(x => x.id === this.processingFacilityId && x.enabled && method?.compatible_facility_ids.includes(x.id));
    if (!facility) this.processingFacilityId = null;
    const tasks = options?.processing_task_options ?? [];
    const task = tasks.find(x => x.id === this.processingTaskId);
    if (!task) this.processingTaskId = null;
    const unit = (value: string) => UNITS[value] ?? value;
    this.labels.processingMethod.string = method ? `方法：${this.names[method.id] ?? method.id} · 加工${method.process_duration_minutes}分${method.tool_requirements.length ? ` · 工具：${method.tool_requirements.map(id => this.names[id] ?? PROCESSING_NAMES[id] ?? id).join('/')}` : ''}` : '方法：请选择';
    const c = requirement?.constraints;
    const criteria = c ? [c.base_id && (this.names[c.base_id] ?? c.base_id), c.category && (this.names[c.category] ?? PROCESSING_NAMES[c.category] ?? c.category), c.allowed_base_ids.map(id => this.names[id] ?? id).join('/'), c.allowed_forms.map(form => FORMS[form] ?? form).join('/'), c.min_freshness === null ? '' : `新鲜度≥${c.min_freshness}`].filter(Boolean).join(' · ') : '';
    this.labels.processingRequirement.string = requirement ? `要求${this.processingRequirement + 1}/${method!.input_requirements.length}：${criteria || '材料'}${requirement.min_quantity ? ` · 至少${requirement.min_quantity.amount}${unit(requirement.min_quantity.unit)}` : ''}` : '要求：请选择加工方法';
    this.labels.processingLot.string = lot ? `项${this.processingSlot + 1}：${this.names[lot.base_id] ?? lot.base_id} ${lot.quantity.amount}${unit(lot.quantity.unit)} · ${FORMS[lot.current_form] ?? lot.current_form}` : `项${this.processingSlot + 1}：可选${requirement?.lot_ids.length ?? 0}批`;
    this.labels.processingFacility.string = facility ? `设施：${this.names[facility.definition_id] ?? PROCESSING_NAMES[facility.definition_id] ?? facility.definition_id}` : '设施：请选择匹配设施';
    const statuses: Record<string, string> = { active: '进行中', in_progress: '进行中', ready_to_collect: '可领取', completed: '已领取' };
    this.labels.processingTask.string = task ? `任务${tasks.findIndex(x => x.id === task.id) + 1}/${tasks.length}：${this.names[task.method_id] ?? task.method_id} · ${statuses[task.status] ?? task.status}` : `任务：${tasks.length}项，请选择`;
    const out = task?.expected_output;
    this.labels.processingOutput.string = task ? `预计完成 ${this.processingTimeLabel(task.expected_finish_minute)} · 预计产物${out?.base_id ? (this.names[out.base_id] ?? out.base_id) : '未列出'}${out?.quantity ? ` ${out.quantity.amount}${unit(out.quantity.unit)}` : ''}` : '可推进时间，再选择已完成任务领取';
    this.processingInput!.enabled = enabled && this.page === 'processing' && !!lot;
    set('PageProcessing', true); set('ProcessingMethod', methods.length > 0); set('ProcessingRequirement', !!method?.input_requirements.length);
    set('ProcessingLot', !!requirement?.lot_ids.length); set('ProcessingSlot', !!requirement); set('ProcessingTasks', true); set('ProcessingBack', true);
    set('ProcessingFacility', facilities.some(x => x.enabled && !!method?.compatible_facility_ids.includes(x.id)));
    set('ProcessingTask', tasks.length > 0); set('ProcessingPreview', !!method && !!facility); set('ProcessingStart', !!method && !!facility);
    set('ProcessingCollect', !!task && !!options?.collectable_task_options.some(x => x.id === task.id && x.enabled));
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
    this.labels.splitPreview = this.menuLabel(this.splitNode, 'splitPreview', 0, -85);
    this.menuButtons.SplitBack = this.smallButton(this.splitNode, 'SplitBack', '返回库存', -330, -140);
    this.menuButtons.SplitPreview = this.smallButton(this.splitNode, 'SplitPreview', '预览拆分', -110, -140);
    this.menuButtons.SplitConfirm = this.smallButton(this.splitNode, 'SplitConfirm', '确认拆分', 110, -140);

    this.processingNode = new Node('ProcessingPage');
    this.processingNode.layer = Layers.Enum.UI_2D; root.addChild(this.processingNode);
    this.processingNode.addComponent(UITransform).setContentSize(960, 540);
    this.menuButtons.ProcessingMethod = this.smallButton(this.processingNode, 'ProcessingMethod', '选择方法', -350, 25);
    this.labels.processingMethod = this.menuLabel(this.processingNode, 'processingMethod', 80, 25);
    this.menuButtons.ProcessingRequirement = this.smallButton(this.processingNode, 'ProcessingRequirement', '选择要求', -350, -30);
    this.labels.processingRequirement = this.menuLabel(this.processingNode, 'processingRequirement', 80, -30);
    this.menuButtons.ProcessingLot = this.smallButton(this.processingNode, 'ProcessingLot', '换材料/清除', -350, -85);
    this.labels.processingLot = this.menuLabel(this.processingNode, 'processingLot', -65, -85);
    this.labels.processingLot.node.getComponent(UITransform)!.setContentSize(350, 40);
    this.processingInput = this.quantityInput(this.processingNode, 320, -85, '输入材料数量');
    this.menuButtons.ProcessingTasks = this.smallButton(this.processingNode, 'ProcessingTasks', '设施与任务', -330, -140);
    this.menuButtons.ProcessingPreview = this.smallButton(this.processingNode, 'ProcessingPreview', '预览加工', -110, -140);
    this.menuButtons.ProcessingStart = this.smallButton(this.processingNode, 'ProcessingStart', '确认开工', 110, -140);
    this.menuButtons.ProcessingSlot = this.smallButton(this.processingNode, 'ProcessingSlot', '下一材料项', 330, -140);

    this.processingTasksNode = new Node('ProcessingTasksPage');
    this.processingTasksNode.layer = Layers.Enum.UI_2D; root.addChild(this.processingTasksNode);
    this.processingTasksNode.addComponent(UITransform).setContentSize(960, 540);
    this.menuButtons.ProcessingFacility = this.smallButton(this.processingTasksNode, 'ProcessingFacility', '选择设施', -350, 25);
    this.labels.processingFacility = this.menuLabel(this.processingTasksNode, 'processingFacility', 80, 25);
    this.menuButtons.ProcessingTask = this.smallButton(this.processingTasksNode, 'ProcessingTask', '选择任务', -350, -30);
    this.labels.processingTask = this.menuLabel(this.processingTasksNode, 'processingTask', 80, -30);
    this.labels.processingOutput = this.menuLabel(this.processingTasksNode, 'processingOutput', 0, -85);
    this.menuButtons.ProcessingBack = this.smallButton(this.processingTasksNode, 'ProcessingBack', '返回加工', -330, -140);
    this.menuButtons.ProcessingCollect = this.smallButton(this.processingTasksNode, 'ProcessingCollect', '领取产物', 110, -140);

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
