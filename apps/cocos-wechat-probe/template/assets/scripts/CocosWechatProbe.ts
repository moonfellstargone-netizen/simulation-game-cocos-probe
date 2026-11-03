import { _decorator, Button, Camera, Canvas, Color, Component, Graphics, isValid,
  JsonAsset, Label, Layers, Node, resources, ResolutionPolicy, screen, UITransform, view } from 'cc';
import { createStage1AHost, InMemorySaveStoragePort, QinglanUiSceneProbeComponent } from '../generated/probe-runtime.js';
import { WechatProbeController, type WechatProbeSnapshot, type WechatResources } from './WechatProbeController';

const { ccclass } = _decorator;

@ccclass('CocosWechatProbe')
export class CocosWechatProbe extends Component {
  private controller: WechatProbeController | null = null;
  private labels: Record<string, Label> = {};
  private button: Button | null = null;
  private clickCount = 0;

  onLoad(): void {
    this.createView();
    this.controller = new WechatProbeController({
      load: async () => {
        const [loadedResources, identity] = await Promise.all([this.loadJson('probe-resources'), this.loadJson('candidate-identity')]);
        return { resources: loadedResources as WechatResources, identity };
      },
      createHost: input => createStage1AHost({ ...input, storage: new InMemorySaveStoragePort(), nowIso8601: new Date().toISOString() }),
      createBinding: host => new QinglanUiSceneProbeComponent(host, { applyNodeBindingPatch: () => {} }),
      onChange: state => this.render(state)
    });
    this.button!.node.on(Button.EventType.CLICK, this.onAdvance, this);
    console.info('[wechat-m1] viewport', JSON.stringify({ visible: view.getVisibleSize(), window: screen.windowSize,
      devicePixelRatio: screen.devicePixelRatio }));
    void this.controller.start().catch(error => console.error('[wechat-m1] startup-failed', String(error)));
  }

  onDestroy(): void {
    if (this.button && isValid(this.button.node, true)) this.button.node.off(Button.EventType.CLICK, this.onAdvance, this);
    void this.controller?.dispose().catch(error => console.error('[wechat-m1] close-failed', String(error)));
  }

  private onAdvance(): void {
    this.clickCount++;
    console.info('[wechat-m1] button-click', JSON.stringify({ click_count: this.clickCount, candidate_id: this.controller?.snapshot().identity?.candidate_id }));
    void this.controller?.advance().catch(error => console.error('[wechat-m1] action-failed', String(error)));
  }

  private render(state: WechatProbeSnapshot): void {
    if (!isValid(this.node, true)) return;
    const identity = state.identity;
    this.labels.candidate.string = identity ? `candidate_id: ${identity.candidate_id}` : 'candidate_id: 加载中';
    this.labels.commit.string = identity ? `${identity.version}  commit: ${identity.short_commit}` : '读取运行包身份';
    this.labels.time.string = state.time_label ?? '等待正式资源启动';
    this.labels.status.string = state.last_error ?? `状态: ${state.phase}${state.busy ? ' · 执行中' : ''}`;
    this.labels.result.string = `按钮事件 ${this.clickCount} · 已完成正式操作 ${state.completed_commands}`;
    if (this.button && isValid(this.button, true)) this.button.interactable = state.phase === 'ready' && !state.busy;
    console.info('[wechat-m1] state', JSON.stringify({ ...state, click_count: this.clickCount }));
  }

  private loadJson(name: string): Promise<unknown> {
    return new Promise((accept, reject) => resources.load(name, JsonAsset, (error, asset) => {
      if (error) reject(error);
      else if (!asset) reject(new Error('ERR_WECHAT_RESOURCE_MISSING:' + name));
      else accept(asset.json);
    }));
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
    buttonNode.setPosition(0, -102, 0);
    buttonNode.addComponent(UITransform).setContentSize(360, 72);
    const graphics = buttonNode.addComponent(Graphics);
    graphics.fillColor = new Color(62, 118, 125, 255);
    graphics.roundRect(-180, -36, 360, 72, 10);
    graphics.fill();
    this.button = buttonNode.addComponent(Button);
    this.button.transition = Button.Transition.NONE;
    this.button.interactable = false;
    this.label(buttonNode, 'caption', '推进一小时', 0, 26).node.getComponent(UITransform)!.setContentSize(350, 70);
    this.labels.result = this.label(root, 'result', '按钮事件 0 · 已完成正式操作 0', -167, 22);
    this.label(root, 'hint', '本轮使用临时新局，重载后重新开始', -215, 22);
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
