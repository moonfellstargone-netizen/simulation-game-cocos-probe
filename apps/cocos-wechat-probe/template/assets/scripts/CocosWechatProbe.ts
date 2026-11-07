import { _decorator, Button, Camera, Canvas, Color, Component, Game, game, Graphics, isValid,
  JsonAsset, Label, Layers, Node, resources, ResolutionPolicy, screen, sys, UITransform, view } from 'cc';
import { createStage1AHost, QinglanUiSceneProbeComponent } from '../generated/probe-runtime.js';
import { WechatProbeController, type WechatProbeSnapshot, type WechatResources } from './WechatProbeController';
import { WECHAT_BACKUP_SLOT_ID, WECHAT_SAVE_SLOT_ID, WechatSaveStoragePort } from './WechatSaveStoragePort';
import { createWechatPriorSaveValidator } from './WechatPriorSaveValidator';

const { ccclass } = _decorator;
const UNITS: Record<string, string> = { count: '粒', g: '克', ml: '毫升', bundle: '捆', serving: '份' };
const STORAGE: Record<string, string> = { room_temp: '常温储存', cellar: '菜窖' };
const FORMS: Record<string, string> = { fresh: '鲜材', cut: '切好', cured: '腌腊', pickled: '腌菜' };

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
  private page: 'farm' | 'stock' = 'farm';
  private farmNode: Node | null = null;
  private stockNode: Node | null = null;
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
    for (const [name, button] of Object.entries(this.menuButtons)) if (isValid(button.node, true)) button.node.off(Button.EventType.CLICK, this.menuHandlers[name], this);
    game.off(Game.EVENT_HIDE, this.onHide, this);
    game.off(Game.EVENT_SHOW, this.onShow, this);
    void this.controller?.dispose().catch(error => console.error('[wechat-m1] close-failed', String(error)));
  }

  private onAdvance(): void {
    this.resetCancelConfirmation();
    this.setCommandReadContext(false);
    this.clickCount++;
    console.info('[wechat-m1] button-click', JSON.stringify({ click_count: this.clickCount, candidate_id: this.controller?.snapshot().identity?.candidate_id }));
    void this.controller?.advance().catch(error => console.error('[wechat-m1] action-failed', String(error)));
  }

  private onSave(): void { this.resetCancelConfirmation(); this.setCommandReadContext(false); void this.controller?.save().catch(error => console.error('[wechat-m2] save-failed', String(error))); }
  private onRead(): void {
    this.resetCancelConfirmation();
    this.setCommandReadContext(true);
    void this.controller?.load().catch(error => {
      if (error instanceof Error && error.message === `ERR_SAVE_SLOT_NOT_FOUND:${WECHAT_SAVE_SLOT_ID}`) {
        console.info('[wechat-m2] empty-save-slot', WECHAT_SAVE_SLOT_ID);
      } else console.error('[wechat-m2] load-failed', String(error));
    });
  }
  private onReadBackup(): void { this.resetCancelConfirmation(); this.setCommandReadContext(false); void this.controller?.loadBackup().catch(error => console.error('[wechat-m2] backup-load-failed', String(error))); }
  private onCancelFirst(): void {
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
  private onHide(): void { this.resetCancelConfirmation(); this.controller?.setVisible(false); }
  private onShow(): void { this.controller?.setVisible(true); }

  private menuHandler(name: string): () => void {
    return () => {
      const state = this.controller?.snapshot();
      if (!state || state.phase !== 'ready' || state.busy || !state.visible) return;
      this.resetCancelConfirmation();
      const options = state.menu?.selectable_view_model;
      if (name === 'PageFarm') this.page = 'farm';
      else if (name === 'PageStock') this.page = 'stock';
      else if (name === 'FarmField') this.fieldId = this.next(options?.field_options.filter(x => x.enabled) ?? [], this.fieldId);
      else if (name === 'FarmSeed') { this.seedId = this.next(options?.seed_lot_options.filter(x => x.enabled) ?? [], this.seedId); this.seedAmount = 1; }
      else if (name === 'FarmCrop') this.cropId = this.next(options?.harvestable_crop_options.filter(x => x.enabled) ?? [], this.cropId);
      else if (name === 'FarmMinus' && this.seedId !== null) this.seedAmount = Math.max(1, this.seedAmount - 1);
      else if (name === 'FarmPlus' && this.seedId !== null && Number.isSafeInteger(this.seedAmount + 1)) this.seedAmount++;
      else if (name === 'StockLot') this.lotId = this.next(options?.splittable_lot_options ?? [], this.lotId);
      else if (name === 'StockTarget') this.targetId = this.next(options?.storage_target_options ?? [], this.targetId);
      else {
        const seed = options?.seed_lot_options.find(x => x.id === this.seedId && x.enabled);
        const field = options?.field_options.find(x => x.id === this.fieldId && x.enabled);
        const crop = options?.harvestable_crop_options.find(x => x.id === this.cropId && x.enabled);
        const lot = options?.splittable_lot_options.find(x => x.id === this.lotId && x.enabled);
        const target = options?.storage_target_options.find(x => x.id === this.targetId && x.enabled);
        let action: Promise<WechatProbeSnapshot> | null = null;
        let done = '';
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

  private next(options: readonly { readonly id: string }[], selected: string | null): string | null {
    if (!options.length) return null;
    return options[(options.findIndex(item => item.id === selected) + 1) % options.length].id;
  }

  private renderMenu(state: WechatProbeSnapshot): void {
    if (!this.farmNode || !this.stockNode) return;
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
    this.labels.farmField.string = field ? `地块${fields.findIndex(x => x.id === field.id) + 1}/${fields.length}：${this.names[field.definition_id] ?? '已选地块'} · 可用${fields.filter(x => x.enabled).length}` : `地块：请选择（可用${fields.filter(x => x.enabled).length}/${fields.length}）`;
    this.labels.farmSeed.string = seed ? `种子${seeds.findIndex(x => x.id === seed.id) + 1}/${seeds.length}：${this.names[seed.base_id] ?? '种子批次'} · 现有${seed.quantity.amount}${unit(seed.quantity.unit)} · 播种${this.seedAmount}${unit(seed.quantity.unit)}` : '种子：请选择种子批次';
    this.labels.farmCrop.string = crop ? `作物${crops.findIndex(x => x.id === crop.id) + 1}/${crops.length}：${this.names[crop.crop_base_id] ?? '已选作物'} · 可收获${crops.filter(x => x.enabled).length}株` : `作物：可收获${crops.filter(x => x.enabled).length}株`;
    this.labels.stockLot.string = lot ? `批次${lots.findIndex(x => x.id === lot.id) + 1}/${lots.length}：${this.names[lot.base_id] ?? '材料'} ${lot.quantity.amount}${unit(lot.quantity.unit)} · ${place(lot.storage_ref.storage_type)}${lot.enabled ? '' : ' · 不可用'}` : `库存：${lots.length}批，请选择材料`;
    this.labels.stockTarget.string = target ? `目标${targets.findIndex(x => x.id === target.id) + 1}/${targets.length}：${place(target.storage_type)} · 已用${target.used_capacity}/${target.capacity.amount}${unit(target.capacity.unit)}${target.enabled ? '' : ' · 不可用'}` : `目标：${targets.length}处，请选择储存位置`;
    this.labels.stockHelp.string = lot ? `形态：${this.names[`${lot.base_id}:${lot.current_form}`] ?? FORMS[lot.current_form] ?? lot.current_form} · 目标支持：${target?.supported_forms.map(form => FORMS[form] ?? form).join('/') || '未列出'} · 整批转移` : '选择材料批次与目标后可整批转移';
    const enabled = state.phase === 'ready' && state.visible && !state.busy;
    const set = (name: string, value: boolean) => { const button = this.menuButtons[name]; if (button && isValid(button.node, true)) button.interactable = enabled && value; };
    set('PageFarm', true); set('PageStock', true); set('AdvanceDay', true);
    set('FarmField', fields.some(x => x.enabled)); set('FarmSeed', seeds.some(x => x.enabled)); set('FarmCrop', crops.some(x => x.enabled));
    set('FarmMinus', !!seed && this.seedAmount > 1); set('FarmPlus', !!seed && Number.isSafeInteger(this.seedAmount + 1));
    set('FarmPlant', !!field && !!seed); set('FarmHarvest', !!crop);
    set('StockLot', lots.length > 0); set('StockTarget', targets.length > 0);
    set('StockMove', !!lot?.enabled && !!target?.enabled && target.id !== lot.storage_ref.container_id);
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
    this.label(root, 'title', '青岚 · 种植与库存', 242, 23);
    this.labels.commit = this.label(root, 'commit', '读取运行包身份', 211, 16);
    this.labels.candidate = this.label(root, 'candidate', 'candidate_id: 加载中', 187, 16);
    this.labels.time = this.label(root, 'time', '等待正式资源启动', 158, 22);
    this.labels.status = this.label(root, 'status', '状态: idle', 128, 18);
    this.menuButtons.PageFarm = this.smallButton(root, 'PageFarm', '种植', -330, 80);
    this.menuButtons.PageStock = this.smallButton(root, 'PageStock', '库存', -110, 80);
    this.button = this.smallButton(root, 'AdvanceOneHour', '推进一小时', 110, 80);
    this.menuButtons.AdvanceDay = this.smallButton(root, 'AdvanceDay', '推进一天', 330, 80);

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

    this.saveButton = this.smallButton(root, 'Save', '保存', -330, -200);
    this.loadButton = this.smallButton(root, 'Load', '读取', -110, -200);
    this.backupButton = this.smallButton(root, 'LoadBackup', '恢复备份', 110, -200);
    this.cancelFirstButton = this.smallButton(root, 'CancelFirstSave', '撤销首档', 330, -200);
    this.labels.result = this.label(root, 'result', '推进按钮 0 · 已完成命令 0', -237, 14);
    this.labels.result.node.getComponent(UITransform)!.setContentSize(900, 18);
    this.labels.hint = this.label(root, 'hint', '手动保存与读取；可选择恢复失败存档', -257, 15);
    this.labels.hint.node.getComponent(UITransform)!.setContentSize(900, 18);
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
