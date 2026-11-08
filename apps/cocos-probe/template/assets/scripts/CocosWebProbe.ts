import {
  _decorator, Button, Camera, Canvas, Color, Component, director, EditBox, Graphics, isValid,
  JsonAsset, Label, Layers, Mask, Node, profiler, resources, ResolutionPolicy, screen, ScrollView, UITransform, Vec2, view
} from 'cc';
import { createStage1AHost, QinglanUiSceneProbeComponent } from '../generated/probe-runtime.js';
import { ProbeLifetime, type ProbeCommand, type ProbeMenuSnapshot, type ProbePhase, type ProbeResources } from './ProbeLifetime';
import { ProbeInteraction } from './ProbeInteraction';
import { ProbeFarming } from './ProbeFarming';
import { ProbeInventory } from './ProbeInventory';
import { ProbeProcessing } from './ProbeProcessing';
import { ProbeCooking } from './ProbeCooking';
import { ProbeOrders } from './ProbeOrders';
import { BrowserSaveStoragePort, BROWSER_SAVE_SLOT_ID } from './BrowserSaveStoragePort';
import { createProbeLayout, type ProbeLayoutPlan, type ProbeLayoutRect, type ProbePanelName } from './ProbeLayout';

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
  readonly farming: { field: Label; seed: Label; crop: Label; inventory: Label; amount: Label; planting: Label };
  readonly panels: { farming: Node; inventory: Node; processing: Node; cooking: Node; orders: Node };
  readonly orders: { order: Label; state: Label; deadline: Label; quantity: Label; demand: Label; history: Label; dish: Label; detail: Label; money: Label; reputation: Label; preview: Label; result: Label };
  readonly inventory: { lot: Label; form: Label; quantity: Label; location: Label; target: Label; capacity: Label; hint: Label };
  readonly split: { input: EditBox; unit: Label; selection: Label; preview: Label; result: Label };
  readonly processing: { input: EditBox; method: Label; facility: Label; requirement: Label; lot: Label; unit: Label; selection: Label; preview: Label; task: Label; result: Label };
  readonly cooking: { input: EditBox; minutes: EditBox; recipe: Label; role: Label; lot: Label; unit: Label; selection: Label;
    operation: Label; target: Label; fuel: Label; preview: Label; result: Label; dishes: Label };
  readonly layout: ProbeLayoutView;
}

interface ProbeLayoutView {
  status(): {
    mode: 'desktop' | 'compact';
    frame: { width: number; height: number };
    design: { width: number; height: number };
    viewport: ProbeLayoutRect;
    contentHeight: number;
    scrollOffset: { x: number; y: number };
    maxScrollOffset: { x: number; y: number };
  };
  selectPanel(panel: ProbePanelName): void;
  dispose(): void;
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

const DISPLAY_UNITS: Record<string, string> = { count: '粒', g: '克', ml: '毫升', bundle: '捆', serving: '份' };
const displayUnit = (unit: string) => DISPLAY_UNITS[unit] ?? unit;
const STORAGE_LABELS: Record<string, string> = { room_temp: '常温储存', cellar: '菜窖', pickling_jar: '腌菜缸' };
const TOOL_LABELS: Record<string, string> = { knife_basic: '基础刀具' };
const FORM_LABELS: Record<string, string> = { fresh: '鲜材', cut: '切好' };
const HEAT_LABELS: Record<string, string> = { low: '小火', medium: '中火', high: '大火' };
const ROLE_LABELS: Record<string, string> = { main: '主料', side: '配料', oil: '油', aromatic: '辛香料' };

function splitRejection(code: string): string {
  if (code === 'ERR_NOT_ENOUGH_RESOURCE') return '数量超过当前库存';
  if (code === 'ERR_SPLIT_QUANTITY_INVALID') return '数量不符合单位要求';
  if (code === 'ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE') return '请调整拆分数量';
  if (code.startsWith('ERR_STORAGE_CAPACITY_OVERFLOW')) return '当前储存空间不足';
  if (code.startsWith('ERR_MENU_OPTION_')) return '请重新选择批次';
  return '请调整选择或数量';
}

function processingRejection(code: string): string {
  if (code === 'ERR_PROCESSING_INPUT_MISSING') return '所需材料缺失或数量不足';
  if (code === 'ERR_NOT_ENOUGH_RESOURCE') return '数量超过当前库存';
  if (code === 'ERR_INVALID_LOT_STATE') return '材料状态不适合加工';
  if (code.startsWith('ERR_STORAGE_CAPACITY_OVERFLOW')) return '储存空间不足';
  return '请调整材料或设施';
}

@ccclass('CocosWebProbe')
export class CocosWebProbe extends Component {
  private lifetime: ProbeLifetime | null = null;
  private assetOwner: { asset: JsonAsset | null } | null = null;
  private layoutCleanup: (() => void) | null = null;

  onLoad(): void {
    profiler.hideStats();
    const ui = this.createView();
    const errors: string[] = [];
    const owner = { asset: null as JsonAsset | null };
    this.assetOwner = owner;
    let interaction: ProbeInteraction | null = null;
    const farming = new ProbeFarming();
    const inventory = new ProbeInventory();
    const processing = new ProbeProcessing();
    const cooking = new ProbeCooking();
    const orders = new ProbeOrders();
    let panel: 'farming' | 'inventory' | 'processing' | 'cooking' | 'orders' = 'farming';
    let names: Record<string, string> = {};
    const alive = () => isValid(ui.root, true);
    const editInputs = [ui.split.input, ui.processing.input, ui.cooking.input, ui.cooking.minutes];
    const updateTabOrder = () => this.updateEditTabOrder(editInputs, ui.layout.status().mode === 'compact');
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
      setEnabled('SeedAmountDecrease', farmEnabled && state.selectedSeedId !== null && state.plantingTiles > 1);
      setEnabled('SeedAmountIncrease', farmEnabled && state.selectedSeedId !== null);
      setEnabled('SeedsPerTile', farmEnabled && state.selectedSeedId !== null);
      setEnabled('PlantCrop', farmEnabled && state.canPlant);
      setEnabled('HarvestCrop', farmEnabled && state.canHarvest);
      const stock = inventory.status();
      if (stock.splitNeedsReview) {
        for (const name of ['SaveLocal', 'LoadLocal', 'AdvanceOneHour', 'AdvanceOneDay', 'PlantCrop', 'HarvestCrop']) setEnabled(name, false);
      }
      setEnabled('SelectInventoryLot', enabled && panel === 'inventory' && stock.lotOptions.length > 0);
      setEnabled('SelectStorageTarget', enabled && panel === 'inventory' && stock.targetOptions.length > 0);
      setEnabled('MoveInventoryLot', enabled && !stock.splitNeedsReview && panel === 'inventory' && stock.canMove);
      setEnabled('SplitPreview', enabled && panel === 'inventory' && stock.canPreviewSplit);
      setEnabled('SplitConfirm', enabled && panel === 'inventory' && stock.canConfirmSplit);
      const splitPreviewCaption = ui.controls.SplitPreview.node.children.find(child => child.name === 'Caption')?.getComponent(Label);
      if (splitPreviewCaption) splitPreviewCaption.string = stock.splitNeedsReview ? '核对库存' : '预览拆分';
      const splitInputEnabled = enabled && panel === 'inventory' && !stock.splitNeedsReview && stock.lotOptions.some((lot) => lot.id === stock.selectedLotId && lot.enabled);
      if (ui.split.input.enabled !== splitInputEnabled) ui.split.input.enabled = splitInputEnabled;
      setEnabled('OpenFarming', enabled && panel !== 'farming');
      setEnabled('OpenInventory', enabled && panel !== 'inventory');
      setEnabled('OpenProcessing', enabled && panel !== 'processing');
      setEnabled('OpenCooking', enabled && panel !== 'cooking');
      setEnabled('OpenOrders', enabled && panel !== 'orders');
      const orderView = orders.status();
      setEnabled('SelectOrder', enabled && panel === 'orders' && orderView.orderOptions.length > 0);
      setEnabled('SelectOrderDish', enabled && panel === 'orders' && orderView.dishOptions.some(item => item.enabled));
      setEnabled('OrderPreview', enabled && panel === 'orders' && orderView.canPreview);
      setEnabled('SubmitOrder', enabled && !stock.splitNeedsReview && panel === 'orders' && orderView.canSubmit);
      const process = processing.status();
      const method = process.methodOptions.find((item) => item.id === process.selectedMethodId);
      const processEnabled = enabled && panel === 'processing';
      setEnabled('SelectProcessingMethod', processEnabled && process.methodOptions.some((item) => item.enabled));
      setEnabled('SelectProcessingInput', processEnabled && (method?.input_requirements.length ?? 0) > 0);
      setEnabled('SelectProcessingLot', processEnabled && process.currentInputLotOptions.some((item) => item.enabled));
      setEnabled('SelectProcessingFacility', processEnabled && process.facilityOptions.some((item) => item.enabled && method?.compatible_facility_ids.includes(item.id)));
      setEnabled('ProcessingPreview', processEnabled && process.canPreview);
      setEnabled('StartProcessing', processEnabled && !stock.splitNeedsReview && process.canStart);
      setEnabled('SelectProcessingTask', processEnabled && process.taskOptions.length > 0);
      setEnabled('CollectProcessing', processEnabled && !stock.splitNeedsReview && process.canCollect);
      const currentInput = process.inputSelections.find((item) => item.requirementIndex === process.selectedRequirementIndex);
      const processInputEnabled = processEnabled && process.currentInputLotOptions.some((item) => item.id === currentInput?.lotId && item.enabled);
      if (ui.processing.input.enabled !== processInputEnabled) ui.processing.input.enabled = processInputEnabled;
      const cook = cooking.status(); const recipe = cook.recipeOptions.find((item) => item.id === cook.selectedRecipeId);
      const cookEnabled = enabled && panel === 'cooking';
      setEnabled('SelectCookingRecipe', cookEnabled && cook.recipeOptions.length > 0);
      setEnabled('SelectCookingRole', cookEnabled && (recipe?.roles.length ?? 0) > 0);
      setEnabled('SelectCookingLot', cookEnabled && cook.currentInputLotOptions.some((item) => item.enabled));
      setEnabled('ClearCookingRole', cookEnabled && cook.selectedRole !== null);
      setEnabled('SelectCookingHeat', cookEnabled && (recipe?.operation_constraints.heat_levels.length ?? 0) > 0);
      setEnabled('SelectCookingStorage', cookEnabled && cook.targetOptions.some((item) => item.enabled));
      setEnabled('CookingPreview', cookEnabled && cook.canPreview);
      setEnabled('CookDish', cookEnabled && !stock.splitNeedsReview && cook.canCook);
      const cookInput = cook.inputSelections.find((item) => item.role === cook.selectedRole);
      const cookInputEnabled = cookEnabled && cook.currentInputLotOptions.some((item) => item.id === cookInput?.lotId && item.enabled);
      if (ui.cooking.input.enabled !== cookInputEnabled) ui.cooking.input.enabled = cookInputEnabled;
      const minutesEnabled = cookEnabled && recipe !== undefined;
      if (ui.cooking.minutes.enabled !== minutesEnabled) ui.cooking.minutes.enabled = minutesEnabled;
      updateTabOrder();
    };
    const renderFarming = () => {
      if (!alive()) return;
      const state = farming.status();
      const field = state.fieldOptions.find((item) => item.id === state.selectedFieldId);
      const seed = state.seedOptions.find((item) => item.id === state.selectedSeedId);
      const crop = state.harvestableOptions.find((item) => item.id === state.selectedCropId);
      const free = state.fieldOptions.filter((item) => item.enabled).length;
      ui.farming.field.string = field
        ? `地块：${names[field.definition_id] ?? '已选地块'} ｜ 空余${field.available_tiles}/${field.capacity_tiles}格`
        : `地块：请选择 ｜ 可播种${free}/${state.fieldOptions.length}处`;
      ui.farming.seed.string = seed
        ? `种子：${names[seed.base_id] ?? '种子批次'} ｜ 剩余${seed.quantity.amount}${displayUnit(seed.quantity.unit)}`
        : '种子：请选择种子批次';
      const failed = state.cropStatusOptions.filter(item => item.lifecycle_status === 'failed').length;
      const pending = state.cropStatusOptions.filter(item => item.lifecycle_status === 'active' && item.growth_stage === 'seed').length;
      const growing = state.cropStatusOptions.filter(item => item.lifecycle_status === 'active' && item.growth_stage !== 'seed').length;
      ui.farming.crop.string = `待成苗${pending}位 ｜ 生长中${growing}株 ｜ 成苗失败${failed}位 ｜ 可收获${state.harvestableOptions.length}株` + (crop ? ` ｜ ${names[crop.crop_base_id] ?? '已选作物'}` : '');
      ui.farming.amount.string = `${state.plantingTiles}位`;
      ui.controls.SeedsPerTile.node.getComponentInChildren(Label)!.string = `每位${state.seedsPerTile}粒 ↻`;
      const probability = state.successProbability === null ? '请选择种子' : `每位成苗率${Number((state.successProbability * 100).toFixed(1))}%`;
      const shortage = field && state.plantingTiles > field.available_tiles ? '；土地空位不足'
        : seed && state.seedAmount > seed.quantity.amount ? '；种子不足' : '';
      ui.farming.planting.string = `${state.plantingTiles}位 × 每位${state.seedsPerTile}粒 = 共耗种${state.seedAmount}粒 ｜ ${probability}${shortage}`;
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
      ui.inventory.quantity.string = lot ? `数量：${lot.cabbage_pieces?.kind === 'whole' ? `${lot.cabbage_pieces.pieces.length}颗 / ` : lot.base_id === 'cabbage' && !lot.cabbage_pieces ? '颗数未知 / ' : ''}${lot.quantity.amount}${displayUnit(lot.quantity.unit)}` : '数量：—';
      ui.inventory.location.string = lot ? `当前位置：${locationName(lot.storage_ref.container_id)}` : '当前位置：—';
      ui.inventory.target.string = target ? `目标位置：${locationName(target.id)}` : '目标位置：请选择';
      ui.inventory.capacity.string = target ? '目标空间将在操作时校验' : '请选择目标位置';
      ui.inventory.hint.string = !lot || !target ? '先选择材料批次和目标位置'
        : lot.storage_ref.container_id === target.id ? '材料已在这个位置'
        : !lot.enabled ? '这批材料暂不可移动'
        : !target.enabled ? '目标当前不可用'
        : '移动整批材料，数量保持不变';
      if (ui.split.input.string !== stock.splitQuantityText) ui.split.input.string = stock.splitQuantityText;
      ui.split.unit.string = lot?.cabbage_pieces?.kind === 'whole' ? '颗' : stock.splitUnit ? displayUnit(stock.splitUnit) : '—';
      ui.split.selection.string = !lot ? '请选择要拆分的材料批次'
        : !lot.enabled ? '这批材料当前不可拆分'
        : stock.splitInputError ?? `本次选择：${stock.splitQuantityText}${lot?.cabbage_pieces?.kind === 'whole' ? '颗' : displayUnit(stock.splitUnit!)}`;
      ui.split.preview.string = stock.splitNeedsReview ? '结果待确认，请先核对库存' : stock.splitPreview === null ? '可直接确认，也可先预览'
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
    const renderProcessing = () => {
      if (!alive()) return;
      const process = processing.status();
      const method = process.methodOptions.find((item) => item.id === process.selectedMethodId);
      const facility = process.facilityOptions.find((item) => item.id === process.selectedFacilityId);
      const requirement = method?.input_requirements.find((item) => item.requirement_index === process.selectedRequirementIndex);
      const input = process.inputSelections.find((item) => item.requirementIndex === process.selectedRequirementIndex);
      const lot = process.lotOptions.find((item) => item.id === input?.lotId);
      ui.processing.method.string = method
        ? `方法：${names[method.id] ?? '已选加工方法'}`
          + (method.tool_requirements.length ? ` ｜ 工具：${method.tool_requirements.map((id) => names[id] ?? TOOL_LABELS[id] ?? '所需工具').join('/')}` : '')
        : '方法：请选择';
      ui.processing.facility.string = facility
        ? `设施：${names[facility.definition_id] ?? '已选设施'} ｜ 加工${method?.process_duration_minutes ?? '—'}分钟`
        : '设施：请选择兼容的加工设施';
      const identity = requirement?.constraints.base_id ? [requirement.constraints.base_id] : requirement?.constraints.allowed_base_ids ?? [];
      const description = identity.map((id) => names[id] ?? '材料').join('/') || '材料';
      ui.processing.requirement.string = requirement
        ? `第${requirement.requirement_index + 1}/${method!.input_requirements.length}项：${description}`
          + (requirement.constraints.allowed_forms.length ? ` ${requirement.constraints.allowed_forms.map((form) => FORM_LABELS[form] ?? form).join('/')}` : '')
          + (requirement.min_quantity ? ` 至少${requirement.min_quantity.amount}${displayUnit(requirement.min_quantity.unit)}` : '')
          + (requirement.constraints.min_freshness === null ? '' : ` 新鲜度≥${requirement.constraints.min_freshness}`)
        : '选择方法后查看各项必需输入';
      ui.processing.lot.string = lot ? `${names[lot.base_id] ?? '材料'} · ${names[`${lot.base_id}:${lot.current_form}`] ?? lot.current_form} · 剩${lot.quantity.amount}${displayUnit(lot.quantity.unit)}`
        : process.currentInputLotOptions.some((item) => item.enabled) ? '本项材料：请选择批次' : '本项暂无可用材料，请先补齐';
      if (ui.processing.input.string !== process.currentInputQuantityText) ui.processing.input.string = process.currentInputQuantityText;
      ui.processing.unit.string = process.currentInputUnit ? displayUnit(process.currentInputUnit) : '—';
      const selectedInputs = process.inputSelections.flatMap((item) => {
        const selected = process.lotOptions.find((candidate) => candidate.id === item.lotId);
        return selected && item.quantityText.trim() ? [`${names[selected.base_id] ?? '材料'}${item.quantityText}${displayUnit(selected.quantity.unit)}`] : [];
      });
      ui.processing.selection.string = selectedInputs.length ? '本次选择：' + selectedInputs.join(' / ') : '本次选择：尚未填写材料数量';
      ui.processing.preview.string = process.preview === null ? process.inputError ?? '填写后先预览，再开工'
        : process.preview.success ? '本次校验通过，尚未开工' : '本次拒绝：' + processingRejection(process.preview.statusCode);
      const taskIndex = process.taskOptions.findIndex((item) => item.id === process.selectedTaskId);
      const task = process.taskOptions[taskIndex];
      const statusName: Record<string, string> = { active: '加工中', ready_to_collect: '可领取', completed: '已完成领取' };
      const stageName: Record<string, string> = { fermenting: '发酵中', ready: '就绪' };
      ui.processing.task.string = task
        ? `任务${taskIndex + 1}/${process.taskOptions.length}：${statusName[task.status] ?? task.status}\n方法：${names[task.method_id] ?? '加工方法'}\n阶段：${stageName[task.current_stage] ?? task.current_stage}\n预计完成：第${Math.floor(task.expected_finish_minute / 1440) + 1}天 ${task.expected_finish_minute % 1440}分钟`
        : `当前共${process.taskOptions.length}项加工任务\n请选择任务查看真实状态\n正常推进时间后才能领取`;
      const result = process.collectResult;
      const resultIndex = result ? inventory.status().lotOptions.findIndex((item) => item.id === result.lotId) : -1;
      ui.processing.result.string = result
        ? `新增第${resultIndex + 1}批：${result.quantity.amount}${displayUnit(result.quantity.unit)}`
        : process.startResult ? `已新增加工任务${process.taskOptions.findIndex((item) => item.id === process.startResult!.taskId) + 1}，完成后领取` : '本次尚无加工结果';
      updateButtons();
    };
    const renderCooking = () => {
      if (!alive()) return;
      const state = cooking.status(); const recipe = state.recipeOptions.find((item) => item.id === state.selectedRecipeId);
      const role = recipe?.roles.find((item) => item.role === state.selectedRole);
      const input = state.inputSelections.find((item) => item.role === state.selectedRole);
      const lot = state.lotOptions.find((item) => item.id === input?.lotId);
      const target = state.targetOptions.find((item) => item.id === state.selectedTargetId);
      ui.cooking.recipe.string = recipe ? `配方：${names[recipe.id] ?? '已选配方'}${recipe.enabled ? '' : '（缺少必需材料）'}` : '配方：请选择现有配方';
      ui.cooking.role.string = role ? `${ROLE_LABELS[role.role] ?? role.role} · ${role.required ? '必需' : '可选'} · ${names[role.base_id ?? ''] ?? '食材'}`
        + (role.min_quantity ? ` 至少${role.min_quantity.amount}${displayUnit(role.min_quantity.unit)}` : '')
        + (role.allowed_forms.length ? ` ${role.allowed_forms.map((form) => FORM_LABELS[form] ?? (form === 'cured' ? '腌腊' : form === 'pickled' ? '腌菜' : form)).join('/')}` : '')
        : '角色：选择配方后查看必需与可选材料';
      ui.cooking.lot.string = lot ? `${names[lot.base_id] ?? '材料'} · ${names[`${lot.base_id}:${lot.current_form}`] ?? lot.current_form} · 剩${lot.quantity.amount}${displayUnit(lot.quantity.unit)}`
        : state.currentInputLotOptions.length ? '本角色材料：请选择真实批次' : '本角色暂无可用材料';
      if (ui.cooking.input.string !== state.currentInputQuantityText) ui.cooking.input.string = state.currentInputQuantityText;
      if (ui.cooking.minutes.string !== state.activeMinutesText) ui.cooking.minutes.string = state.activeMinutesText;
      ui.cooking.unit.string = state.currentInputUnit ? displayUnit(state.currentInputUnit) : '—';
      const selections = state.inputSelections.flatMap((item) => {
        const selected = state.lotOptions.find((candidate) => candidate.id === item.lotId);
        return selected && item.quantityText.trim() ? [`${ROLE_LABELS[item.role] ?? item.role}${item.quantityText}${displayUnit(selected.quantity.unit)}`] : [];
      });
      ui.cooking.selection.string = selections.length ? '已选：' + selections.join(' / ') : '已选：尚未填写材料数量';
      const operation = recipe?.operation_constraints;
      const preference = operation?.time_preference_minutes;
      ui.cooking.operation.string = operation ? `火候：${state.heatLevel ? HEAT_LABELS[state.heatLevel] ?? state.heatLevel : '请明确选择'}；当前要求${operation.required_heat_level ? HEAT_LABELS[operation.required_heat_level] ?? operation.required_heat_level : '按合法选项'}，分钟整数≥${operation.active_minutes.min}${operation.active_minutes.max === null ? '' : `且≤${operation.active_minutes.max}`}`
        + `\n偏好${preference?.ideal_min ?? '—'}—${preference?.ideal_max ?? '—'}分钟；设施/工具：${recipe!.facility_requirements.map((id) => names[id] ?? (id === 'basic_stove' ? '基础炉灶' : id)).concat(recipe!.tool_requirements.map((id) => names[id] ?? TOOL_LABELS[id] ?? id)).join('/')}`
        : '操作：选择配方，再明确选择火候和分钟数';
      ui.controls.SelectCookingHeat.node.getChildByName('Caption')!.getComponent(Label)!.string = state.heatLevel ? `火候：${HEAT_LABELS[state.heatLevel] ?? state.heatLevel}` : '选择火候';
      ui.cooking.target.string = target ? `目标：${STORAGE_LABELS[target.storage_type] ?? target.storage_type}` : '目标：请选择';
      const fuel = recipe?.fuel;
      ui.cooking.fuel.string = fuel ? `燃料：当前${fuel.current_quantity.amount}${displayUnit(fuel.current_quantity.unit)} / 每次${fuel.cost.amount}${displayUnit(fuel.cost.unit)}${fuel.enabled ? '' : '（未启用消耗）'}` : '燃料：当前配方无消耗要求';
      ui.cooking.preview.string = state.preview ? state.preview.success ? '本次校验通过，尚未烹饪' : '本次拒绝，请调整：' + this.cookingRejection(state.preview.statusCode)
        : state.inputError ?? '先预览，再确认烹饪';
      ui.cooking.result.string = state.result ? `本次新增：${names[state.result.recognizedDishId ?? ''] ?? '菜品'} ${state.result.servingCount}份` : '本次尚无烹饪结果';
      ui.cooking.dishes.string = state.dishOptions.length ? `已有菜品${state.dishOptions.length}批：` + state.dishOptions.slice(-2).map((dish) => `${names[dish.recognized_dish_id ?? ''] ?? '菜品'}${dish.serving_count}份`).join('/') : '已有菜品：暂无';
      updateButtons();
    };
    const renderOrders = () => {
      if (!alive()) return;
      const state = orders.status(); const order = state.orderOptions.find(item => item.id === state.selectedOrderId);
      const dish = state.dishOptions.find(item => item.id === state.selectedDishId);
      const states: Record<string,string> = { available: '可提交', accepted: '已接受', submitted: '结算中', completed: '已完成', failed: '失败', expired: '已超时', cancelled: '已取消' };
      const words: Record<string,string> = { safety_risk: '安全风险', saltiness: '咸度', oiliness: '油度', serving_count: '份数', home_style: '家常风味', unsafe: '不安全', watery_dish: '水多', too_salty: '过咸', minor_penalty: '轻扣分', medium_penalty: '中扣分' };
      const requirement = (item: { key: string; min_value?: number; max_value?: number; target_range?: readonly number[]; weight?: number }) => (words[item.key] ?? item.key)
        + (item.target_range ? item.target_range.join('—') : `${item.min_value === undefined ? '' : '≥' + item.min_value}${item.max_value === undefined ? '' : '≤' + item.max_value}`)
        + (item.weight === undefined ? '' : `(权${item.weight})`);
      ui.orders.order.string = order ? `订单：${names[order.demand_profile_id] ?? '现有酒馆订单'}` : `现有订单${state.orderOptions.length}项，请选择`;
      ui.orders.state.string = order ? `状态：${states[order.status] ?? order.status}` : '状态：尚未选择';
      ui.orders.deadline.string = order?.deadline_absolute_minute == null ? '截止：暂无可用截止数据'
        : `截止：第${Math.floor(order.deadline_absolute_minute / 1440) + 1}天 ${order.deadline_absolute_minute % 1440}分钟 · ${order.minutes_until_deadline! < 0 ? '已超时' : '剩余'}${Math.abs(order.minutes_until_deadline!)}分钟`;
      ui.orders.quantity.string = order ? `订单量${order.quantity_required.amount}${displayUnit(order.quantity_required.unit)} · 基础奖励${order.base_reward}（仅参考）` : '数量与基础奖励：选择订单后查看';
      const demand = order?.demand;
      ui.orders.demand.string = demand ? `硬要求：${demand.hard_requirements.map(requirement).join(' / ') || '无'}\n偏好（非硬门槛）：${demand.weighted_requirements.map(requirement).join(' / ')}\n禁忌：${demand.forbidden_defects.map(key => words[key] ?? key).join('/') || '无'}\n容忍缺陷：${Object.entries(demand.acceptable_defects).map(([key,value]) => `${words[key] ?? key}${words[value] ?? value}`).join('/') || '无'}\n匹配阈值：${demand.match_threshold}；以正式校验为准`
        : order ? '需求配置不可用，不能提交' : '选择订单查看真实硬要求与偏好';
      const history = order?.result_summary;
      ui.orders.history.string = history ? `历史结算：奖励${history.reward_final ?? '—'} / 提交${history.submitted_count ?? '—'}份` : '该订单尚无历史结算';
      ui.orders.dish.string = dish ? `菜品：${names[dish.recognized_dish_id ?? ''] ?? '真实菜品批次'}` : `可提交菜品${state.dishOptions.length}批，请选择`;
      ui.orders.detail.string = dish ? `本次整批提交${dish.serving_count}份\n位置：${STORAGE_LABELS[dish.storage_ref.storage_type] ?? dish.storage_ref.storage_type}` : '暂无选择；先烹饪得到真实菜品';
      ui.orders.money.string = `当前金钱：${state.money ?? '—'}`;
      ui.orders.reputation.string = '当前声望：' + (Object.entries(state.reputation).map(([key,value]) => `${names[key] ?? (key === 'west_market_tavern' ? '酒馆' : key)} ${value}`).join(' / ') || '暂无');
      ui.orders.preview.string = state.preview ? state.preview.success ? '本次校验通过，尚未提交' : '本次拒绝：请调整菜品或订单'
        : state.inputError ?? '请先预览，不预测最终奖励';
      const result = state.result;
      ui.orders.result.string = result ? `本次结算：奖励${result.rewardMoney}，匹配${result.matchScore}\n声望变化：${Object.entries(result.reputationDelta).map(([,value]) => `${value >= 0 ? '+' : ''}${value}`).join('/') || '0'} · 实际提交${result.servingCount}份` : '本次尚无订单结算结果';
      updateButtons();
    };
    const unexpected = (error: unknown, startup = false) => {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      if (alive()) {
        if (startup) ui.phase.string = '启动失败';
        else ui.operation.string = message.startsWith('ERR_WEB_SPLIT_RESULT_UNCERTAIN') ? '拆分结果待确认，请先核对库存' : '操作异常，请重试';
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
        const nowIso8601 = new Date().toISOString();
        return createStage1AHost({ ...input, storage: new BrowserSaveStoragePort(), nowIso8601, randomSeed: `new_game:${nowIso8601}` });
      },
      createBinding: (host) => new QinglanUiSceneProbeComponent(host, {
        applyNodeBindingPatch: (patch) => {
          if (lifetime.isDisposed() || !alive()) return;
          if (patch.section === 'menu') {
            const menu = patch.payload as ProbeMenuSnapshot;
            if (menu.view_model?.time_label) ui.time.string = menu.view_model.time_label;
            farming.refresh(menu);
            inventory.refresh(menu);
            processing.refresh(menu);
            cooking.refresh(menu);
            orders.refresh(menu);
            renderFarming();
            renderInventory();
            renderProcessing();
            renderCooking(); renderOrders();
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
      execute: async (command) => {
        try {
          const result = await lifetime.execute(command);
          if (command.name === 'menu_confirm_split_direct') {
            inventory.acceptSplitResult(command, result);
            if (inventory.status().splitNeedsReview) throw new Error('ERR_WEB_SPLIT_RESULT_UNCERTAIN');
          }
          if (command.name === 'refresh' && !inventory.acceptSplitReview(result)) throw new Error('ERR_WEB_SPLIT_RESULT_UNCERTAIN');
          if (alive() && !lifetime.isDisposed()) { cooking.acceptCookingResult(command, result); orders.acceptOrderResult(command, result); }
          return result;
        } catch (error) {
          if (command.name === 'menu_confirm_split_direct') inventory.markSplitUncertain();
          throw error;
        }
      },
      onChange: (state) => {
        ui.operation.string = state.operation.message;
        renderInventory();
        renderProcessing();
        renderCooking(); renderOrders();
      }
    });
    // Capture the stable coordinator and view. Creator may clear Component fields on destruction.
    const commands = interaction;
    const executeButton = (command: ProbeCommand) => {
      if (commands.status().busy || !alive() || lifetime.status().phase !== 'ready' || lifetime.isDisposed()) return;
      if (inventory.status().splitNeedsReview && command.name !== 'refresh') return;
      const splitCommand = command.name === 'menu_confirm_split_direct' || (command.name === 'menu_preview' && command.selection.action_type === 'split_lot');
      const processingCommand = (command.name === 'menu_preview' || command.name === 'menu_confirm')
        && (command.selection.action_type === 'start_processing' || command.selection.action_type === 'collect_processing_result');
      if (command.name === 'load') inventory.resetSplitDraft();
      else if (!splitCommand) inventory.invalidateSplitPreview();
      if (!processingCommand) processing.invalidatePreview();
      const cookingCommand = (command.name === 'menu_preview' || command.name === 'menu_confirm') && command.selection.action_type === 'cook_dish';
      if (!cookingCommand) cooking.invalidatePreview();
      const orderCommand = (command.name === 'menu_preview' || command.name === 'menu_confirm') && command.selection.action_type === 'submit_order';
      if (!orderCommand) orders.invalidatePreview();
      void commands.execute(command).then((result) => {
        if (!result || !alive() || lifetime.isDisposed()) return;
        if (command.name === 'menu_preview') inventory.acceptSplitResult(command, result);
        processing.acceptProcessingResult(command, result);
        renderInventory();
        renderProcessing();
        renderCooking(); renderOrders();
      }).catch((error) => {
        // A view-application failure may follow a committed action. Require a fresh
        // player preview instead of leaving the former confirmation enabled.
        inventory.invalidateSplitPreview();
        processing.invalidatePreview();
        cooking.invalidatePreview(); orders.invalidatePreview();
        renderInventory();
        renderProcessing();
        renderCooking(); renderOrders();
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
      processing.invalidatePreview();
      cooking.invalidatePreview(); orders.invalidatePreview();
      change();
      renderFarming();
      renderInventory();
      renderProcessing();
      renderCooking(); renderOrders();
    });
    localSelection('SelectField', () => farming.selectNextField());
    localSelection('SelectSeed', () => farming.selectNextSeed());
    localSelection('SelectCrop', () => farming.selectNextCrop());
    localSelection('SeedAmountDecrease', () => farming.adjustSeedAmount(-1));
    localSelection('SeedAmountIncrease', () => farming.adjustSeedAmount(1));
    localSelection('SeedsPerTile', () => farming.cycleSeedsPerTile());
    const switchPanel = (next: 'farming' | 'inventory' | 'processing' | 'cooking' | 'orders') => {
      inventory.invalidateSplitPreview();
      ui.split.input.blur();
      ui.processing.input.blur();
      ui.cooking.input.blur(); ui.cooking.minutes.blur();
      panel = next;
      ui.panels.farming.active = next === 'farming';
      ui.panels.inventory.active = next === 'inventory';
      ui.panels.processing.active = next === 'processing';
      ui.panels.cooking.active = next === 'cooking';
      ui.panels.orders.active = next === 'orders';
      ui.layout.selectPanel(next);
      ui.title.string = ({ farming: '青岚 · 种植与收获', inventory: '青岚 · 库存与储存', processing: '青岚 · 加工与领取', cooking: '青岚 · 烹饪与菜品', orders: '青岚 · 酒馆订单' })[next];
    };
    localSelection('OpenFarming', () => switchPanel('farming'));
    localSelection('OpenInventory', () => switchPanel('inventory'));
    localSelection('OpenProcessing', () => switchPanel('processing'));
    localSelection('OpenCooking', () => switchPanel('cooking'));
    localSelection('OpenOrders', () => switchPanel('orders'));
    localSelection('SelectOrder', () => orders.selectNextOrder());
    localSelection('SelectOrderDish', () => orders.selectNextDish());
    for (const [name, command] of [['OrderPreview', () => orders.previewCommand()], ['SubmitOrder', () => orders.confirmCommand()]] as const)
      ui.controls[name].node.on(Button.EventType.CLICK, () => { const next = command(); if (next) executeButton(next); });
    localSelection('SelectCookingRecipe', () => cooking.selectNextRecipe());
    localSelection('SelectCookingRole', () => cooking.selectNextRole());
    localSelection('SelectCookingLot', () => cooking.selectNextLot());
    localSelection('ClearCookingRole', () => cooking.clearRole());
    localSelection('SelectCookingHeat', () => cooking.selectNextHeat());
    localSelection('SelectCookingStorage', () => cooking.selectNextStorage());
    for (const [input, change] of [[ui.cooking.input, () => cooking.setInputQuantity(ui.cooking.input.string)],
      [ui.cooking.minutes, () => cooking.setActiveMinutes(ui.cooking.minutes.string)]] as const) input.node.on(EditBox.EventType.TEXT_CHANGED, () => {
      if (commands.status().busy || !alive() || panel !== 'cooking' || lifetime.status().phase !== 'ready' || lifetime.isDisposed()) return;
      change(); renderCooking(); renderOrders();
    });
    for (const [name, command] of [['CookingPreview', () => cooking.previewCommand()], ['CookDish', () => cooking.confirmCommand()]] as const)
      ui.controls[name].node.on(Button.EventType.CLICK, () => { const next = command(); if (next) executeButton(next); });
    localSelection('SelectInventoryLot', () => inventory.selectNextLot());
    localSelection('SelectStorageTarget', () => inventory.selectNextTarget());
    localSelection('SelectProcessingMethod', () => processing.selectNextMethod());
    localSelection('SelectProcessingInput', () => processing.selectNextInput());
    localSelection('SelectProcessingLot', () => processing.selectNextLot());
    localSelection('SelectProcessingFacility', () => processing.selectNextFacility());
    localSelection('SelectProcessingTask', () => processing.selectNextTask());
    ui.processing.input.node.on(EditBox.EventType.TEXT_CHANGED, () => {
      if (commands.status().busy || !alive() || panel !== 'processing' || lifetime.status().phase !== 'ready' || lifetime.isDisposed()) return;
      processing.setInputQuantity(ui.processing.input.string);
      renderProcessing();
    });
    for (const [name, command] of [
      ['ProcessingPreview', () => processing.startPreviewCommand()],
      ['StartProcessing', () => processing.startConfirmCommand()],
      ['CollectProcessing', () => processing.collectCommand()]
    ] as const) ui.controls[name].node.on(Button.EventType.CLICK, () => { const next = command(); if (next) executeButton(next); });
    ui.split.input.node.on(EditBox.EventType.TEXT_CHANGED, () => {
      if (commands.status().busy || !alive() || panel !== 'inventory' || lifetime.status().phase !== 'ready' || lifetime.isDisposed()) return;
      inventory.setSplitQuantity(ui.split.input.string);
      renderInventory();
    });
    ui.controls.SplitPreview.node.on(Button.EventType.CLICK, () => {
      if (inventory.status().splitNeedsReview) { executeButton({ name: 'refresh' }); return; }
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
        layout: ui.layout.status(),
        inventory: inventory.status(),
        processing: processing.status(),
        cooking: cooking.status(),
        orders: orders.status(),
        displayedOrders: alive() ? Object.fromEntries(Object.entries(ui.orders).map(([key,label]) => [key,label.string])) : null,
        displayedCooking: alive() ? {
          recipe: ui.cooking.recipe.string, role: ui.cooking.role.string, lot: ui.cooking.lot.string,
          quantityText: ui.cooking.input.string, minutesText: ui.cooking.minutes.string, unit: ui.cooking.unit.string,
          selection: ui.cooking.selection.string, operation: ui.cooking.operation.string, target: ui.cooking.target.string,
          fuel: ui.cooking.fuel.string, preview: ui.cooking.preview.string, result: ui.cooking.result.string, dishes: ui.cooking.dishes.string
        } : null,
        displayedProcessing: alive() ? {
          method: ui.processing.method.string, facility: ui.processing.facility.string,
          requirement: ui.processing.requirement.string, lot: ui.processing.lot.string,
          quantityText: ui.processing.input.string, unit: ui.processing.unit.string,
          selection: ui.processing.selection.string, preview: ui.processing.preview.string,
          task: ui.processing.task.string, result: ui.processing.result.string
        } : null,
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
          inventory: ui.farming.inventory.string, amount: ui.farming.amount.string, planting: ui.farming.planting.string
        } : null,
        nodeValid: alive(), errors: [...errors]
      }),
      dispose: () => { if (alive()) ui.root.destroy(); }
    });
    (globalThis as typeof globalThis & { __cocosWebProbe?: typeof observer }).__cocosWebProbe = observer;
    void lifetime.start().catch(() => { /* Startup already published its original error. */ });
  }

  onDestroy(): void {
    const layoutCleanup = this.layoutCleanup;
    this.layoutCleanup = null;
    layoutCleanup?.();
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
    const panels = { farming: this.makePanel(canvasNode, 'FarmingPanel'), inventory: this.makePanel(canvasNode, 'InventoryPanel'), processing: this.makePanel(canvasNode, 'ProcessingPanel'), cooking: this.makePanel(canvasNode, 'CookingPanel'), orders: this.makePanel(canvasNode, 'OrdersPanel') };
    panels.inventory.active = false;
    panels.processing.active = false;
    panels.cooking.active = false;
    panels.orders.active = false;
    const farming = {
      field: this.makeLabel(panels.farming, 'FieldSummary', '地块：等待启动', 155, 18),
      seed: this.makeLabel(panels.farming, 'SeedSummary', '种子：等待启动', 125, 18),
      crop: this.makeLabel(panels.farming, 'CropSummary', '暂无可收获作物', 95, 18),
      inventory: this.makeLabel(panels.farming, 'InventorySummary', '等待库存', 65, 17),
      amount: this.makeLabel(panels.farming, 'SeedAmount', '1位', -44, 21),
      planting: this.makeLabel(panels.farming, 'PlantingSummary', '请选择种子查看成苗率', -80, 15)
    };
    farming.amount.node.setPosition(-240, -44, 0);
    farming.amount.node.getComponent(UITransform)!.setContentSize(100, 44);
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
    const processing = {
      method: this.makeSectionLabel(panels.processing, 'ProcessingMethod', '方法：请选择', -235, 160, 430, 18),
      facility: this.makeSectionLabel(panels.processing, 'ProcessingFacility', '设施：请选择兼容的加工设施', -235, 91, 430, 14),
      requirement: this.makeSectionLabel(panels.processing, 'ProcessingRequirement', '选择方法后查看各项必需输入', -235, 69, 430, 14),
      lot: this.makeSectionLabel(panels.processing, 'ProcessingLot', '本项材料：请选择批次', -235, 9, 430, 14),
      input: this.makeQuantityInput(panels.processing, -260, -21, 'ProcessingQuantity', '输入本项数量'),
      unit: this.makeSectionLabel(panels.processing, 'ProcessingUnit', '—', -65, -21, 60, 19),
      selection: this.makeSectionLabel(panels.processing, 'ProcessingSelection', '本次选择：尚未填写材料数量', 235, 160, 430, 15),
      preview: this.makeSectionLabel(panels.processing, 'ProcessingPreviewSummary', '填写后先预览，再开工', 235, 132, 430, 15),
      task: this.makeSectionLabel(panels.processing, 'ProcessingTask', '暂无加工任务', 235, 22, 430, 15),
      result: this.makeSectionLabel(panels.processing, 'ProcessingResult', '本次尚无加工结果', 235, -85, 430, 14)
    };
    processing.task.node.getComponent(UITransform)!.setContentSize(430, 88);
    processing.task.enableWrapText = true;
    processing.task.lineHeight = 20;
    const cooking = {
      recipe: this.makeSectionLabel(panels.cooking, 'CookingRecipe', '配方：请选择', -235, 166, 430, 16),
      role: this.makeSectionLabel(panels.cooking, 'CookingRole', '角色：请选择配方', -235, 97, 430, 13),
      lot: this.makeSectionLabel(panels.cooking, 'CookingLot', '本角色材料：请选择', -235, 30, 430, 13),
      input: this.makeQuantityInput(panels.cooking, -270, -2, 'CookingQuantity', '本角色数量'),
      unit: this.makeSectionLabel(panels.cooking, 'CookingUnit', '—', -65, -2, 60, 18),
      selection: this.makeSectionLabel(panels.cooking, 'CookingSelection', '已选：尚未填写', -235, -84, 430, 12),
      operation: this.makeSectionLabel(panels.cooking, 'CookingOperation', '操作：请选择配方', 235, 166, 430, 12),
      minutes: this.makeQuantityInput(panels.cooking, 345, 126, 'CookingMinutes', '操作分钟数', 210),
      target: this.makeSectionLabel(panels.cooking, 'CookingTarget', '目标：请选择储存位置', 235, 90, 430, 12),
      fuel: this.makeSectionLabel(panels.cooking, 'CookingFuel', '燃料：选择配方后查看', 235, 22, 430, 12),
      preview: this.makeSectionLabel(panels.cooking, 'CookingPreviewSummary', '先预览，再烹饪', 235, -1, 430, 12),
      result: this.makeSectionLabel(panels.cooking, 'CookingResult', '本次尚无烹饪结果', 235, -66, 430, 12),
      dishes: this.makeSectionLabel(panels.cooking, 'CookingDishes', '已有菜品：暂无', 235, -86, 430, 11)
    };
    cooking.operation.node.getComponent(UITransform)!.setContentSize(430, 34);
    cooking.operation.enableWrapText = true; cooking.operation.lineHeight = 16;
    const orders = {
      order: this.makeSectionLabel(panels.orders, 'OrderName', '请选择订单', -235, 166, 430, 16),
      state: this.makeSectionLabel(panels.orders, 'OrderState', '状态：尚未选择', -235, 94, 430, 14),
      deadline: this.makeSectionLabel(panels.orders, 'OrderDeadline', '截止：尚未选择', -235, 72, 430, 12),
      quantity: this.makeSectionLabel(panels.orders, 'OrderQuantity', '数量与基础奖励：尚未选择', -235, 50, 430, 12),
      demand: this.makeSectionLabel(panels.orders, 'OrderDemand', '选择订单查看需求', -235, -12, 430, 11),
      history: this.makeSectionLabel(panels.orders, 'OrderHistory', '该订单尚无历史结算', -235, -80, 430, 11),
      dish: this.makeSectionLabel(panels.orders, 'OrderDish', '请选择真实菜品', 235, 166, 430, 16),
      detail: this.makeSectionLabel(panels.orders, 'OrderDishDetail', '暂无真实菜品', 235, 86, 430, 12),
      money: this.makeSectionLabel(panels.orders, 'OrderMoney', '当前金钱：—', 235, 53, 430, 14),
      reputation: this.makeSectionLabel(panels.orders, 'OrderReputation', '当前声望：—', 235, 32, 430, 12),
      preview: this.makeSectionLabel(panels.orders, 'OrderPreviewSummary', '请选择订单和菜品', 235, 9, 430, 12),
      result: this.makeSectionLabel(panels.orders, 'OrderResult', '本次尚无订单结算结果', 235, -76, 430, 12)
    };
    for (const [label,height,lineHeight] of [[orders.demand,104,14],[orders.detail,32,15],[orders.result,36,16]] as const) {
      label.node.getComponent(UITransform)!.setContentSize(430,height); label.enableWrapText = true; label.lineHeight = lineHeight;
    }
    const controls: Record<string, Button> = {
      OpenFarming: this.makeButton(canvasNode, 'OpenFarming', '种植收获', -368, 239, 176),
      OpenInventory: this.makeButton(canvasNode, 'OpenInventory', '库存储存', -184, 239, 176),
      OpenProcessing: this.makeButton(canvasNode, 'OpenProcessing', '加工领取', 0, 239, 176),
      OpenCooking: this.makeButton(canvasNode, 'OpenCooking', '烹饪菜品', 184, 239, 176),
      OpenOrders: this.makeButton(canvasNode, 'OpenOrders', '酒馆订单', 368, 239, 176),
      SelectOrder: this.makeButton(panels.orders, 'SelectOrder', '选择现有订单', -235, 130, 410),
      SelectOrderDish: this.makeButton(panels.orders, 'SelectOrderDish', '选择菜品批次', 235, 130, 410),
      OrderPreview: this.makeButton(panels.orders, 'OrderPreview', '预览订单', 125, -27, 200),
      SubmitOrder: this.makeButton(panels.orders, 'SubmitOrder', '确认整批提交', 345, -27, 200),
      AdvanceOneHour: this.makeButton(canvasNode, 'AdvanceOneHour', '推进一小时', -155, -120),
      SaveLocal: this.makeButton(canvasNode, 'SaveLocal', '本地保存', -155, -179),
      LoadLocal: this.makeButton(canvasNode, 'LoadLocal', '读取本地存档', 155, -179),
      SelectField: this.makeButton(panels.farming, 'SelectField', '选择地块', -300, 20, 260),
      SelectSeed: this.makeButton(panels.farming, 'SelectSeed', '选择种子', 0, 20, 260),
      SelectCrop: this.makeButton(panels.farming, 'SelectCrop', '选择收获作物', 300, 20, 260),
      SeedAmountDecrease: this.makeButton(panels.farming, 'SeedAmountDecrease', '位−', -400, -44, 60),
      SeedAmountIncrease: this.makeButton(panels.farming, 'SeedAmountIncrease', '位＋', -330, -44, 60),
      SeedsPerTile: this.makeButton(panels.farming, 'SeedsPerTile', '每位1粒 ↻', -85, -44, 180),
      PlantCrop: this.makeButton(panels.farming, 'PlantCrop', '播种', 105, -44, 160),
      AdvanceOneDay: this.makeButton(canvasNode, 'AdvanceOneDay', '推进一天', 155, -120),
      HarvestCrop: this.makeButton(panels.farming, 'HarvestCrop', '收获', 310, -44, 210),
      SelectInventoryLot: this.makeButton(panels.inventory, 'SelectInventoryLot', '下一批材料', -235, 43, 390),
      SelectStorageTarget: this.makeButton(panels.inventory, 'SelectStorageTarget', '选择目标位置', -345, -74, 190),
      MoveInventoryLot: this.makeButton(panels.inventory, 'MoveInventoryLot', '移动整批', -125, -74, 190),
      SplitPreview: this.makeButton(panels.inventory, 'SplitPreview', '预览拆分', 125, -28, 200),
      SplitConfirm: this.makeButton(panels.inventory, 'SplitConfirm', '确认拆分', 345, -28, 200),
      SelectProcessingMethod: this.makeButton(panels.processing, 'SelectProcessingMethod', '选择方法', -345, 125, 190),
      SelectProcessingFacility: this.makeButton(panels.processing, 'SelectProcessingFacility', '选择设施', -125, 125, 190),
      SelectProcessingInput: this.makeButton(panels.processing, 'SelectProcessingInput', '下一项输入', -345, 40, 190),
      SelectProcessingLot: this.makeButton(panels.processing, 'SelectProcessingLot', '本项下一批', -125, 40, 190),
      ProcessingPreview: this.makeButton(panels.processing, 'ProcessingPreview', '预览加工', -345, -72, 190),
      StartProcessing: this.makeButton(panels.processing, 'StartProcessing', '确认开工', -125, -72, 190),
      SelectProcessingTask: this.makeButton(panels.processing, 'SelectProcessingTask', '下一项加工任务', 235, 96, 390),
      CollectProcessing: this.makeButton(panels.processing, 'CollectProcessing', '领取加工产物', 235, -50, 390),
      SelectCookingRecipe: this.makeButton(panels.cooking, 'SelectCookingRecipe', '选择配方', -235, 130, 410),
      SelectCookingRole: this.makeButton(panels.cooking, 'SelectCookingRole', '下一食材角色', -345, 62, 190),
      SelectCookingLot: this.makeButton(panels.cooking, 'SelectCookingLot', '本角色下一批', -125, 62, 190),
      ClearCookingRole: this.makeButton(panels.cooking, 'ClearCookingRole', '清空本角色选料', -235, -48, 390),
      SelectCookingHeat: this.makeButton(panels.cooking, 'SelectCookingHeat', '选择火候', 115, 126, 210),
      SelectCookingStorage: this.makeButton(panels.cooking, 'SelectCookingStorage', '选择菜品储存', 235, 56, 410),
      CookingPreview: this.makeButton(panels.cooking, 'CookingPreview', '预览烹饪', 125, -31, 200),
      CookDish: this.makeButton(panels.cooking, 'CookDish', '确认烹饪', 345, -31, 200)
    };
    const buttons = Object.values(controls);
    const phase = this.makeLabel(canvasNode, 'Status', '准备启动', -225, 16);
    const operation = this.makeLabel(canvasNode, 'Operation', '请选择地块和种子后播种', -260, 18);
    this.makeLabel(canvasNode, 'LocalSaveHint', '本浏览器本地存档，刷新后可手动读取', -299, 15);
    const layout = this.makeLayout(canvasNode, camera, panels);
    this.layoutCleanup = layout.dispose;
    return { root: this.node, title, time, phase, operation, buttons, controls, farming, inventory, panels, split, processing, cooking, orders, layout };
  }

  private makeLayout(canvasNode: Node, camera: Camera, panels: ProbeView['panels']): ProbeLayoutView {
    const nodes = new Map<string, Node>();
    const originals: {
      node: Node; x: number; y: number; z: number; width: number; height: number; anchorX: number; anchorY: number;
      inputManaged: boolean;
      label: { fontSize: number; lineHeight: number; wrap: boolean; overflow: Label['overflow'] } | null;
    }[] = [];
    const capture = (node: Node, inputManaged = false) => {
      const transform = node.getComponent(UITransform);
      const label = node.getComponent(Label);
      if (transform) originals.push({
        node, x: node.position.x, y: node.position.y, z: node.position.z,
        inputManaged,
        width: transform.width, height: transform.height, anchorX: transform.anchorPoint.x, anchorY: transform.anchorPoint.y,
        label: label ? { fontSize: label.fontSize, lineHeight: label.lineHeight, wrap: label.enableWrapText, overflow: label.overflow } : null
      });
      nodes.set(node.name, node);
      for (const child of node.children) capture(child, inputManaged || node.getComponent(EditBox) !== null);
    };
    capture(canvasNode);
    const saveHint = nodes.get('LocalSaveHint')!.getComponent(Label)!;
    const desktopSaveHint = saveHint.string;
    const viewportNode = new Node('ProbeScrollViewport');
    viewportNode.layer = Layers.Enum.UI_2D;
    canvasNode.addChild(viewportNode);
    const viewportTransform = viewportNode.addComponent(UITransform);
    const mask = viewportNode.addComponent(Mask);
    const scroll = viewportNode.addComponent(ScrollView);
    scroll.horizontal = false;
    scroll.vertical = true;
    scroll.inertia = false;
    scroll.elastic = false;
    scroll.cancelInnerEvents = true;
    const content = new Node('ProbeScrollContent');
    content.layer = Layers.Enum.UI_2D;
    viewportNode.addChild(content);
    const contentTransform = content.addComponent(UITransform);
    for (const panel of Object.values(panels)) panel.setParent(content);
    scroll.content = content;
    let panel: ProbePanelName = 'farming';
    let disposed = false;
    let applying = false;
    let plan: ProbeLayoutPlan = createProbeLayout(960, 640);
    let contentHeight = 640;
    const restore = () => {
      for (const original of originals) {
        // EditBox initializes and maintains its own label geometry after this first capture.
        // Restoring the construction-time child positions would overwrite that SDK layout.
        if (!original.inputManaged) {
          original.node.setPosition(original.x, original.y, original.z);
          const transform = original.node.getComponent(UITransform)!;
          transform.setContentSize(original.width, original.height);
          transform.setAnchorPoint(original.anchorX, original.anchorY);
        }
        if (original.label) {
          const label = original.node.getComponent(Label)!;
          label.fontSize = original.label.fontSize; label.lineHeight = original.label.lineHeight;
          label.enableWrapText = original.label.wrap; label.overflow = original.label.overflow;
        }
      }
    };
    const paintInput = (input: EditBox) => {
      const transform = input.node.getComponent(UITransform)!;
      const background = input.node.getChildByName('Background')!;
      background.getComponent(UITransform)!.setContentSize(transform.width, transform.height);
      const graphics = background.getComponent(Graphics)!;
      graphics.clear(); graphics.fillColor = new Color(40, 57, 70, 255);
      graphics.roundRect(-transform.width / 2, -transform.height / 2, transform.width, transform.height, 6); graphics.fill();
      for (const label of [input.textLabel, input.placeholderLabel]) if (label && plan.mode === 'compact') {
        label.node.getComponent(UITransform)!.setContentSize(transform.width - 20, transform.height);
        label.fontSize = 16; label.lineHeight = 24;
      }
    };
    const applyRect = (name: string, rect: ProbeLayoutRect, fixed: boolean) => {
      const node = nodes.get(name);
      if (!node) throw new Error('ERR_PROBE_LAYOUT_NODE_MISSING:' + name);
      node.setPosition(rect.x + rect.width / 2 - (fixed ? plan.design.width : plan.viewport.width) / 2,
        (fixed ? plan.design.height / 2 : 0) - rect.y - rect.height / 2, 0);
      node.getComponent(UITransform)!.setContentSize(rect.width, rect.height);
      const label = node.getComponent(Label);
      if (label) {
        label.fontSize = rect.fontSize ?? 14; label.lineHeight = (rect.fontSize ?? 14) + 4;
        label.enableWrapText = rect.wrap ?? false; label.overflow = Label.Overflow.CLAMP;
      }
      const button = node.getComponent(Button);
      if (button) {
        const caption = node.getChildByName('Caption')!.getComponent(Label)!;
        caption.node.getComponent(UITransform)!.setContentSize(rect.width - 10, rect.height);
        caption.fontSize = rect.fontSize ?? 16; caption.lineHeight = (rect.fontSize ?? 16) + 4;
      }
    };
    const relayout = () => {
      if (disposed || applying || !isValid(canvasNode, true)) return;
      applying = true;
      try {
        const editing = [...nodes.values()].map(node => node.getComponent(EditBox)).find(input => input?.isFocused()) ?? null;
        const pixels = screen.windowSize;
        const dpr = screen.devicePixelRatio;
        plan = createProbeLayout(pixels.width / dpr, pixels.height / dpr);
        scroll.stopAutoScroll();
        restore();
        saveHint.string = desktopSaveHint;
        view.setDesignResolutionSize(plan.design.width, plan.design.height, ResolutionPolicy.SHOW_ALL);
        canvasNode.getComponent(UITransform)!.setContentSize(plan.design.width, plan.design.height);
        camera.orthoHeight = plan.design.height / 2;
        if (plan.mode === 'compact') {
          saveHint.string = '中间区域可上下滑动；本浏览器本地存档，刷新后可手动读取';
          const rect = plan.viewport;
          viewportNode.setPosition(rect.x + rect.width / 2 - plan.design.width / 2,
            plan.design.height / 2 - rect.y - rect.height / 2, 0);
          viewportTransform.setContentSize(rect.width, rect.height);
          contentHeight = Math.max(plan.panels[panel].height, rect.height);
          contentTransform.setAnchorPoint(.5, 1);
          contentTransform.setContentSize(rect.width, contentHeight);
          content.setPosition(0, rect.height / 2, 0);
          for (const [name, rectangle] of Object.entries(plan.fixed)) applyRect(name, rectangle, true);
          for (const [name, page] of Object.entries(plan.panels)) {
            const panelNode = panels[name as ProbePanelName];
            panelNode.setPosition(0, 0, 0);
            panelNode.getComponent(UITransform)!.setContentSize(rect.width, page.height);
            for (const [nodeName, rectangle] of Object.entries(page.nodes)) applyRect(nodeName, rectangle, false);
          }
          mask.enabled = true; scroll.enabled = true; scroll.scrollToTop(0);
          if (editing?.node.activeInHierarchy) {
            const inputRect = plan.panels[panel].nodes[editing.node.name];
            if (inputRect && inputRect.height <= rect.height) {
              const offset = Math.min(Math.max(0, contentHeight - rect.height),
                Math.max(0, inputRect.y + inputRect.height - rect.height));
              scroll.scrollToOffset(new Vec2(0, offset), 0);
            } else {
              // Unknown windows too small for a complete field are outside the supported contract.
              editing.blur();
            }
          }
        } else {
          scroll.enabled = false; mask.enabled = false;
          viewportNode.setPosition(0, 0, 0); viewportTransform.setContentSize(960, 640);
          contentHeight = 640; contentTransform.setAnchorPoint(.5, .5);
          contentTransform.setContentSize(960, 640); content.setPosition(0, 0, 0);
        }
        const inputs: EditBox[] = [];
        for (const node of nodes.values()) {
          const button = node.getComponent(Button);
          if (button) this.paintButton(button, button.interactable);
          const input = node.getComponent(EditBox);
          if (input) { paintInput(input); inputs.push(input); }
        }
        this.updateEditTabOrder(inputs, plan.mode === 'compact');
      } finally { applying = false; }
    };
    let frameCheckPending = false;
    const reconcileFrame = () => {
      frameCheckPending = false;
      if (disposed || !isValid(this, true) || !isValid(canvasNode, true)) return;
      const pixels = screen.windowSize, dpr = screen.devicePixelRatio;
      const root = director.root, renderWindow = root?.mainWindow;
      if (root && renderWindow && (renderWindow.width !== pixels.width || renderWindow.height !== pixels.height)) {
        root.resize(pixels.width, pixels.height);
      }
      if (pixels.width / dpr !== plan.frame.width || pixels.height / dpr !== plan.frame.height) relayout();
    };
    const onCanvasResize = () => {
      relayout();
      if (disposed || frameCheckPending || !isValid(this, true)) return;
      // Creator's native device toolbar can finish hiding after its only resize event.
      // Coalesce one next-frame public-size check; ordinary stable resizes do no extra layout.
      frameCheckPending = true;
      this.scheduleOnce(reconcileFrame, 0);
    };
    view.on('canvas-resize', onCanvasResize);
    relayout();
    return {
      status: () => {
        const offset = !disposed && isValid(scroll, true) ? scroll.getScrollOffset() : { x: 0, y: 0 };
        const max = !disposed && isValid(scroll, true) ? scroll.getMaxScrollOffset() : { x: 0, y: 0 };
        return { mode: plan.mode, frame: { ...plan.frame }, design: { ...plan.design }, viewport: { ...plan.viewport },
          contentHeight, scrollOffset: { x: offset.x, y: offset.y }, maxScrollOffset: { x: max.x, y: max.y } };
      },
      selectPanel: (next) => { panel = next; relayout(); },
      dispose: () => {
        if (!disposed) {
          disposed = true;
          view.off('canvas-resize', onCanvasResize);
          this.unschedule(reconcileFrame);
          frameCheckPending = false;
        }
      }
    };
  }

  private makePanel(parent: Node, name: string): Node {
    const panel = new Node(name);
    panel.layer = Layers.Enum.UI_2D;
    parent.addChild(panel);
    panel.addComponent(UITransform).setContentSize(960, 640);
    return panel;
  }

  private updateEditTabOrder(inputs: readonly EditBox[], compact: boolean): void {
    // Creator's Web Tab traversal retains initialized inputs after their page is hidden.
    // In compact mode another same-page input can also be outside the Mask: Tab ends editing,
    // while the player explicitly touches the next field. Desktop keeps visible-page traversal.
    const available = compact ? [] : inputs.filter(input => input.enabled && input.node.activeInHierarchy);
    for (const input of inputs) if (!available.includes(input) && input.tabIndex !== -1) input.tabIndex = -1;
    available.forEach((input, index) => { if (input.tabIndex !== index) input.tabIndex = index; });
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

  private cookingRejection(code: string): string {
    if (code.startsWith('ERR_MENU_RECIPE_ROLE_MISSING:')) return '必需食材角色未选';
    if (code.startsWith('ERR_STORAGE_FORM_NOT_SUPPORTED')) return '该位置不支持菜品';
    if (code.startsWith('ERR_STORAGE_CAPACITY_OVERFLOW')) return '菜品储存空间不足';
    if (code === 'ERR_NOT_ENOUGH_FUEL') return '燃料不足';
    if (code === 'ERR_NOT_ENOUGH_RESOURCE') return '材料数量不足';
    if (code === 'ERR_COOKING_TECHNIQUE_MISMATCH') return '火候不符合当前配方';
    if (code === 'ERR_COOKING_OPERATION_PROFILE_INVALID') return '请调整操作分钟数';
    return '请检查食材与数量';
  }

  private makeQuantityInput(parent: Node, x: number, y: number, name = 'SplitQuantity', placeholderText = '输入拆分数量', width = 270): EditBox {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(width, 44);
    const background = new Node('Background');
    background.layer = Layers.Enum.UI_2D;
    node.addChild(background);
    background.addComponent(UITransform).setContentSize(width, 44);
    const graphics = background.addComponent(Graphics);
    graphics.fillColor = new Color(40, 57, 70, 255);
    graphics.roundRect(-width / 2, -22, width, 44, 6);
    graphics.fill();
    const text = this.makeSectionLabel(node, 'Text', '', 0, 0, width - 20, 20);
    const placeholder = this.makeSectionLabel(node, 'Placeholder', placeholderText, 0, 0, width - 20, 18);
    for (const label of [text, placeholder]) {
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
}
