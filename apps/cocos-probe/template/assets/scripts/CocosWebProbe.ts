import {
  _decorator, Button, Camera, Canvas, Color, Component, EditBox, Graphics, isValid,
  JsonAsset, Label, Layers, Node, profiler, resources, ResolutionPolicy, UITransform, view
} from 'cc';
import { createStage1AHost, QinglanUiSceneProbeComponent } from '../generated/probe-runtime.js';
import { ProbeLifetime, type ProbeCommand, type ProbeMenuSnapshot, type ProbePhase, type ProbeResources } from './ProbeLifetime';
import { ProbeInteraction } from './ProbeInteraction';
import { ProbeFarming } from './ProbeFarming';
import { ProbeInventory } from './ProbeInventory';
import { BrowserSaveStoragePort, BROWSER_SAVE_SLOT_ID } from './BrowserSaveStoragePort';

const { ccclass } = _decorator;
const ADVANCE_COMMAND = { name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } } as const;

interface ProbeView {
  readonly root: Node;
  readonly title: Label;
  readonly time: Label;
  readonly phase: Label;
  readonly operation: Label;
  readonly buttons: readonly Button[];
  readonly controls: Record<string, Button>;
  readonly farming: { field: Label; seed: Label; crop: Label; inventory: Label; amount: Label };
  readonly panels: { farming: Node; inventory: Node };
  readonly inventory: { lot: Label; form: Label; quantity: Label; location: Label; target: Label; capacity: Label; hint: Label };
  readonly split: { input: EditBox; unit: Label; selection: Label; preview: Label; result: Label };
}

// Display names come from the same prepared formal resources; they never select an action target.
function presentationNames(resources: ProbeResources): Record<string, string> {
  const documents = (resources.snapshot as { loaded_documents?: Record<string, unknown> }).loaded_documents ?? {};
  const text = documents['configs/text/zh_cn.yaml'] as Record<string, unknown> | undefined;
  const names: Record<string, string> = {};
  for (const value of Object.values(documents)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const doc = value as { id?: unknown; display_name_key?: unknown; forms?: Record<string, { display_name_key?: string }>; field_plot_definitions?: Record<string, { display_name_key?: string }> };
    if (typeof doc.id === 'string' && typeof doc.display_name_key === 'string' && typeof text?.[doc.display_name_key] === 'string') {
      names[doc.id] = text[doc.display_name_key] as string;
    }
    for (const [id, field] of Object.entries(doc.field_plot_definitions ?? {})) {
      if (field.display_name_key && typeof text?.[field.display_name_key] === 'string') names[id] = text[field.display_name_key] as string;
    }
    if (typeof doc.id === 'string') for (const [form, definition] of Object.entries(doc.forms ?? {})) {
      if (definition.display_name_key && typeof text?.[definition.display_name_key] === 'string') {
        names[`${doc.id}:${form}`] = text[definition.display_name_key] as string;
      }
    }
  }
  return names;
}

const DISPLAY_UNITS: Record<string, string> = { count: '粒', g: '克', ml: '毫升' };
const displayUnit = (unit: string) => DISPLAY_UNITS[unit] ?? unit;
const STORAGE_LABELS: Record<string, string> = { room_temp: '常温储存', cellar: '菜窖', pickling_jar: '腌菜缸' };

function splitRejection(code: string): string {
  if (code === 'ERR_NOT_ENOUGH_RESOURCE') return '数量超过当前库存';
  if (code === 'ERR_SPLIT_QUANTITY_INVALID') return '数量不符合单位要求';
  if (code === 'ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE') return '请调整拆分数量';
  if (code.startsWith('ERR_STORAGE_CAPACITY_OVERFLOW')) return '当前储存空间不足';
  if (code.startsWith('ERR_MENU_OPTION_')) return '请重新选择批次';
  return '请调整选择或数量';
}

@ccclass('CocosWebProbe')
export class CocosWebProbe extends Component {
  private lifetime: ProbeLifetime | null = null;
  private assetOwner: { asset: JsonAsset | null } | null = null;

  onLoad(): void {
    profiler.hideStats();
    const ui = this.createView();
    const errors: string[] = [];
    const owner = { asset: null as JsonAsset | null };
    this.assetOwner = owner;
    let interaction: ProbeInteraction | null = null;
    const farming = new ProbeFarming();
    const inventory = new ProbeInventory();
    let panel: 'farming' | 'inventory' = 'farming';
    let names: Record<string, string> = {};
    const alive = () => isValid(ui.root, true);
    const updateButtons = () => {
      if (!alive()) return;
      const enabled = lifetime.status().phase === 'ready' && !lifetime.isDisposed() && !interaction?.status().busy;
      const setEnabled = (name: string, value: boolean) => this.paintButton(ui.controls[name], value);
      for (const button of ui.buttons) if (isValid(button, true)) this.paintButton(button, enabled);
      const state = farming.status();
      const farmEnabled = enabled && panel === 'farming';
      setEnabled('SelectField', farmEnabled && state.fieldOptions.some((option) => option.enabled));
      setEnabled('SelectSeed', farmEnabled && state.seedOptions.some((option) => option.enabled));
      setEnabled('SelectCrop', farmEnabled && state.harvestableOptions.some((option) => option.enabled));
      setEnabled('SeedAmountDecrease', farmEnabled && state.selectedSeedId !== null && state.seedAmount > 1);
      setEnabled('SeedAmountIncrease', farmEnabled && state.selectedSeedId !== null);
      setEnabled('PlantCrop', farmEnabled && state.canPlant);
      setEnabled('HarvestCrop', farmEnabled && state.canHarvest);
      const stock = inventory.status();
      setEnabled('SelectInventoryLot', enabled && panel === 'inventory' && stock.lotOptions.length > 0);
      setEnabled('SelectStorageTarget', enabled && panel === 'inventory' && stock.targetOptions.length > 0);
      setEnabled('MoveInventoryLot', enabled && panel === 'inventory' && stock.canMove);
      setEnabled('SplitPreview', enabled && panel === 'inventory' && stock.canPreviewSplit);
      setEnabled('SplitConfirm', enabled && panel === 'inventory' && stock.canConfirmSplit);
      const splitInputEnabled = enabled && panel === 'inventory' && stock.lotOptions.some((lot) => lot.id === stock.selectedLotId && lot.enabled);
      if (ui.split.input.enabled !== splitInputEnabled) ui.split.input.enabled = splitInputEnabled;
      setEnabled('OpenFarming', enabled && panel !== 'farming');
      setEnabled('OpenInventory', enabled && panel !== 'inventory');
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
    const renderInventory = () => {
      if (!alive()) return;
      const stock = inventory.status();
      const index = stock.lotOptions.findIndex((item) => item.id === stock.selectedLotId);
      const lot = stock.lotOptions[index];
      const target = stock.targetOptions.find((item) => item.id === stock.selectedTargetId);
      const locationName = (id: string) => {
        const place = stock.targetOptions.find((item) => item.id === id);
        return place ? STORAGE_LABELS[place.storage_type] ?? `储存点${stock.targetOptions.indexOf(place) + 1}` : '未知储存位置';
      };
      ui.inventory.lot.string = lot ? `材料批次${index + 1}/${stock.lotOptions.length}：${names[lot.base_id] ?? '物料'}` : `请选择材料批次（共${stock.lotOptions.length}批）`;
      ui.inventory.form.string = lot ? `形态：${names[`${lot.base_id}:${lot.current_form}`] ?? lot.current_form}` : '形态：—';
      ui.inventory.quantity.string = lot ? `数量：${lot.quantity.amount}${displayUnit(lot.quantity.unit)}` : '数量：—';
      ui.inventory.location.string = lot ? `当前位置：${locationName(lot.storage_ref.container_id)}` : '当前位置：—';
      ui.inventory.target.string = target ? `目标位置：${locationName(target.id)}` : '目标位置：请选择';
      ui.inventory.capacity.string = target ? `目标容量占用：${target.used_capacity}/${target.capacity.amount}` : '目标容量占用：—';
      ui.inventory.hint.string = !lot || !target ? '先选择材料批次和目标位置'
        : lot.storage_ref.container_id === target.id ? '材料已在这个位置'
        : !lot.enabled ? '这批材料暂不可移动'
        : !target.enabled ? '目标当前不可用'
        : '移动整批材料，数量保持不变';
      if (ui.split.input.string !== stock.splitQuantityText) ui.split.input.string = stock.splitQuantityText;
      ui.split.unit.string = stock.splitUnit ? displayUnit(stock.splitUnit) : '—';
      ui.split.selection.string = !lot ? '请选择要拆分的材料批次'
        : !lot.enabled ? '这批材料当前不可拆分'
        : stock.splitInputError ?? `本次选择：${stock.splitQuantityText}${displayUnit(stock.splitUnit!)}`;
      ui.split.preview.string = stock.splitPreview === null ? '填写数量后先预览，再确认'
        : stock.splitPreview.success ? '校验通过，尚未执行'
        : `本次校验未通过：${splitRejection(stock.splitPreview.statusCode)}`;
      const splitResult = stock.splitResult;
      const resultIndex = splitResult === null ? -1 : stock.lotOptions.findIndex((item) => item.id === splitResult.newLotId);
      ui.split.result.string = splitResult === null ? ''
        : `${resultIndex < 0 ? '新增批次' : `新增第${resultIndex + 1}批`}：${splitResult.quantity.amount}${displayUnit(splitResult.quantity.unit)} · `
          + (splitResult.remainingQuantity === null ? '来源已全部拆出'
            : `来源剩余${splitResult.remainingQuantity.amount}${displayUnit(splitResult.remainingQuantity.unit)}`);
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
            inventory.refresh(menu);
            renderFarming();
            renderInventory();
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
        renderInventory();
      }
    });
    // Capture the stable coordinator and view. Creator may clear Component fields on destruction.
    const commands = interaction;
    const executeButton = (command: ProbeCommand) => {
      if (commands.status().busy || !alive() || lifetime.status().phase !== 'ready' || lifetime.isDisposed()) return;
      const splitCommand = (command.name === 'menu_preview' || command.name === 'menu_confirm') && command.selection.action_type === 'split_lot';
      if (!splitCommand) inventory.invalidateSplitPreview();
      void commands.execute(command).then((result) => {
        if (!result || !alive() || lifetime.isDisposed()) return;
        inventory.acceptSplitResult(command, result);
        renderInventory();
      }).catch((error) => {
        // A view-application failure may follow a committed action. Require a fresh
        // player preview instead of leaving the former confirmation enabled.
        inventory.invalidateSplitPreview();
        renderInventory();
        unexpected(error);
      });
    };
    ui.controls.AdvanceOneHour.node.on(Button.EventType.CLICK, () => executeButton(ADVANCE_COMMAND));
    ui.controls.AdvanceOneDay.node.on(Button.EventType.CLICK, () => executeButton({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 1440 } }));
    ui.controls.SaveLocal.node.on(Button.EventType.CLICK, () => executeButton({ name: 'save', selection: { slot_id: BROWSER_SAVE_SLOT_ID } }));
    ui.controls.LoadLocal.node.on(Button.EventType.CLICK, () => executeButton({ name: 'load', selection: { slot_id: BROWSER_SAVE_SLOT_ID } }));
    const localSelection = (name: string, change: () => void) => ui.controls[name].node.on(Button.EventType.CLICK, () => {
      if (commands.status().busy || !alive() || lifetime.status().phase !== 'ready' || lifetime.isDisposed()) return;
      inventory.invalidateSplitPreview();
      change();
      renderFarming();
      renderInventory();
    });
    localSelection('SelectField', () => farming.selectNextField());
    localSelection('SelectSeed', () => farming.selectNextSeed());
    localSelection('SelectCrop', () => farming.selectNextCrop());
    localSelection('SeedAmountDecrease', () => farming.adjustSeedAmount(-1));
    localSelection('SeedAmountIncrease', () => farming.adjustSeedAmount(1));
    const switchPanel = (next: 'farming' | 'inventory') => {
      inventory.invalidateSplitPreview();
      ui.split.input.blur();
      panel = next;
      ui.panels.farming.active = next === 'farming';
      ui.panels.inventory.active = next === 'inventory';
      ui.title.string = next === 'farming' ? '青岚 · 种植与收获' : '青岚 · 库存与储存';
    };
    localSelection('OpenFarming', () => switchPanel('farming'));
    localSelection('OpenInventory', () => switchPanel('inventory'));
    localSelection('SelectInventoryLot', () => inventory.selectNextLot());
    localSelection('SelectStorageTarget', () => inventory.selectNextTarget());
    ui.split.input.node.on(EditBox.EventType.TEXT_CHANGED, () => {
      if (commands.status().busy || !alive() || panel !== 'inventory' || lifetime.status().phase !== 'ready' || lifetime.isDisposed()) return;
      inventory.setSplitQuantity(ui.split.input.string);
      renderInventory();
    });
    ui.controls.SplitPreview.node.on(Button.EventType.CLICK, () => {
      const command = inventory.splitPreviewCommand();
      if (command) executeButton(command);
    });
    ui.controls.SplitConfirm.node.on(Button.EventType.CLICK, () => {
      const command = inventory.splitConfirmCommand();
      if (command) executeButton(command);
    });
    ui.controls.MoveInventoryLot.node.on(Button.EventType.CLICK, () => {
      const command = inventory.moveCommand();
      if (command) executeButton(command);
    });
    ui.controls.PlantCrop.node.on(Button.EventType.CLICK, () => {
      const command = farming.plantCommand();
      if (command) executeButton(command);
    });
    ui.controls.HarvestCrop.node.on(Button.EventType.CLICK, () => {
      const command = farming.harvestCommand();
      if (command) executeButton(command);
    });

    const observer = Object.freeze({
      status: () => ({
        ...lifetime.status(), ...commands.status(),
        displayedTime: alive() && isValid(ui.time, true) ? ui.time.string : null,
        displayedOperation: alive() && isValid(ui.operation, true) ? ui.operation.string : null,
        farming: farming.status(),
        panel,
        inventory: inventory.status(),
        displayedInventory: alive() ? {
          lot: ui.inventory.lot.string, form: ui.inventory.form.string, quantity: ui.inventory.quantity.string,
          location: ui.inventory.location.string, target: ui.inventory.target.string,
          capacity: ui.inventory.capacity.string, hint: ui.inventory.hint.string
        } : null,
        displayedSplit: alive() ? {
          quantityText: ui.split.input.string, unit: ui.split.unit.string,
          selection: ui.split.selection.string, preview: ui.split.preview.string, result: ui.split.result.string
        } : null,
        displayedFarming: alive() ? {
          field: ui.farming.field.string, seed: ui.farming.seed.string, crop: ui.farming.crop.string,
          inventory: ui.farming.inventory.string, amount: ui.farming.amount.string
        } : null,
        nodeValid: alive(), errors: [...errors]
      }),
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

    const title = this.makeLabel(canvasNode, 'Title', '青岚 · 种植与收获', 286, 28);
    const time = this.makeLabel(canvasNode, 'Time', '等待启动', 195, 23);
    const panels = { farming: this.makePanel(canvasNode, 'FarmingPanel'), inventory: this.makePanel(canvasNode, 'InventoryPanel') };
    panels.inventory.active = false;
    const farming = {
      field: this.makeLabel(panels.farming, 'FieldSummary', '地块：等待启动', 155, 18),
      seed: this.makeLabel(panels.farming, 'SeedSummary', '种子：等待启动', 125, 18),
      crop: this.makeLabel(panels.farming, 'CropSummary', '暂无可收获作物', 95, 18),
      inventory: this.makeLabel(panels.farming, 'InventorySummary', '等待库存', 65, 17),
      amount: this.makeLabel(panels.farming, 'SeedAmount', '1粒', -44, 21)
    };
    farming.amount.node.setPosition(-140, -44, 0);
    farming.amount.node.getComponent(UITransform)!.setContentSize(110, 44);
    const inventory = {
      lot: this.makeLabel(panels.inventory, 'InventoryLot', '请选择材料批次', 160, 20),
      form: this.makeSectionLabel(panels.inventory, 'InventoryForm', '形态：—', -235, 130, 410, 18),
      quantity: this.makeSectionLabel(panels.inventory, 'InventoryQuantity', '数量：—', -235, 104, 410, 19),
      location: this.makeSectionLabel(panels.inventory, 'InventoryLocation', '当前位置：—', -235, 78, 410, 18),
      target: this.makeSectionLabel(panels.inventory, 'InventoryTarget', '目标位置：请选择', -235, 7, 410, 18),
      capacity: this.makeSectionLabel(panels.inventory, 'InventoryCapacity', '目标容量占用：—', -235, -17, 410, 17),
      hint: this.makeSectionLabel(panels.inventory, 'InventoryHint', '先选择材料批次和目标位置', -235, -39, 410, 15)
    };
    this.makeSectionLabel(panels.inventory, 'SplitHeading', '拆分当前批次', 235, 128, 410, 20);
    const split = {
      input: this.makeQuantityInput(panels.inventory, 190, 88),
      unit: this.makeSectionLabel(panels.inventory, 'SplitUnit', '—', 380, 88, 100, 20),
      selection: this.makeSectionLabel(panels.inventory, 'SplitSelection', '请选择要拆分的材料批次', 235, 48, 410, 17),
      preview: this.makeSectionLabel(panels.inventory, 'SplitPreviewSummary', '填写数量后先预览，再确认', 235, 16, 410, 17),
      result: this.makeSectionLabel(panels.inventory, 'SplitResult', '', 235, -76, 430, 16)
    };
    const controls: Record<string, Button> = {
      OpenFarming: this.makeButton(canvasNode, 'OpenFarming', '种植收获', -155, 239),
      OpenInventory: this.makeButton(canvasNode, 'OpenInventory', '库存储存', 155, 239),
      AdvanceOneHour: this.makeButton(canvasNode, 'AdvanceOneHour', '推进一小时', -155, -120),
      SaveLocal: this.makeButton(canvasNode, 'SaveLocal', '本地保存', -155, -179),
      LoadLocal: this.makeButton(canvasNode, 'LoadLocal', '读取本地存档', 155, -179),
      SelectField: this.makeButton(panels.farming, 'SelectField', '选择地块', -300, 20, 260),
      SelectSeed: this.makeButton(panels.farming, 'SelectSeed', '选择种子', 0, 20, 260),
      SelectCrop: this.makeButton(panels.farming, 'SelectCrop', '选择收获作物', 300, 20, 260),
      SeedAmountDecrease: this.makeButton(panels.farming, 'SeedAmountDecrease', '−', -370, -44, 90),
      SeedAmountIncrease: this.makeButton(panels.farming, 'SeedAmountIncrease', '＋', -260, -44, 90),
      PlantCrop: this.makeButton(panels.farming, 'PlantCrop', '播种', 55, -44, 220),
      AdvanceOneDay: this.makeButton(canvasNode, 'AdvanceOneDay', '推进一天', 155, -120),
      HarvestCrop: this.makeButton(panels.farming, 'HarvestCrop', '收获', 310, -44, 230),
      SelectInventoryLot: this.makeButton(panels.inventory, 'SelectInventoryLot', '下一批材料', -235, 43, 390),
      SelectStorageTarget: this.makeButton(panels.inventory, 'SelectStorageTarget', '选择目标位置', -345, -74, 190),
      MoveInventoryLot: this.makeButton(panels.inventory, 'MoveInventoryLot', '移动整批', -125, -74, 190),
      SplitPreview: this.makeButton(panels.inventory, 'SplitPreview', '预览拆分', 125, -28, 200),
      SplitConfirm: this.makeButton(panels.inventory, 'SplitConfirm', '确认拆分', 345, -28, 200)
    };
    const buttons = Object.values(controls);
    const phase = this.makeLabel(canvasNode, 'Status', '准备启动', -225, 16);
    const operation = this.makeLabel(canvasNode, 'Operation', '请选择地块和种子后播种', -260, 18);
    this.makeLabel(canvasNode, 'LocalSaveHint', '本浏览器本地存档，刷新后可手动读取', -299, 15);
    return { root: this.node, title, time, phase, operation, buttons, controls, farming, inventory, panels, split };
  }

  private makePanel(parent: Node, name: string): Node {
    const panel = new Node(name);
    panel.layer = Layers.Enum.UI_2D;
    parent.addChild(panel);
    panel.addComponent(UITransform).setContentSize(960, 640);
    return panel;
  }

  private paintButton(button: Button, enabled: boolean): void {
    button.interactable = enabled;
    const transform = button.node.getComponent(UITransform)!;
    const graphics = button.node.getComponent(Graphics)!;
    graphics.clear();
    graphics.fillColor = enabled ? new Color(62, 118, 125, 255) : new Color(44, 59, 70, 255);
    graphics.roundRect(-transform.width / 2, -transform.height / 2, transform.width, transform.height, 10);
    graphics.fill();
    const caption = button.node.getChildByName('Caption')?.getComponent(Label);
    if (caption) caption.color = enabled ? new Color(236, 239, 234, 255) : new Color(151, 164, 170, 255);
  }

  private makeButton(parent: Node, name: string, text: string, x: number, y: number, width = 280): Button {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(width, 46);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(62, 118, 125, 255);
    graphics.roundRect(-width / 2, -23, width, 46, 10);
    graphics.fill();
    const button = node.addComponent(Button);
    button.transition = Button.Transition.NONE;
    button.interactable = false;
    const caption = this.makeLabel(node, 'Caption', text, 0, 20);
    caption.node.getComponent(UITransform)!.setContentSize(width - 10, 44);
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

  private makeSectionLabel(parent: Node, name: string, text: string, x: number, y: number, width: number, fontSize: number): Label {
    const label = this.makeLabel(parent, name, text, y, fontSize);
    label.node.setPosition(x, y, 0);
    label.node.getComponent(UITransform)!.setContentSize(width, fontSize + 10);
    label.overflow = Label.Overflow.CLAMP;
    label.enableWrapText = false;
    return label;
  }

  private makeQuantityInput(parent: Node, x: number, y: number): EditBox {
    const node = new Node('SplitQuantity');
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(270, 44);
    const background = new Node('Background');
    background.layer = Layers.Enum.UI_2D;
    node.addChild(background);
    background.addComponent(UITransform).setContentSize(270, 44);
    const graphics = background.addComponent(Graphics);
    graphics.fillColor = new Color(40, 57, 70, 255);
    graphics.roundRect(-135, -22, 270, 44, 6);
    graphics.fill();
    const text = this.makeSectionLabel(node, 'Text', '', 0, 0, 250, 20);
    const placeholder = this.makeSectionLabel(node, 'Placeholder', '输入拆分数量', 0, 0, 250, 18);
    placeholder.color = new Color(151, 164, 170, 255);
    const input = node.addComponent(EditBox);
    input.textLabel = text;
    input.placeholderLabel = placeholder;
    input.inputMode = EditBox.InputMode.SINGLE_LINE;
    input.inputFlag = EditBox.InputFlag.DEFAULT;
    input.maxLength = -1;
    input.enabled = false;
    return input;
  }
}
