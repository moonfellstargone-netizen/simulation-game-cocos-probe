import {
  _decorator, Button, Camera, Canvas, Color, Component, Graphics, isValid,
  JsonAsset, Label, Layers, Node, resources, ResolutionPolicy, UITransform, view
} from 'cc';
import { createStage1AHost, QinglanUiSceneProbeComponent } from '../generated/probe-runtime.js';
import { ProbeLifetime, type ProbeCommand, type ProbeMenuSnapshot, type ProbePhase, type ProbeResources } from './ProbeLifetime';
import { ProbeInteraction } from './ProbeInteraction';
import { ProbeFarming } from './ProbeFarming';
import { BrowserSaveStoragePort, BROWSER_SAVE_SLOT_ID } from './BrowserSaveStoragePort';

const { ccclass } = _decorator;
const ADVANCE_COMMAND = { name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } } as const;

interface ProbeView {
  readonly root: Node;
  readonly time: Label;
  readonly phase: Label;
  readonly operation: Label;
  readonly buttons: readonly Button[];
  readonly controls: Record<string, Button>;
  readonly farming: { field: Label; seed: Label; crop: Label; inventory: Label; amount: Label };
}

// Display names come from the same prepared formal resources; they never select an action target.
function presentationNames(resources: ProbeResources): Record<string, string> {
  const documents = (resources.snapshot as { loaded_documents?: Record<string, unknown> }).loaded_documents ?? {};
  const text = documents['configs/text/zh_cn.yaml'] as Record<string, unknown> | undefined;
  const names: Record<string, string> = {};
  for (const value of Object.values(documents)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const doc = value as { id?: unknown; display_name_key?: unknown; field_plot_definitions?: Record<string, { display_name_key?: string }> };
    if (typeof doc.id === 'string' && typeof doc.display_name_key === 'string' && typeof text?.[doc.display_name_key] === 'string') {
      names[doc.id] = text[doc.display_name_key] as string;
    }
    for (const [id, field] of Object.entries(doc.field_plot_definitions ?? {})) {
      if (field.display_name_key && typeof text?.[field.display_name_key] === 'string') names[id] = text[field.display_name_key] as string;
    }
  }
  return names;
}

const DISPLAY_UNITS: Record<string, string> = { count: '粒', g: '克', ml: '毫升' };
const displayUnit = (unit: string) => DISPLAY_UNITS[unit] ?? unit;

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
    const farming = new ProbeFarming();
    let names: Record<string, string> = {};
    const alive = () => isValid(ui.root, true);
    const updateButtons = () => {
      if (!alive()) return;
      const enabled = lifetime.status().phase === 'ready' && !lifetime.isDisposed() && !interaction?.status().busy;
      for (const button of ui.buttons) if (isValid(button, true)) button.interactable = enabled;
      const state = farming.status();
      ui.controls.SelectField.interactable = enabled && state.fieldOptions.some((option) => option.enabled);
      ui.controls.SelectSeed.interactable = enabled && state.seedOptions.some((option) => option.enabled);
      ui.controls.SelectCrop.interactable = enabled && state.harvestableOptions.some((option) => option.enabled);
      ui.controls.SeedAmountDecrease.interactable = enabled && state.selectedSeedId !== null && state.seedAmount > 1;
      ui.controls.SeedAmountIncrease.interactable = enabled && state.selectedSeedId !== null;
      ui.controls.PlantCrop.interactable = enabled && state.canPlant;
      ui.controls.HarvestCrop.interactable = enabled && state.canHarvest;
    };
    const renderFarming = () => {
      if (!alive()) return;
      const state = farming.status();
      const field = state.fieldOptions.find((item) => item.id === state.selectedFieldId);
      const seed = state.seedOptions.find((item) => item.id === state.selectedSeedId);
      const crop = state.harvestableOptions.find((item) => item.id === state.selectedCropId);
      const free = state.fieldOptions.filter((item) => item.enabled).length;
      ui.farming.field.string = `地块：${field ? names[field.definition_id] ?? '已选地块' : '请选择'} ｜ 空闲${free}/${state.fieldOptions.length}，占用${state.fieldOptions.length - free}`;
      ui.farming.seed.string = seed
        ? `种子：${names[seed.base_id] ?? '种子批次'} ｜ 剩余${seed.quantity.amount}${displayUnit(seed.quantity.unit)}`
        : '种子：请选择种子批次';
      ui.farming.crop.string = state.harvestableOptions.length === 0 ? '暂无可收获作物'
        : `可收获${state.harvestableOptions.length}株 ｜ ${crop ? names[crop.crop_base_id] ?? '已选作物' : '请选择作物'}`;
      ui.farming.amount.string = `${state.seedAmount}${seed ? displayUnit(seed.quantity.unit) : '粒'}`;
      ui.farming.inventory.string = state.materialOptions.length === 0 ? '暂无库存'
        : '库存末3批：' + state.materialOptions.slice(-3).map((item) => `${names[item.base_id] ?? '物料'} ${item.quantity.amount}${displayUnit(item.quantity.unit)}`).join(' / ');
      updateButtons();
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
      createHost: (input) => {
        names = presentationNames(input);
        return createStage1AHost({ ...input, storage: new BrowserSaveStoragePort(), nowIso8601: new Date().toISOString() });
      },
      createBinding: (host) => new QinglanUiSceneProbeComponent(host, {
        applyNodeBindingPatch: (patch) => {
          if (lifetime.isDisposed() || !alive()) return;
          if (patch.section === 'menu') {
            const menu = patch.payload as ProbeMenuSnapshot;
            if (menu.view_model?.time_label) ui.time.string = menu.view_model.time_label;
            farming.refresh(menu);
            renderFarming();
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
    ui.controls.AdvanceOneHour.node.on(Button.EventType.CLICK, () => executeButton(ADVANCE_COMMAND));
    ui.controls.AdvanceOneDay.node.on(Button.EventType.CLICK, () => executeButton({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 1440 } }));
    ui.controls.SaveLocal.node.on(Button.EventType.CLICK, () => executeButton({ name: 'save', selection: { slot_id: BROWSER_SAVE_SLOT_ID } }));
    ui.controls.LoadLocal.node.on(Button.EventType.CLICK, () => executeButton({ name: 'load', selection: { slot_id: BROWSER_SAVE_SLOT_ID } }));
    const localSelection = (name: string, change: () => void) => ui.controls[name].node.on(Button.EventType.CLICK, () => {
      if (commands.status().busy || !alive() || lifetime.status().phase !== 'ready' || lifetime.isDisposed()) return;
      change();
      renderFarming();
    });
    localSelection('SelectField', () => farming.selectNextField());
    localSelection('SelectSeed', () => farming.selectNextSeed());
    localSelection('SelectCrop', () => farming.selectNextCrop());
    localSelection('SeedAmountDecrease', () => farming.adjustSeedAmount(-1));
    localSelection('SeedAmountIncrease', () => farming.adjustSeedAmount(1));
    ui.controls.PlantCrop.node.on(Button.EventType.CLICK, () => {
      const command = farming.plantCommand();
      if (command) executeButton(command);
    });
    ui.controls.HarvestCrop.node.on(Button.EventType.CLICK, () => {
      const command = farming.harvestCommand();
      if (command) executeButton(command);
    });

    const executeRequired = async (command: ProbeCommand) => {
      const result = await commands.execute(command);
      if (!result) throw new Error('ERR_COCOS_PROBE_NOT_READY');
      if (commands.status().operation.status !== 'completed') {
        throw new Error(result.command_result.error_message ?? 'ERR_COCOS_PROBE_COMMAND_FAILED');
      }
    };
    const observer = Object.freeze({
      status: () => ({
        ...lifetime.status(), ...commands.status(),
        displayedTime: alive() && isValid(ui.time, true) ? ui.time.string : null,
        displayedOperation: alive() && isValid(ui.operation, true) ? ui.operation.string : null,
        farming: farming.status(),
        displayedFarming: alive() ? {
          field: ui.farming.field.string, seed: ui.farming.seed.string, crop: ui.farming.crop.string,
          inventory: ui.farming.inventory.string, amount: ui.farming.amount.string
        } : null,
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

    this.makeLabel(canvasNode, 'Title', '青岚 · 种植与收获', 286, 28);
    const time = this.makeLabel(canvasNode, 'Time', '等待启动', 245, 25);
    const farming = {
      field: this.makeLabel(canvasNode, 'FieldSummary', '地块：等待启动', 205, 19),
      seed: this.makeLabel(canvasNode, 'SeedSummary', '种子：等待启动', 172, 19),
      crop: this.makeLabel(canvasNode, 'CropSummary', '暂无可收获作物', 139, 19),
      inventory: this.makeLabel(canvasNode, 'InventorySummary', '等待库存', 106, 17),
      amount: this.makeLabel(canvasNode, 'SeedAmount', '1粒', -9, 21)
    };
    farming.amount.node.setPosition(-140, -9, 0);
    farming.amount.node.getComponent(UITransform)!.setContentSize(110, 44);
    const controls: Record<string, Button> = {
      AdvanceOneHour: this.makeButton(canvasNode, 'AdvanceOneHour', '推进一小时', -155, -74),
      SaveLocal: this.makeButton(canvasNode, 'SaveLocal', '本地保存', -155, -139),
      LoadLocal: this.makeButton(canvasNode, 'LoadLocal', '读取本地存档', 155, -139),
      SelectField: this.makeButton(canvasNode, 'SelectField', '选择地块', -300, 51, 260),
      SelectSeed: this.makeButton(canvasNode, 'SelectSeed', '选择种子', 0, 51, 260),
      SelectCrop: this.makeButton(canvasNode, 'SelectCrop', '选择收获作物', 300, 51, 260),
      SeedAmountDecrease: this.makeButton(canvasNode, 'SeedAmountDecrease', '−', -370, -9, 90),
      SeedAmountIncrease: this.makeButton(canvasNode, 'SeedAmountIncrease', '＋', -260, -9, 90),
      PlantCrop: this.makeButton(canvasNode, 'PlantCrop', '播种', 55, -9, 220),
      AdvanceOneDay: this.makeButton(canvasNode, 'AdvanceOneDay', '推进一天', 155, -74),
      HarvestCrop: this.makeButton(canvasNode, 'HarvestCrop', '收获', 310, -9, 230)
    };
    const buttons = Object.values(controls);
    const phase = this.makeLabel(canvasNode, 'Status', '准备启动', -193, 17);
    const operation = this.makeLabel(canvasNode, 'Operation', '请选择地块和种子后播种', -230, 19);
    this.makeLabel(canvasNode, 'LocalSaveHint', '本浏览器本地存档，刷新后可手动读取', -275, 16);
    return { root: this.node, time, phase, operation, buttons, controls, farming };
  }

  private makeButton(parent: Node, name: string, text: string, x: number, y: number, width = 280): Button {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(width, 52);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(62, 118, 125, 255);
    graphics.roundRect(-width / 2, -26, width, 52, 10);
    graphics.fill();
    const button = node.addComponent(Button);
    button.transition = Button.Transition.NONE;
    button.interactable = false;
    const caption = this.makeLabel(node, 'Caption', text, 0, 21);
    caption.node.getComponent(UITransform)!.setContentSize(width - 10, 50);
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
