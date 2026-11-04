import { _decorator, Button, Camera, Canvas, Color, Component, Game, game, Graphics, isValid,
  JsonAsset, Label, Layers, Node, resources, ResolutionPolicy, screen, sys, UITransform, view } from 'cc';
import { createStage1AHost, QinglanUiSceneProbeComponent } from '../generated/probe-runtime.js';
import { WechatProbeController, type WechatProbeSnapshot, type WechatResources } from './WechatProbeController';
import { WECHAT_BACKUP_SLOT_ID, WechatSaveStoragePort } from './WechatSaveStoragePort';
import { createWechatPriorSaveValidator } from './WechatPriorSaveValidator';

const { ccclass } = _decorator;

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
  private clickCount = 0;

  onLoad(): void {
    this.createView();
    let storage: WechatSaveStoragePort | null = null;
    let validateSaved: ((serialized: string) => Promise<void>) | null = null;
    this.controller = new WechatProbeController({
      load: async () => {
        const [loadedResources, identity] = await Promise.all([this.loadJson('probe-resources'), this.loadJson('candidate-identity')]);
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
      createBinding: host => new QinglanUiSceneProbeComponent(host, { applyNodeBindingPatch: () => {} }),
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
    game.off(Game.EVENT_HIDE, this.onHide, this);
    game.off(Game.EVENT_SHOW, this.onShow, this);
    void this.controller?.dispose().catch(error => console.error('[wechat-m1] close-failed', String(error)));
  }

  private onAdvance(): void {
    this.resetCancelConfirmation();
    this.clickCount++;
    console.info('[wechat-m1] button-click', JSON.stringify({ click_count: this.clickCount, candidate_id: this.controller?.snapshot().identity?.candidate_id }));
    void this.controller?.advance().catch(error => console.error('[wechat-m1] action-failed', String(error)));
  }

  private onSave(): void { this.resetCancelConfirmation(); void this.controller?.save().catch(error => console.error('[wechat-m2] save-failed', String(error))); }
  private onRead(): void { this.resetCancelConfirmation(); void this.controller?.load().catch(error => console.error('[wechat-m2] load-failed', String(error))); }
  private onReadBackup(): void { this.resetCancelConfirmation(); void this.controller?.loadBackup().catch(error => console.error('[wechat-m2] backup-load-failed', String(error))); }
  private onCancelFirst(): void {
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
  private onHide(): void { this.resetCancelConfirmation(); this.controller?.setVisible(false); }
  private onShow(): void { this.controller?.setVisible(true); }

  private render(state: WechatProbeSnapshot): void {
    if (!isValid(this.node, true)) return;
    const identity = state.identity;
    this.labels.candidate.string = identity ? `candidate_id: ${identity.candidate_id}` : 'candidate_id: 加载中';
    this.labels.commit.string = identity ? `${identity.version}  commit: ${identity.short_commit}` : '读取运行包身份';
    this.labels.time.string = state.time_label ?? '等待正式资源启动';
    this.labels.status.string = state.last_error ? this.errorText(state.last_error) : `状态: ${state.phase}${state.busy ? ' · 执行中' : ''}${state.visible ? '' : ' · 后台'}`;
    this.labels.result.string = `推进按钮 ${this.clickCount} · 已完成命令 ${state.completed_commands}`;
    for (const button of [this.button, this.saveButton, this.loadButton, this.backupButton, this.cancelFirstButton]) {
      if (button && isValid(button, true)) button.interactable = state.phase === 'ready' && !state.busy && state.visible;
    }
    console.info('[wechat-m1] state', JSON.stringify({ ...state, click_count: this.clickCount }));
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
    this.label(root, 'title', '青岚 · 微信运行试水', 205, 30);
    this.labels.commit = this.label(root, 'commit', '读取运行包身份', 146, 23);
    this.labels.candidate = this.label(root, 'candidate', 'candidate_id: 加载中', 102, 22);
    this.labels.time = this.label(root, 'time', '等待正式资源启动', 28, 30);
    this.labels.status = this.label(root, 'status', '状态: idle', -27, 21);
    const buttonNode = new Node('AdvanceOneHour');
    buttonNode.layer = Layers.Enum.UI_2D;
    root.addChild(buttonNode);
    buttonNode.setPosition(0, -82, 0);
    buttonNode.addComponent(UITransform).setContentSize(360, 72);
    const graphics = buttonNode.addComponent(Graphics);
    graphics.fillColor = new Color(62, 118, 125, 255);
    graphics.roundRect(-180, -36, 360, 72, 10);
    graphics.fill();
    this.button = buttonNode.addComponent(Button);
    this.button.transition = Button.Transition.NONE;
    this.button.interactable = false;
    this.label(buttonNode, 'caption', '推进一小时', 0, 26).node.getComponent(UITransform)!.setContentSize(350, 70);
    this.saveButton = this.smallButton(root, 'Save', '保存', -300, -150);
    this.loadButton = this.smallButton(root, 'Load', '读取', -100, -150);
    this.backupButton = this.smallButton(root, 'LoadBackup', '恢复备份', 100, -150);
    this.cancelFirstButton = this.smallButton(root, 'CancelFirstSave', '撤销首档', 300, -150);
    this.labels.result = this.label(root, 'result', '推进按钮 0 · 已完成命令 0', -205, 20);
    this.labels.hint = this.label(root, 'hint', '手动保存与读取；可选择恢复失败存档', -245, 18);
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
