import {
  _decorator, Button, Camera, Canvas, Color, Component, Graphics, isValid,
  JsonAsset, Label, Layers, Node, resources, ResolutionPolicy, UITransform, view
} from 'cc';
import { createStage1AHost, QinglanUiSceneProbeComponent } from '../generated/probe-runtime.js';
import { ProbeLifetime, type ProbeCommand, type ProbePhase, type ProbeResources } from './ProbeLifetime';
import { ProbeInteraction } from './ProbeInteraction';
import { BrowserSaveStoragePort, BROWSER_SAVE_SLOT_ID } from './BrowserSaveStoragePort';

const { ccclass } = _decorator;
const ADVANCE_COMMAND = { name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } } as const;

interface ProbeView {
  readonly root: Node;
  readonly time: Label;
  readonly phase: Label;
  readonly operation: Label;
  readonly buttons: readonly Button[];
}

@ccclass('CocosWebProbe')
export class CocosWebProbe extends Component {
  private lifetime: ProbeLifetime | null = null;
  private assetOwner: { asset: JsonAsset | null } | null = null;

  onLoad(): void {
    const ui = this.createView();
    const errors: string[] = [];
    const owner = { asset: null as JsonAsset | null };
    this.assetOwner = owner;
    let interaction: ProbeInteraction | null = null;
    const alive = () => isValid(ui.root, true);
    const updateButtons = () => {
      if (!alive()) return;
      const enabled = lifetime.status().phase === 'ready' && !lifetime.isDisposed() && !interaction?.status().busy;
      for (const button of ui.buttons) if (isValid(button, true)) button.interactable = enabled;
    };
    const unexpected = (error: unknown, startup = false) => {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      if (alive()) {
        if (startup) ui.phase.string = '启动失败';
        else ui.operation.string = '操作异常，请重试';
      }
      console.error('[CocosWebProbe]', message, error);
    };
    const lifetime = new ProbeLifetime({
      loadResources: () => new Promise<ProbeResources>((resolve, reject) => {
        resources.load('probe-resources', JsonAsset, (error, asset) => {
          if (error || !asset) {
            reject(error ?? new Error('ERR_COCOS_PROBE_RESOURCES_MISSING'));
            return;
          }
          if (!lifetime.isDisposed() && alive()) {
            asset.addRef();
            owner.asset = asset;
          }
          resolve(asset.json as ProbeResources);
        });
      }),
      createHost: (input) => createStage1AHost({
        ...input, storage: new BrowserSaveStoragePort(), nowIso8601: new Date().toISOString()
      }),
      createBinding: (host) => new QinglanUiSceneProbeComponent(host, {
        applyNodeBindingPatch: (patch) => {
          if (lifetime.isDisposed() || !alive()) return;
          if (patch.section === 'menu') {
            const menu = patch.payload as { view_model?: { time_label?: string } | null };
            if (menu.view_model?.time_label) ui.time.string = menu.view_model.time_label;
          }
        }
      }),
      onPhase: (phase) => {
        if (!alive()) return;
        ui.phase.string = ({
          idle: '准备启动', loading: '正在读取资源', ready: '会话已就绪',
          failed: '启动失败', closing: '正在退出', closed: '已退出'
        } satisfies Record<ProbePhase, string>)[phase];
        updateButtons();
      },
      onError: (error) => unexpected(error, true)
    });
    this.lifetime = lifetime;
    interaction = new ProbeInteraction({
      isAvailable: () => alive() && !lifetime.isDisposed() && lifetime.status().phase === 'ready',
      execute: (command) => lifetime.execute(command),
      onChange: (state) => {
        ui.operation.string = state.operation.message;
        updateButtons();
      }
    });
    // Capture the stable coordinator and view. Creator may clear Component fields on destruction.
    const commands = interaction;
    const executeButton = (command: ProbeCommand) => {
      void commands.execute(command).catch((error) => unexpected(error));
    };
    ui.buttons[0].node.on(Button.EventType.CLICK, () => executeButton(ADVANCE_COMMAND));
    ui.buttons[1].node.on(Button.EventType.CLICK, () => executeButton({ name: 'save', selection: { slot_id: BROWSER_SAVE_SLOT_ID } }));
    ui.buttons[2].node.on(Button.EventType.CLICK, () => executeButton({ name: 'load', selection: { slot_id: BROWSER_SAVE_SLOT_ID } }));

    const executeRequired = async (command: ProbeCommand) => {
      const result = await commands.execute(command);
      if (!result) throw new Error('ERR_COCOS_PROBE_NOT_READY');
      if (result.command_result.status !== 'completed') {
        throw new Error(result.command_result.error_message ?? 'ERR_COCOS_PROBE_COMMAND_FAILED');
      }
    };
    const observer = Object.freeze({
      status: () => ({
        ...lifetime.status(), ...commands.status(),
        displayedTime: alive() && isValid(ui.time, true) ? ui.time.string : null,
        displayedOperation: alive() && isValid(ui.operation, true) ? ui.operation.string : null,
        nodeValid: alive(), errors: [...errors]
      }),
      advance: () => executeRequired(ADVANCE_COMMAND),
      dispose: () => { if (alive()) ui.root.destroy(); }
    });
    (globalThis as typeof globalThis & { __cocosWebProbe?: typeof observer }).__cocosWebProbe = observer;
    void lifetime.start().catch(() => { /* Startup already published its original error. */ });
  }

  onDestroy(): void {
    const asset = this.assetOwner?.asset ?? null;
    if (this.assetOwner) this.assetOwner.asset = null;
    const closing = this.lifetime?.dispose() ?? Promise.resolve();
    void closing.catch((error) => console.error(error)).finally(() => asset?.decRef());
  }

  private createView(): ProbeView {
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

    this.makeLabel(canvasNode, 'Title', '青岚 · 时间试跑', 192, 32);
    const time = this.makeLabel(canvasNode, 'Time', '等待启动', 116, 30);
    const buttons = [
      this.makeButton(canvasNode, 'AdvanceOneHour', '推进一小时', 0, 24),
      this.makeButton(canvasNode, 'SaveLocal', '本地保存', -158, -64),
      this.makeButton(canvasNode, 'LoadLocal', '读取本地存档', 158, -64)
    ];
    const phase = this.makeLabel(canvasNode, 'Status', '准备启动', -145, 19);
    const operation = this.makeLabel(canvasNode, 'Operation', '可推进时间或本地保存', -190, 21);
    this.makeLabel(canvasNode, 'LocalSaveHint', '本浏览器本地存档，刷新后可手动读取', -249, 18);
    return { root: this.node, time, phase, operation, buttons };
  }

  private makeButton(parent: Node, name: string, text: string, x: number, y: number): Button {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(280, 62);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(62, 118, 125, 255);
    graphics.roundRect(-140, -31, 280, 62, 12);
    graphics.fill();
    const button = node.addComponent(Button);
    button.transition = Button.Transition.NONE;
    button.interactable = false;
    const caption = this.makeLabel(node, 'Caption', text, 0, 23);
    caption.node.getComponent(UITransform)!.setContentSize(270, 60);
    return button;
  }

  private makeLabel(parent: Node, name: string, text: string, y: number, fontSize: number): Label {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(0, y, 0);
    node.addComponent(UITransform).setContentSize(880, 44);
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
