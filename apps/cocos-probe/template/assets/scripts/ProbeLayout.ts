export type ProbePanelName = 'farming' | 'inventory' | 'processing' | 'cooking' | 'orders';
export interface ProbeLayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize?: number;
  readonly wrap?: boolean;
}
export interface ProbeLayoutPlan {
  readonly mode: 'desktop' | 'compact';
  readonly frame: { readonly width: number; readonly height: number };
  readonly design: { readonly width: number; readonly height: number };
  readonly viewport: ProbeLayoutRect;
  readonly fixed: Readonly<Record<string, ProbeLayoutRect>>;
  readonly panels: Readonly<Record<ProbePanelName, {
    readonly height: number;
    readonly nodes: Readonly<Record<string, ProbeLayoutRect>>;
  }>>;
}

const PANEL_NAMES: readonly ProbePanelName[] = ['farming', 'inventory', 'processing', 'cooking', 'orders'];
const emptyPanels = () => Object.fromEntries(PANEL_NAMES.map(name => [name, { height: 640, nodes: {} }])) as ProbeLayoutPlan['panels'];

// Layout data only. Selection, quantities and commands remain in the existing public player flow.
export function createProbeLayout(width: number, height: number): ProbeLayoutPlan {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('ERR_PROBE_LAYOUT_FRAME_INVALID');
  }
  const frame = { width, height };
  if (width < height || width > 1000 || height >= 600) {
    return { mode: 'desktop', frame, design: { width: 960, height: 640 },
      viewport: { x: 0, y: 0, width, height }, fixed: {}, panels: emptyPanels() };
  }
  // The supported landscape contract starts at 800x250 (including a simulated keyboard contraction).
  // Other dimensions are outside this version's verified viewport contract.
  const design = { width, height };
  const margin = Math.min(8, width / 20);
  const gap = 8;
  const fixed: Record<string, ProbeLayoutRect> = {
    Title: { x: margin, y: 6, width: width * .64 - margin, height: 28, fontSize: 18 },
    Time: { x: width * .64, y: 6, width: width * .36 - margin, height: 28, fontSize: 16 },
    Status: { x: margin, y: height - 47, width: width * .3 - margin, height: 22, fontSize: 14 },
    Operation: { x: width * .3, y: height - 47, width: width * .7 - margin, height: 22, fontSize: 14 },
    LocalSaveHint: { x: margin, y: height - 24, width: width - margin * 2, height: 20, fontSize: 14 }
  };
  const tabWidth = (width - margin * 2 - gap * 4) / 5;
  for (const [index, name] of ['OpenFarming', 'OpenInventory', 'OpenProcessing', 'OpenCooking', 'OpenOrders'].entries()) {
    fixed[name] = { x: margin + index * (tabWidth + gap), y: 40, width: tabWidth, height: 44, fontSize: 16 };
  }
  const commandWidth = (width - margin * 2 - gap * 3) / 4;
  for (const [index, name] of ['AdvanceOneHour', 'AdvanceOneDay', 'SaveLocal', 'LoadLocal'].entries()) {
    fixed[name] = { x: margin + index * (commandWidth + gap), y: height - 98, width: commandWidth, height: 44, fontSize: 16 };
  }
  const viewport = { x: margin, y: 92, width: width - margin * 2, height: Math.max(24, height - 196) };
  const padding = 12;
  const columnGap = 16;
  const columnWidth = (viewport.width - padding * 2 - columnGap) / 2;
  const panels = {} as Record<ProbePanelName, { height: number; nodes: Record<string, ProbeLayoutRect> }>;
  for (const name of PANEL_NAMES) panels[name] = { height: 0, nodes: {} };
  function column(panel: ProbePanelName, side: 0 | 1) {
    let y = 8;
    const x = padding + side * (columnWidth + columnGap);
    const nodes = panels[panel].nodes;
    const put = (name: string, rect: ProbeLayoutRect) => {
      if (nodes[name]) throw new Error('ERR_PROBE_LAYOUT_DUPLICATE_NODE');
      nodes[name] = rect;
      panels[panel].height = Math.max(panels[panel].height, rect.y + rect.height + 12);
    };
    return {
      label(name: string, height = 26, wrap = false, fontSize = 14) {
        put(name, { x, y, width: columnWidth, height, fontSize, wrap }); y += height + 6;
      },
      button(name: string) { put(name, { x, y, width: columnWidth, height: 44, fontSize: 16 }); y += 52; },
      input(name: string, unit: string) {
        put(name, { x, y, width: columnWidth - 66, height: 44, fontSize: 16 });
        put(unit, { x: x + columnWidth - 58, y, width: 58, height: 44, fontSize: 16 }); y += 52;
      },
      pair(left: string, right: string) {
        const half = (columnWidth - gap) / 2;
        put(left, { x, y, width: half, height: 44, fontSize: 16 });
        put(right, { x: x + half + gap, y, width: half, height: 44, fontSize: 16 }); y += 52;
      },
      amount() {
        put('SeedAmountDecrease', { x, y, width: 64, height: 44, fontSize: 18 });
        put('SeedAmount', { x: x + 72, y, width: columnWidth - 144, height: 44, fontSize: 18 });
        put('SeedAmountIncrease', { x: x + columnWidth - 64, y, width: 64, height: 44, fontSize: 18 }); y += 52;
      }
    };
  }
  const farmLeft = column('farming', 0), farmRight = column('farming', 1);
  farmLeft.label('FieldSummary'); farmLeft.button('SelectField');
  farmLeft.label('SeedSummary'); farmLeft.button('SelectSeed');
  farmLeft.label('CropSummary'); farmLeft.button('SelectCrop');
  farmRight.label('InventorySummary', 62, true);
  farmRight.amount(); farmRight.button('PlantCrop'); farmRight.button('HarvestCrop');

  const stockLeft = column('inventory', 0), stockRight = column('inventory', 1);
  stockLeft.label('InventoryLot'); stockLeft.button('SelectInventoryLot');
  for (const name of ['InventoryForm', 'InventoryQuantity', 'InventoryLocation', 'InventoryTarget']) stockLeft.label(name);
  stockLeft.button('SelectStorageTarget'); stockLeft.label('InventoryCapacity');
  stockLeft.label('InventoryHint', 44, true); stockLeft.button('MoveInventoryLot');
  stockRight.label('SplitHeading', 28, false, 18);
  stockRight.input('SplitQuantity', 'SplitUnit'); stockRight.label('SplitSelection', 44, true);
  stockRight.label('SplitPreviewSummary', 62, true); stockRight.pair('SplitPreview', 'SplitConfirm');
  stockRight.label('SplitResult', 80, true);

  const processLeft = column('processing', 0), processRight = column('processing', 1);
  processLeft.label('ProcessingMethod', 44, true); processLeft.pair('SelectProcessingMethod', 'SelectProcessingFacility');
  processLeft.label('ProcessingFacility', 44, true); processLeft.label('ProcessingRequirement', 62, true);
  processLeft.pair('SelectProcessingInput', 'SelectProcessingLot'); processLeft.label('ProcessingLot', 44, true);
  processLeft.input('ProcessingQuantity', 'ProcessingUnit'); processLeft.pair('ProcessingPreview', 'StartProcessing');
  processRight.label('ProcessingSelection', 80, true); processRight.label('ProcessingPreviewSummary', 62, true);
  processRight.button('SelectProcessingTask'); processRight.label('ProcessingTask', 112, true);
  processRight.button('CollectProcessing'); processRight.label('ProcessingResult', 80, true);

  const cookLeft = column('cooking', 0), cookRight = column('cooking', 1);
  cookLeft.label('CookingRecipe', 44, true); cookLeft.button('SelectCookingRecipe');
  cookLeft.label('CookingRole', 62, true); cookLeft.pair('SelectCookingRole', 'SelectCookingLot');
  cookLeft.label('CookingLot', 44, true); cookLeft.input('CookingQuantity', 'CookingUnit');
  cookLeft.button('ClearCookingRole'); cookLeft.label('CookingSelection', 112, true);
  cookRight.label('CookingOperation', 80, true);
  cookRight.pair('SelectCookingHeat', 'CookingMinutes');
  cookRight.label('CookingTarget', 44, true); cookRight.button('SelectCookingStorage');
  cookRight.label('CookingFuel', 62, true); cookRight.label('CookingPreviewSummary', 62, true);
  cookRight.pair('CookingPreview', 'CookDish'); cookRight.label('CookingResult', 80, true);
  cookRight.label('CookingDishes', 96, true);

  const orderLeft = column('orders', 0), orderRight = column('orders', 1);
  orderLeft.label('OrderName', 44, true); orderLeft.button('SelectOrder');
  for (const name of ['OrderState', 'OrderDeadline', 'OrderQuantity']) orderLeft.label(name, 44, true);
  orderLeft.label('OrderDemand', 168, true); orderLeft.label('OrderHistory', 80, true);
  orderRight.label('OrderDish', 44, true); orderRight.button('SelectOrderDish');
  orderRight.label('OrderDishDetail', 80, true); orderRight.label('OrderMoney');
  orderRight.label('OrderReputation', 44, true); orderRight.label('OrderPreviewSummary', 62, true);
  orderRight.pair('OrderPreview', 'SubmitOrder'); orderRight.label('OrderResult', 80, true);
  return { mode: 'compact', frame, design, viewport, fixed, panels };
}
