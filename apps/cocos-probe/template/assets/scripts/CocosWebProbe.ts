import {
  _decorator, Button, Camera, Canvas, Color, Component, Graphics, isValid,
  JsonAsset, Label, Layers, Node, resources, ResolutionPolicy, UITransform, view
} from 'cc';
import { createStage1AHost, InMemorySaveStoragePort, QinglanUiSceneProbeComponent } from '../generated/probe-runtime.js';
import { ProbeLifetime, type ProbePhase, type ProbeResources } from './ProbeLifetime';

const { ccclass } = _decorator;

@ccclass('CocosWebProbe')
export class CocosWebProbe extends Component {
  private lifetime: ProbeLifetime | null = null;
  private timeLabel: Label | null = null;
  private statusLabel: Label | null = null;
  private advanceButton: Button | null = null;
  private resourceAsset: JsonAsset | null = null;
  private readonly errors: string[] = [];

  onLoad(): void {
    this.createView();
    this.lifetime = new ProbeLifetime({
      loadResources: () => this.loadResources(),
      createHost: (input) => createStage1AHost({
        ...input,
        storage: new InMemorySaveStoragePort(),
        nowIso8601: new Date().toISOString()
      }),
      createBinding: (host) => new QinglanUiSceneProbeComponent(host, {
        applyNodeBindingPatch: (patch) => {
          if (!this.lifetime || this.lifetime.isDisposed() || !isValid(this.node, true)) {
            return;
          }
          if (patch.section === 'menu') {
            const menu = patch.payload as { view_model?: { time_label?: string } | null };
            if (menu.view_model?.time_label && this.timeLabel) this.timeLabel.string = menu.view_model.time_label;
          }
        }
      }),
      onPhase: (phase) => this.renderPhase(phase),
      onError: (error) => this.renderError(error)
    });

    // Read-only observations and public commands support repeatable real-browser probe evidence.
    const lifetime = this.lifetime;
    const rootNode = this.node;
    const timeLabel = this.timeLabel;
    const errors = this.errors;
    const observer = Object.freeze({
      status: () => ({
        ...lifetime.status(),
        displayedTime: isValid(rootNode, true) && timeLabel && isValid(timeLabel, true) ? timeLabel.string : null,
        nodeValid: isValid(rootNode, true),
        errors: [...errors]
      }),
      advance: () => this.advance(),
      memoryRoundtrip: () => this.memoryRoundtrip(),
      dispose: () => { if (isValid(rootNode, true)) rootNode.destroy(); }
    });
    (globalThis as typeof globalThis & { __cocosWebProbe?: typeof observer }).__cocosWebProbe = observer;
    void this.lifetime.start().catch(() => { /* The lifecycle already reports startup errors. */ });
  }

  onDestroy(): void {
    // Creator does not await this callback. Mark disposal synchronously before async cleanup.
    const asset = this.resourceAsset;
    this.resourceAsset = null;
    const closing = this.lifetime?.dispose() ?? Promise.resolve();
    void closing.catch((error) => console.error(error)).finally(() => {
      asset?.decRef();
    });
  }

  private loadResources(): Promise<ProbeResources> {
    return new Promise((resolve, reject) => {
      resources.load('probe-resources', JsonAsset, (error, asset) => {
        if (error || !asset) {
          reject(error ?? new Error('ERR_COCOS_PROBE_RESOURCES_MISSING'));
          return;
        }
        if (!this.lifetime?.isDisposed() && isValid(this.node, true)) {
          asset.addRef();
          this.resourceAsset = asset;
        }
        resolve(asset.json as ProbeResources);
      });
    });
  }

  private async advance(): Promise<void> {
    if (!this.lifetime || !isValid(this.node, true)) throw new Error('ERR_COCOS_PROBE_NOT_READY');
    const result = await this.lifetime.execute({
      name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 }
    });
    if (result.command_result.status !== 'completed') throw new Error('ERR_COCOS_PROBE_ACTION_FAILED');
  }

  private async memoryRoundtrip(): Promise<void> {
    if (!this.lifetime || !isValid(this.node, true)) throw new Error('ERR_COCOS_PROBE_NOT_READY');
    const before = this.lifetime.status().timeLabel;
    for (const command of [
      { name: 'save', selection: { slot_id: 'web_probe' } },
      { name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } },
      { name: 'load', selection: { slot_id: 'web_probe' } }
    ] as const) {
      const result = await this.lifetime.execute(command);
      if (result.command_result.status !== 'completed') throw new Error('ERR_COCOS_PROBE_MEMORY_ROUNDTRIP_FAILED');
    }
    if (this.lifetime.status().timeLabel !== before) throw new Error('ERR_COCOS_PROBE_MEMORY_RESTORE_MISMATCH');
  }

  private renderPhase(phase: ProbePhase): void {
    if (!isValid(this.node, true)) return;
    if (this.advanceButton) this.advanceButton.interactable = phase === 'ready';
    if (this.statusLabel) {
      this.statusLabel.string = ({
        idle: '准备启动', loading: '正在读取资源', ready: '会话已就绪',
        failed: '启动失败', closing: '正在退出', closed: '已退出'
      })[phase];
    }
  }

  private renderError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.errors.push(message);
    if (isValid(this.node, true) && this.statusLabel) this.statusLabel.string = `启动失败：${message}`;
    console.error('[CocosWebProbe]', message, error);
  }

  private createView(): void {
    view.setDesignResolutionSize(960, 640, ResolutionPolicy.SHOW_ALL);
    const canvasNode = new Node('ProbeCanvas');
    canvasNode.layer = Layers.Enum.UI_2D;
    this.node.addChild(canvasNode);
    canvasNode.addComponent(UITransform).setContentSize(960, 640);
    const canvas = canvasNode.addComponent(Canvas);
    const cameraNode = new Node('ProbeCamera');
    this.node.addChild(cameraNode);
    cameraNode.setPosition(0, 0, 1000);
    const camera = cameraNode.addComponent(Camera);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.orthoHeight = 320;
    camera.near = 0;
    camera.far = 2000;
    camera.visibility = Layers.Enum.UI_2D;
    camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    camera.clearColor = new Color(22, 31, 42, 255);
    canvas.cameraComponent = camera;
    canvas.alignCanvasWithScreen = true;

    this.makeLabel(canvasNode, 'Title', '青岚 · 时间试跑', 168, 34);
    this.timeLabel = this.makeLabel(canvasNode, 'Time', '等待启动', 70, 30);
    this.statusLabel = this.makeLabel(canvasNode, 'Status', '准备启动', -145, 19);
    const buttonNode = new Node('AdvanceOneHour');
    buttonNode.layer = Layers.Enum.UI_2D;
    canvasNode.addChild(buttonNode);
    buttonNode.setPosition(0, -35, 0);
    buttonNode.addComponent(UITransform).setContentSize(280, 68);
    const graphics = buttonNode.addComponent(Graphics);
    graphics.fillColor = new Color(62, 118, 125, 255);
    graphics.roundRect(-140, -34, 280, 68, 12);
    graphics.fill();
    this.advanceButton = buttonNode.addComponent(Button);
    this.advanceButton.transition = Button.Transition.NONE;
    this.advanceButton.interactable = false;
    buttonNode.on(Button.EventType.CLICK, () => {
      void this.advance().catch((error) => this.renderError(error));
    }, this);
    const caption = this.makeLabel(buttonNode, 'Caption', '推进一小时', 0, 24);
    caption.node.getComponent(UITransform)!.setContentSize(270, 60);
  }

  private makeLabel(parent: Node, name: string, text: string, y: number, fontSize: number): Label {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(0, y, 0);
    node.addComponent(UITransform).setContentSize(880, 70);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 8;
    label.horizontalAlign = 1;
    label.verticalAlign = 1;
    label.color = new Color(236, 239, 234, 255);
    return label;
  }
}
