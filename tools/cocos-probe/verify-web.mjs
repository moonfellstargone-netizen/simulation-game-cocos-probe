import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertClickObservation, assertDisabledInventoryObservation, assertFarmingCommandObservation, assertFarmingLoadRecovery, assertFarmingProjection, assertInventoryCommandObservation, assertInventoryLoadRecovery, assertInventoryProjection, assertLocalInventoryObservation, assertLocalSaveRecovery, assertLocalSelectionObservation, assertSplitConfirmObservation, assertSplitDisabledObservation, assertSplitLoadRecovery, assertSplitPreviewObservation, assertSplitProjection, assertSplitQuantityObservation, assertStoredSaveUnchanged, assertUiCommandObservation, createWebReportDirectory, parseWebProbeArgs, readWebProbeSource, resizeViewports, serveWebProbe, sha256, timeInMinutes, webTreeDigest } from './lib/webProbeSupport.mjs';

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const MATRIX = [
  { width: 1440, height: 1200, dpr: 1 }, { width: 1280, height: 720, dpr: 1 },
  { width: 960, height: 640, dpr: 1 }, { width: 800, height: 600, dpr: 1 },
  { width: 960, height: 640, dpr: 2 }
];
const settle = (page) => page.evaluate(() => new Promise((accept) => requestAnimationFrame(() => requestAnimationFrame(accept))));
const status = (page) => page.evaluate(() => globalThis.__cocosWebProbe.status());
const scroll = (page) => page.evaluate(() => ({ x: scrollX, y: scrollY }));
const SELECTION_BUTTONS = ['SelectField', 'SelectSeed', 'SelectCrop', 'SeedAmountDecrease', 'SeedAmountIncrease'];
const INVENTORY_LOCAL_BUTTONS = ['OpenInventory', 'OpenFarming', 'SelectInventoryLot', 'SelectStorageTarget'];
const BUTTONS = ['AdvanceOneHour', 'SaveLocal', 'LoadLocal', ...SELECTION_BUTTONS, 'PlantCrop', 'AdvanceOneDay', 'HarvestCrop', ...INVENTORY_LOCAL_BUTTONS, 'MoveInventoryLot', 'SplitPreview', 'SplitConfirm'];
const STORAGE_KEY = 'qinglan.simulation-game.cocos-probe.save.web_probe';
const EMPTY_SLOT_ERROR = 'ERR_SAVE_SLOT_NOT_FOUND:web_probe';

async function awaitReady(page) {
  await page.waitForFunction(() => ['ready', 'failed'].includes(globalThis.__cocosWebProbe?.status().phase), {}, { timeout: 30000 });
  const initial = await status(page);
  assert.equal(initial.phase, 'ready', JSON.stringify(initial));
  assert.equal(initial.hasSession, true);
  assert.equal(initial.displayedTime, initial.timeLabel);
  await settle(page);
}

async function attachButtonObservation(page) {
  await page.evaluate(async (names) => {
    const cc = await System.import('cc');
    const buttons = cc.director.getScene().getComponentsInChildren(cc.Button);
    globalThis.__webProbeButtonEvents = Object.fromEntries(names.map((name) => [name, 0]));
    for (const name of names) {
      const matches = buttons.filter((item) => item.node.name === name);
      if (matches.length !== 1) throw new Error('ERR_WEB_PROBE_BUTTON_MISSING_OR_DUPLICATE:' + name);
      matches[0].node.on(cc.Button.EventType.CLICK, () => { globalThis.__webProbeButtonEvents[name]++; });
    }
    const edits = cc.director.getScene().getComponentsInChildren(cc.EditBox).filter((item) => item.node.name === 'SplitQuantity');
    if (edits.length !== 1) throw new Error('ERR_WEB_PROBE_SPLIT_INPUT_MISSING_OR_DUPLICATE');
    globalThis.__webProbeEditEvents = { began: 0, changed: 0, ended: 0 };
    for (const [key, event] of [['began', cc.EditBox.EventType.EDITING_DID_BEGAN], ['changed', cc.EditBox.EventType.TEXT_CHANGED], ['ended', cc.EditBox.EventType.EDITING_DID_ENDED]]) {
      edits[0].node.on(event, () => { globalThis.__webProbeEditEvents[key]++; });
    }
  }, BUTTONS);
}

async function physicalClick(page, caseName, result, recordDir, buttonName = 'AdvanceOneHour', expected) {
  await settle(page);
  const disabled = expected?.disabled === true;
  const layout = await page.evaluate(async ({ name, disabled }) => {
    const cc = await System.import('cc');
    const scene = cc.director.getScene();
    const button = scene.getComponentsInChildren(cc.Button).find((item) => item.node.name === name);
    if (!button || (!disabled && !button.interactable)) throw new Error('ERR_WEB_PROBE_BUTTON_NOT_INTERACTABLE:' + name);
    if (disabled && button.interactable) throw new Error('ERR_WEB_PROBE_BUTTON_EXPECTED_DISABLED:' + name);
    if (!button.node.activeInHierarchy) throw new Error('ERR_WEB_PROBE_BUTTON_PANEL_INACTIVE:' + name);
    const camera = scene.getComponentsInChildren(cc.Camera).find((item) => item.node.name === 'ProbeCamera');
    const transform = button.node.getComponent(cc.UITransform);
    const element = document.querySelector('#GameCanvas');
    const rectangle = element.getBoundingClientRect();
    function cssPoint(world) {
      const screen = camera.worldToScreen(world);
      return { x: rectangle.left + rectangle.width * screen.x / element.width, y: rectangle.top + rectangle.height * (1 - screen.y / element.height) };
    }
    const corners = [
      [-transform.anchorPoint.x * transform.width, -transform.anchorPoint.y * transform.height],
      [(1 - transform.anchorPoint.x) * transform.width, (1 - transform.anchorPoint.y) * transform.height]
    ].map(([x, y]) => cssPoint(transform.convertToWorldSpaceAR(new cc.Vec3(x, y, 0))));
    const buttonRect = { left: Math.min(...corners.map((p) => p.x)), top: Math.min(...corners.map((p) => p.y)), right: Math.max(...corners.map((p) => p.x)), bottom: Math.max(...corners.map((p) => p.y)) };
    return {
      canvas: { left: rectangle.left, top: rectangle.top, right: rectangle.right, bottom: rectangle.bottom, width: rectangle.width, height: rectangle.height },
      button: { ...buttonRect, width: buttonRect.right - buttonRect.left, height: buttonRect.bottom - buttonRect.top },
      buttonInteractable: button.interactable,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      target: cssPoint(button.node.worldPosition)
    };
  }, { name: buttonName, disabled });
  const before = await status(page);
  const countBefore = await page.evaluate((name) => globalThis.__webProbeButtonEvents[name], buttonName);
  const scrollBefore = await scroll(page);
  assert.ok(layout.target.x >= 0 && layout.target.x < layout.viewport.width && layout.target.y >= 0 && layout.target.y < layout.viewport.height, 'physical target must be inside the viewport');
  // Keep the same physical pointer coordinates through down/up. Never scroll, retry or retarget a failed click.
  await page.mouse.move(layout.target.x, layout.target.y);
  await page.mouse.down();
  await settle(page);
  const scrollDown = await scroll(page);
  await page.mouse.up();
  await settle(page);
  await page.waitForFunction(() => !globalThis.__cocosWebProbe.status().busy, {}, { timeout: 10000 });
  const observation = { caseName, buttonName, layout, before, after: await status(page), eventCount: await page.evaluate((name) => globalThis.__webProbeButtonEvents[name], buttonName) - countBefore, scrollBefore, scrollDown, scrollAfter: await scroll(page) };
  result.clicks.push(observation);
  await page.screenshot({ path: join(recordDir, caseName + '.png'), fullPage: true });
  if (disabled) {
    if (buttonName === 'SplitPreview' || buttonName === 'SplitConfirm') assertSplitDisabledObservation(observation, buttonName);
    else { assert.equal(buttonName, 'MoveInventoryLot'); assertDisabledInventoryObservation(observation); }
  } else if (buttonName === 'SplitPreview') {
    assertSplitPreviewObservation(observation, expected);
  } else if (buttonName === 'SplitConfirm') {
    assertSplitConfirmObservation(observation, expected);
  } else if (INVENTORY_LOCAL_BUTTONS.includes(buttonName)) {
    assertLocalInventoryObservation(observation, expected);
  } else if (buttonName === 'MoveInventoryLot') {
    assertInventoryCommandObservation(observation, expected);
  } else if (SELECTION_BUTTONS.includes(buttonName)) {
    assertLocalSelectionObservation(observation, expected);
  } else if (buttonName === 'PlantCrop' || buttonName === 'AdvanceOneDay' || buttonName === 'HarvestCrop') {
    assertFarmingCommandObservation(observation, expected);
  } else if (buttonName === 'AdvanceOneHour') {
    assertClickObservation(observation);
    assertUiCommandObservation(observation, { name: 'menu_confirm', status: 'completed', timeLabel: observation.after.timeLabel });
  } else {
    assertUiCommandObservation(observation, expected);
  }
  return observation;
}

async function physicalSplitInput(page, caseName, text, result, recordDir) {
  await settle(page);
  // Read geometry and event counters only. All text changes below come from real mouse/keyboard input.
  const readLayout = () => page.evaluate(async () => {
    const cc = await System.import('cc');
    const scene = cc.director.getScene();
    const edit = scene.getComponentsInChildren(cc.EditBox).find((item) => item.node.name === 'SplitQuantity');
    if (!edit?.enabledInHierarchy || !edit.node.activeInHierarchy) throw new Error('ERR_WEB_PROBE_SPLIT_INPUT_INACTIVE');
    const camera = scene.getComponentsInChildren(cc.Camera).find((item) => item.node.name === 'ProbeCamera');
    const transform = edit.node.getComponent(cc.UITransform);
    const canvas = document.querySelector('#GameCanvas'); const rectangle = canvas.getBoundingClientRect();
    const point = (world) => { const p = camera.worldToScreen(world); return { x: rectangle.left + rectangle.width * p.x / canvas.width, y: rectangle.top + rectangle.height * (1 - p.y / canvas.height) }; };
    const bounds = (target) => {
      const xs = [-target.anchorPoint.x * target.width, (1 - target.anchorPoint.x) * target.width];
      const ys = [-target.anchorPoint.y * target.height, (1 - target.anchorPoint.y) * target.height];
      const corners = xs.flatMap((x) => ys.map((y) => point(target.convertToWorldSpaceAR(new cc.Vec3(x, y, 0)))));
      const rectangle = { left: Math.min(...corners.map((p) => p.x)), top: Math.min(...corners.map((p) => p.y)), right: Math.max(...corners.map((p) => p.x)), bottom: Math.max(...corners.map((p) => p.y)) };
      return { ...rectangle, width: rectangle.right - rectangle.left, height: rectangle.bottom - rectangle.top };
    };
    const input = bounds(transform);
    const inputLabels = Object.fromEntries([['text', edit.textLabel], ['placeholder', edit.placeholderLabel]].map(([key, label]) => {
      const labelTransform = label?.node.getComponent(cc.UITransform);
      if (!labelTransform) throw new Error('ERR_WEB_PROBE_SPLIT_INPUT_LABEL_MISSING:' + key);
      return [key, bounds(labelTransform)];
    }));
    return { canvas: { left: rectangle.left, top: rectangle.top, right: rectangle.right, bottom: rectangle.bottom, width: rectangle.width, height: rectangle.height },
      button: input, inputLabels, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, target: point(edit.node.worldPosition) };
  });
  const layout = await readLayout();
  const before = await status(page); const scrollBefore = await scroll(page);
  const counters = await page.evaluate(() => ({ buttons: { ...globalThis.__webProbeButtonEvents }, edit: { ...globalThis.__webProbeEditEvents } }));
  await page.mouse.move(layout.target.x, layout.target.y); await page.mouse.down(); await settle(page);
  const scrollDown = await scroll(page); await page.mouse.up();
  await page.waitForFunction(() => document.activeElement?.classList.contains('cocosEditBox'), {}, { timeout: 5000 });
  await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await page.keyboard.type(text);
  const focused = await page.evaluate(() => ({ className: document.activeElement?.className, value: document.activeElement?.value }));
  await page.keyboard.press('Tab'); await settle(page);
  // Inspect the rendered text/placeholder geometry again after the real edit and blur.
  layout.inputLabels = (await readLayout()).inputLabels;
  const afterCounters = await page.evaluate(() => ({ buttons: { ...globalThis.__webProbeButtonEvents }, edit: { ...globalThis.__webProbeEditEvents } }));
  const observation = { caseName, text, layout, focused, before, after: await status(page),
    eventCount: BUTTONS.reduce((sum, name) => sum + afterCounters.buttons[name] - counters.buttons[name], 0),
    editEvents: Object.fromEntries(['began', 'changed', 'ended'].map((key) => [key, afterCounters.edit[key] - counters.edit[key]])),
    scrollBefore, scrollDown, scrollAfter: await scroll(page) };
  result.inputs.push(observation);
  await page.screenshot({ path: join(recordDir, caseName + '.png'), fullPage: true });
  assertSplitQuantityObservation(observation, text);
  return observation;
}

async function chooseSplitLot(page, id, prefix, result, recordDir) {
  const options = (await status(page)).inventory.lotOptions;
  for (let step = 0; step < options.length; step++) {
    const current = (await status(page)).inventory;
    if (current.selectedLotId === id) return;
    const index = current.lotOptions.findIndex((lot) => lot.id === current.selectedLotId);
    const next = current.lotOptions[(index + 1) % current.lotOptions.length];
    await physicalClick(page, prefix + '-' + step, result, recordDir, 'SelectInventoryLot', { key: 'selectedLotId', value: next.id });
  }
  assert.equal((await status(page)).inventory.selectedLotId, id, 'bounded physical browsing must select the intended split source');
}

async function previewSplit(page, name, result, recordDir, statusCode = 'OK') {
  return physicalClick(page, name, result, recordDir, 'SplitPreview', {
    status: statusCode === 'OK' ? 'completed' : 'failed', statusCode,
    errorMessage: statusCode === 'OK' ? null : statusCode
  });
}

async function completeSplit(page, name, amount, result, recordDir) {
  await physicalSplitInput(page, name + '-quantity', String(amount), result, recordDir);
  await previewSplit(page, name + '-preview', result, recordDir);
  return physicalClick(page, name + '-confirm', result, recordDir, 'SplitConfirm', { amount });
}

async function emptySlotClick(page, caseName, result, recordDir) {
  const before = await status(page);
  return await physicalClick(page, caseName, result, recordDir, 'LoadLocal', {
    name: 'load', status: 'failed', timeLabel: before.timeLabel, errorMessage: EMPTY_SLOT_ERROR
  });
}

async function saveAdvanceLoad(page, name, result, recordDir) {
  const savedTime = (await status(page)).timeLabel;
  const saved = await physicalClick(page, name + '-save', result, recordDir, 'SaveLocal', { name: 'save', status: 'completed', timeLabel: savedTime });
  const stored = await storedSave(page);
  assert.ok(typeof stored.raw === 'string' && stored.raw.length > 0, 'save must write the browser project key');
  const advanced = await physicalClick(page, name + '-advance-after-save', result, recordDir);
  assertStoredSaveUnchanged(stored, await storedSave(page));
  const loaded = await physicalClick(page, name + '-load', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: savedTime });
  assertStoredSaveUnchanged(stored, await storedSave(page));
  return { saved, advanced, loaded };
}

async function storedSave(page, controlled = false) {
  return await page.evaluate(({ key, controlled }) => ({
    origin: location.origin, key,
    raw: controlled ? globalThis.__webProbeStorageFault.readRaw() : localStorage.getItem(key)
  }), { key: STORAGE_KEY, controlled });
}

const storedEvidence = ({ raw, ...rest }) => ({ ...rest, bytes: raw === null ? null : Buffer.byteLength(raw), sha256: raw === null ? null : sha256(raw) });

async function reloadAndReopenRecovery(page, name, saved, result, recordDir, logs) {
  // Navigation uses the same BrowserContext and origin. No test storage replacement is installed here.
  await page.evaluate(() => { globalThis.__webProbePreviousDocument = true; });
  await page.reload();
  await awaitReady(page);
  const initial = await status(page);
  assert.equal(await page.evaluate(() => globalThis.__webProbePreviousDocument), undefined, 'reload must create a new document');
  const afterStartup = await storedSave(page);
  await attachButtonObservation(page);
  const loaded = await physicalClick(page, name + '-reload-load', result, recordDir, 'LoadLocal', {
    name: 'load', status: 'completed', timeLabel: saved.timeLabel
  });
  const afterLoad = await storedSave(page);
  assertLocalSaveRecovery({ saved, initial, afterStartup, loaded, afterLoad });
  const lifecycle = await disposeProbe(page);
  assertStoredSaveUnchanged(saved, await storedSave(page));
  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  let reopen;
  try {
    watchErrors(reopened, name + '-reopen', logs);
    await reopened.goto(result.url); await awaitReady(reopened);
    const initial = await status(reopened);
    const afterStartup = await storedSave(reopened);
    await attachButtonObservation(reopened);
    const loaded = await physicalClick(reopened, name + '-reopen-load', result, recordDir, 'LoadLocal', {
      name: 'load', status: 'completed', timeLabel: saved.timeLabel
    });
    const afterLoad = await storedSave(reopened);
    assertLocalSaveRecovery({ saved, initial, afterStartup, loaded, afterLoad });
    const lifecycle = await disposeProbe(reopened);
    assertStoredSaveUnchanged(saved, await storedSave(reopened));
    reopen = { initial, afterStartup: storedEvidence(afterStartup), loaded, afterLoad: storedEvidence(afterLoad), lifecycle };
  } finally { await reopened.close(); }
  return { saved: storedEvidence(saved), initial, afterStartup: storedEvidence(afterStartup), loaded, afterLoad: storedEvidence(afterLoad), lifecycle, reopen, storageScope: 'same-origin-and-same-BrowserContext; closing a page does not close the browser profile' };
}

async function disposeProbe(page) {
  const before = await status(page);
  assert.equal(before.displayedTime, before.timeLabel);
  const resourceBefore = await page.evaluate(async () => {
    const cc = await System.import('cc');
    globalThis.__webProbeResource = cc.resources.get('probe-resources', cc.JsonAsset);
    if (!globalThis.__webProbeResource) throw new Error('ERR_WEB_PROBE_RESOURCE_NOT_FOUND');
    return globalThis.__webProbeResource.refCount;
  });
  await page.evaluate(() => globalThis.__cocosWebProbe.dispose());
  await page.waitForFunction(() => globalThis.__cocosWebProbe.status().phase === 'closed');
  await settle(page);
  const disposed = await status(page);
  const resourceAfter = await page.evaluate(() => globalThis.__webProbeResource.refCount);
  assert.equal(disposed.hasSession, false);
  assert.equal(disposed.nodeValid, false);
  assert.equal(disposed.displayedTime, null);
  assert.equal(resourceBefore - resourceAfter, 1, 'component must release exactly its retained JsonAsset reference');
  return { before, disposed, resourceBefore, resourceAfter };
}

async function farmingLoop(browser, url, result, recordDir, logs) {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage(); watchErrors(page, 'farming-loop', logs);
    await page.goto(url); await awaitReady(page); await attachButtonObservation(page);
    const initial = await status(page);
    const initialFarming = assertFarmingProjection(initial);
    for (const key of ['selectedFieldId', 'selectedSeedId', 'selectedCropId']) assert.equal(initialFarming[key], null, 'startup must wait for an explicit player selection');
    const field = initialFarming.fieldOptions.find((item) => item.enabled);
    const seed = initialFarming.seedOptions.find((item) => item.enabled);
    assert.ok(field && seed, 'the current public new game must offer a field and seed');
    await physicalClick(page, 'farming-select-field', result, recordDir, 'SelectField', { key: 'selectedFieldId', value: field.id });
    await physicalClick(page, 'farming-select-seed', result, recordDir, 'SelectSeed', { key: 'selectedSeedId', value: seed.id });
    assert.ok(Number.isSafeInteger(seed.quantity.amount) && seed.quantity.amount > 0 && seed.quantity.amount <= 40, 'the real quantity-rejection case needs a bounded count-unit seed batch');
    assert.equal(seed.quantity.unit, 'count', 'the quantity control test must use the public seed unit');
    // Every quantity change is a real player click. Test bounds prevent an unbounded verification loop.
    for (let amount = initialFarming.seedAmount + 1; amount <= seed.quantity.amount + 1; amount++) {
      await physicalClick(page, 'farming-quantity-increase-' + amount, result, recordDir, 'SeedAmountIncrease', { key: 'seedAmount', value: amount });
    }
    const rejected = await physicalClick(page, 'farming-resource-rejected', result, recordDir, 'PlantCrop', {
      actionType: 'plant_crop', status: 'failed', timeLabel: initial.timeLabel, errorMessage: 'ERR_NOT_ENOUGH_RESOURCE'
    });
    assert.match(rejected.after.displayedOperation, /资源不足/, 'business rejection must be visible instead of a success message');
    for (let amount = seed.quantity.amount; amount >= 1; amount--) {
      await physicalClick(page, 'farming-quantity-decrease-' + amount, result, recordDir, 'SeedAmountDecrease', { key: 'seedAmount', value: amount });
    }
    const planted = await physicalClick(page, 'farming-plant', result, recordDir, 'PlantCrop', { actionType: 'plant_crop', status: 'completed', timeLabel: initial.timeLabel });
    const savedState = await status(page);
    await physicalClick(page, 'farming-save-planted', result, recordDir, 'SaveLocal', { name: 'save', status: 'completed', timeLabel: savedState.timeLabel });
    const saved = await storedSave(page);
    assert.ok(typeof saved.raw === 'string' && saved.raw.length > 0);
    const mature = async (prefix) => {
      let days = 0;
      while (!(await status(page)).farming.harvestableOptions.some((item) => item.field_plot_id === field.id && item.enabled)) {
        assert.ok(days < 30, 'the selected crop must become publicly harvestable within the declared verification bound');
        const current = await status(page);
        const next = timeInMinutes(current.timeLabel) + 1440;
        const timeLabel = `day ${Math.floor(next / 1440)} minute ${next % 1440}`;
        await physicalClick(page, prefix + '-day-' + (++days), result, recordDir, 'AdvanceOneDay', { actionType: 'advance_time', status: 'completed', timeLabel });
        assertStoredSaveUnchanged(saved, await storedSave(page));
      }
      return days;
    };
    const beforeLoadDays = await mature('farming-before-load');
    const ripe = (await status(page)).farming.harvestableOptions.find((item) => item.enabled);
    await physicalClick(page, 'farming-select-before-load', result, recordDir, 'SelectCrop', { key: 'selectedCropId', value: ripe.id });
    const loaded = await physicalClick(page, 'farming-load-planted', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: savedState.timeLabel });
    assertFarmingLoadRecovery(savedState, loaded);
    assertStoredSaveUnchanged(saved, await storedSave(page));
    const afterLoadDays = await mature('farming-after-load');
    const restoredRipe = (await status(page)).farming.harvestableOptions.find((item) => item.enabled);
    await physicalClick(page, 'farming-select-restored-crop', result, recordDir, 'SelectCrop', { key: 'selectedCropId', value: restoredRipe.id });
    const harvestTime = (await status(page)).timeLabel;
    const harvested = await physicalClick(page, 'farming-harvest', result, recordDir, 'HarvestCrop', { actionType: 'harvest_crop', status: 'completed', timeLabel: harvestTime });
    assertStoredSaveUnchanged(saved, await storedSave(page));
    await physicalClick(page, 'farming-select-next-field', result, recordDir, 'SelectField', { key: 'selectedFieldId', value: field.id });
    const replanted = await physicalClick(page, 'farming-next-plant', result, recordDir, 'PlantCrop', { actionType: 'plant_crop', status: 'completed', timeLabel: harvestTime });
    const lifecycle = await disposeProbe(page);
    assertStoredSaveUnchanged(saved, await storedSave(page));
    return { scope: 'real physical controls in an isolated 960x640 BrowserContext; public menu projections only', initial, rejected, planted, saved: storedEvidence(saved), savedState, beforeLoadDays, loaded, afterLoadDays, harvested, replanted, lifecycle };
  } finally { await context.close(); }
}

async function inventoryLoop(browser, url, result, recordDir, logs) {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage(); watchErrors(page, 'inventory-loop', logs);
    await page.goto(url); await awaitReady(page); await attachButtonObservation(page);
    const initial = await status(page);
    assert.equal(initial.panel, 'farming');
    const inventory = assertInventoryProjection(initial);
    assert.equal(inventory.selectedLotId, null); assert.equal(inventory.selectedTargetId, null);
    const initialStored = await storedSave(page);
    assert.equal(initialStored.raw, null, 'the inventory context starts without a local save');
    await physicalClick(page, 'inventory-open', result, recordDir, 'OpenInventory', { panel: 'inventory' });
    const browsedLots = [];
    for (const [index, lot] of inventory.lotOptions.entries()) {
      const observation = await physicalClick(page, 'inventory-browse-lot-' + index, result, recordDir, 'SelectInventoryLot', { key: 'selectedLotId', value: lot.id });
      browsedLots.push({ id: lot.id, displayed: observation.after.displayedInventory });
    }
    const browsedTargets = [];
    for (const [index, target] of inventory.targetOptions.entries()) {
      const observation = await physicalClick(page, 'inventory-browse-target-' + index, result, recordDir, 'SelectStorageTarget', { key: 'selectedTargetId', value: target.id });
      browsedTargets.push({ id: target.id, displayed: observation.after.displayedInventory });
    }
    assert.ok(browsedLots.length > 0 && browsedTargets.length > 1, 'all current lots and multiple targets must be browsable');
    const pair = inventory.lotOptions.filter((lot) => lot.enabled).map((lot) => ({
      lot,
      compatible: inventory.targetOptions.find((target) => target.enabled && target.id !== lot.storage_ref.container_id && target.storage_type !== lot.storage_ref.storage_type && target.supported_forms.includes(lot.current_form)),
      incompatible: inventory.targetOptions.find((target) => target.enabled && target.id !== lot.storage_ref.container_id && !target.supported_forms.includes(lot.current_form))
    })).find((candidate) => candidate.compatible && candidate.incompatible);
    assert.ok(pair, 'the canonical public new game must offer a compatible move and a real unsupported-form refusal');
    const choose = async (kind, id, prefix) => {
      const key = kind === 'lot' ? 'selectedLotId' : 'selectedTargetId';
      const collection = kind === 'lot' ? 'lotOptions' : 'targetOptions';
      const button = kind === 'lot' ? 'SelectInventoryLot' : 'SelectStorageTarget';
      const options = (await status(page)).inventory[collection];
      for (let step = 0; step < options.length; step++) {
        const current = (await status(page)).inventory;
        if (current[key] === id) return;
        const index = current[collection].findIndex((item) => item.id === current[key]);
        const next = current[collection][(index + 1) % current[collection].length];
        await physicalClick(page, prefix + '-' + step, result, recordDir, button, { key, value: next.id });
      }
      assert.equal((await status(page)).inventory[key], id, 'bounded physical selection must reach the declared current option');
    };
    await choose('lot', pair.lot.id, 'inventory-select-move-lot');
    await choose('target', pair.incompatible.id, 'inventory-select-incompatible');
    const refused = await physicalClick(page, 'inventory-form-refused', result, recordDir, 'MoveInventoryLot', {
      status: 'failed', timeLabel: initial.timeLabel, errorMessage: 'ERR_STORAGE_FORM_NOT_SUPPORTED'
    });
    assert.match(refused.after.displayedOperation, /不支持/, 'unsupported form must report this business refusal');
    assertStoredSaveUnchanged(initialStored, await storedSave(page));
    await choose('target', pair.compatible.id, 'inventory-select-compatible');
    const moved = await physicalClick(page, 'inventory-move', result, recordDir, 'MoveInventoryLot', { status: 'completed', timeLabel: initial.timeLabel });
    assertStoredSaveUnchanged(initialStored, await storedSave(page));
    assert.equal(moved.after.inventory.canMove, false);
    assert.match(moved.after.displayedInventory.hint, /已在/, 'the same-container disabled action needs a visible explanation');
    const disabled = await physicalClick(page, 'inventory-same-target-disabled', result, recordDir, 'MoveInventoryLot', { disabled: true });
    await physicalClick(page, 'inventory-save-moved', result, recordDir, 'SaveLocal', { name: 'save', status: 'completed', timeLabel: initial.timeLabel });
    const savedState = await status(page); const saved = await storedSave(page);
    assert.ok(typeof saved.raw === 'string' && saved.raw.length > 0);
    await choose('target', pair.lot.storage_ref.container_id, 'inventory-select-original-target');
    const movedBack = await physicalClick(page, 'inventory-move-back', result, recordDir, 'MoveInventoryLot', { status: 'completed', timeLabel: initial.timeLabel });
    assertStoredSaveUnchanged(saved, await storedSave(page));
    const loaded = await physicalClick(page, 'inventory-load-moved', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: initial.timeLabel });
    assertInventoryLoadRecovery(savedState, loaded); assertStoredSaveUnchanged(saved, await storedSave(page));
    await physicalClick(page, 'inventory-return-farming', result, recordDir, 'OpenFarming', { panel: 'farming' });
    const continued = await physicalClick(page, 'inventory-continue-hour', result, recordDir);
    assertStoredSaveUnchanged(saved, await storedSave(page));
    const lifecycle = await disposeProbe(page); assertStoredSaveUnchanged(saved, await storedSave(page));
    return { scope: 'isolated 960x640 real physical inventory controls; unsupported form refusal, successful moves, same-target disabled input and manual load; capacity-overflow refusal remains Node coverage', initial, browsedLots, browsedTargets, refused, moved, disabled, savedState, saved: storedEvidence(saved), movedBack, loaded, continued, lifecycle };
  } finally { await context.close(); }
}

async function splitLoop(browser, url, result, recordDir, logs) {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  try {
    let page = await context.newPage(); watchErrors(page, 'split-loop', logs);
    await page.goto(url); await awaitReady(page); await attachButtonObservation(page);
    const initial = await status(page); const farm = assertFarmingProjection(initial);
    const field = farm.fieldOptions.find((item) => item.enabled); const seed = farm.seedOptions.find((item) => item.enabled);
    assert.ok(field && seed);
    const initiallyStored = await storedSave(page); assert.equal(initiallyStored.raw, null);
    await physicalClick(page, 'split-farm-field', result, recordDir, 'SelectField', { key: 'selectedFieldId', value: field.id });
    await physicalClick(page, 'split-farm-seed', result, recordDir, 'SelectSeed', { key: 'selectedSeedId', value: seed.id });
    await physicalClick(page, 'split-farm-plant', result, recordDir, 'PlantCrop', { actionType: 'plant_crop', status: 'completed', timeLabel: initial.timeLabel });
    for (let days = 0; !(await status(page)).farming.harvestableOptions.some((crop) => crop.enabled); days++) {
      assert.ok(days < 30, 'ordinary time must mature the planted crop within the bounded browser case');
      const next = timeInMinutes((await status(page)).timeLabel) + 1440;
      await physicalClick(page, 'split-farm-day-' + days, result, recordDir, 'AdvanceOneDay', { actionType: 'advance_time', status: 'completed', timeLabel: `day ${Math.floor(next / 1440)} minute ${next % 1440}` });
    }
    const mature = await status(page); const crop = mature.farming.harvestableOptions.find((item) => item.enabled);
    await physicalClick(page, 'split-farm-crop', result, recordDir, 'SelectCrop', { key: 'selectedCropId', value: crop.id });
    const harvested = await physicalClick(page, 'split-farm-harvest', result, recordDir, 'HarvestCrop', { actionType: 'harvest_crop', status: 'completed', timeLabel: mature.timeLabel });
    const produce = harvested.after.inventory.lotOptions.find((lot) => !harvested.before.inventory.lotOptions.some((previous) => previous.id === lot.id) && lot.base_id === 'cabbage' && lot.quantity.unit === 'g');
    assert.equal(produce?.quantity.amount, 1200, 'the canonical real harvest must supply the declared 1200g split source');
    await physicalClick(page, 'split-open-inventory', result, recordDir, 'OpenInventory', { panel: 'inventory' });
    await chooseSplitLot(page, produce.id, 'split-choose-produce', result, recordDir);
    await physicalSplitInput(page, 'split-initial-300', '300', result, recordDir);
    const preview = await previewSplit(page, 'split-initial-preview', result, recordDir);
    assertStoredSaveUnchanged(initiallyStored, await storedSave(page));
    await physicalSplitInput(page, 'split-change-invalidates-preview', '301', result, recordDir);
    const staleQuantity = await physicalClick(page, 'split-stale-quantity-disabled', result, recordDir, 'SplitConfirm', { disabled: true });
    const partial = await completeSplit(page, 'split-partial-300', 300, result, recordDir);
    assert.equal(partial.after.inventory.lotOptions.find((lot) => lot.id === produce.id)?.quantity.amount, 900);
    const childId = partial.after.inventory.splitResult.newLotId;
    assertStoredSaveUnchanged(initiallyStored, await storedSave(page));

    await physicalSplitInput(page, 'split-preview-before-source-change', '100', result, recordDir);
    await previewSplit(page, 'split-preview-old-source', result, recordDir);
    await chooseSplitLot(page, childId, 'split-change-source', result, recordDir);
    assert.equal((await status(page)).inventory.splitPreview, null, 'changing the lot invalidates its old preview');
    const staleSource = await physicalClick(page, 'split-stale-source-disabled', result, recordDir, 'SplitConfirm', { disabled: true });
    await physicalSplitInput(page, 'split-zero-input', '0', result, recordDir);
    assert.ok((await status(page)).inventory.splitInputError, 'zero must have visible local validation feedback');
    const zero = await physicalClick(page, 'split-zero-preview-disabled', result, recordDir, 'SplitPreview', { disabled: true });
    await physicalSplitInput(page, 'split-oversized-input', '301', result, recordDir);
    const oversized = await previewSplit(page, 'split-oversized-refused', result, recordDir, 'ERR_NOT_ENOUGH_RESOURCE');
    await physicalClick(page, 'split-oversized-confirm-disabled', result, recordDir, 'SplitConfirm', { disabled: true });

    const countLot = (await status(page)).inventory.lotOptions.find((lot) => lot.id === seed.id && lot.enabled && lot.quantity.unit === 'count' && lot.quantity.amount > 1);
    assert.ok(countLot, 'the formal planting leaves a real count-unit source for integer-only input');
    await chooseSplitLot(page, countLot.id, 'split-count-source', result, recordDir);
    await physicalSplitInput(page, 'split-count-fraction-input', '0.5', result, recordDir);
    const countFraction = await previewSplit(page, 'split-count-fraction-refused', result, recordDir, 'ERR_SPLIT_QUANTITY_INVALID');
    const countHealthy = await completeSplit(page, 'split-count-healthy', 1, result, recordDir);
    assertStoredSaveUnchanged(initiallyStored, await storedSave(page));

    await chooseSplitLot(page, childId, 'split-full-source', result, recordDir);
    const full = await completeSplit(page, 'split-full-300', 300, result, recordDir);
    assert.equal(full.after.inventory.lotOptions.some((lot) => lot.id === childId), false);
    await physicalClick(page, 'split-save', result, recordDir, 'SaveLocal', { name: 'save', status: 'completed', timeLabel: full.after.timeLabel });
    const savedState = await status(page); const saved = { ...await storedSave(page), timeLabel: savedState.timeLabel };
    assert.ok(typeof saved.raw === 'string' && saved.raw.length > 0);
    await chooseSplitLot(page, produce.id, 'split-after-save-source', result, recordDir);
    const transient = await completeSplit(page, 'split-after-save-transient', 100, result, recordDir);
    await chooseSplitLot(page, transient.after.inventory.splitResult.newLotId, 'split-select-transient-before-load', result, recordDir);
    const loaded = await physicalClick(page, 'split-load-saved', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
    assertSplitLoadRecovery(savedState, loaded);
    assert.equal(loaded.after.inventory.selectedLotId, null, 'load clears the selected child absent from the saved world');
    assertStoredSaveUnchanged(saved, await storedSave(page));

    await page.reload(); await awaitReady(page); await attachButtonObservation(page);
    const reloadInitial = await status(page); const reloadStartup = await storedSave(page);
    const reloadLoaded = await physicalClick(page, 'split-refresh-manual-load', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
    assertLocalSaveRecovery({ saved, initial: reloadInitial, afterStartup: reloadStartup, loaded: reloadLoaded, afterLoad: await storedSave(page) });
    assertSplitLoadRecovery(savedState, reloadLoaded);
    await physicalClick(page, 'split-refresh-open-inventory', result, recordDir, 'OpenInventory', { panel: 'inventory' });
    await chooseSplitLot(page, produce.id, 'split-refresh-choose-source', result, recordDir);
    const continuedAfterRefresh = await completeSplit(page, 'split-refresh-continued', 100, result, recordDir);
    assertStoredSaveUnchanged(saved, await storedSave(page));
    await physicalClick(page, 'split-save-continued', result, recordDir, 'SaveLocal', { name: 'save', status: 'completed', timeLabel: saved.timeLabel });
    const reopenSavedState = await status(page); const reopenSaved = { ...await storedSave(page), timeLabel: reopenSavedState.timeLabel };
    const reloadLifecycle = await disposeProbe(page); await page.close();
    page = await context.newPage(); watchErrors(page, 'split-reopen', logs);
    await page.goto(url); await awaitReady(page); await attachButtonObservation(page);
    const reopenInitial = await status(page); const reopenStartup = await storedSave(page);
    const reopenLoaded = await physicalClick(page, 'split-reopen-manual-load', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: reopenSaved.timeLabel });
    assertLocalSaveRecovery({ saved: reopenSaved, initial: reopenInitial, afterStartup: reopenStartup, loaded: reopenLoaded, afterLoad: await storedSave(page) });
    assertSplitLoadRecovery(reopenSavedState, reopenLoaded);
    await physicalClick(page, 'split-reopen-open-inventory', result, recordDir, 'OpenInventory', { panel: 'inventory' });
    await chooseSplitLot(page, produce.id, 'split-reopen-choose-source', result, recordDir);
    const continuedAfterReopen = await completeSplit(page, 'split-reopen-continued', 100, result, recordDir);
    assertStoredSaveUnchanged(reopenSaved, await storedSave(page));
    const lifecycle = await disposeProbe(page); assertStoredSaveUnchanged(reopenSaved, await storedSave(page));
    return { scope: 'isolated 960x640 real mouse and keyboard EditBox inputs on built-web/editor-preview; capacity refusal remains Node coverage',
      initial, harvested, preview, staleQuantity, partial, staleSource, zero, oversized, countFraction, countHealthy, full, saved: storedEvidence(saved), savedState,
      loaded, refresh: { initial: reloadInitial, loaded: reloadLoaded, continued: continuedAfterRefresh, lifecycle: reloadLifecycle },
      reopen: { initial: reopenInitial, loaded: reopenLoaded, continued: continuedAfterReopen, saved: storedEvidence(reopenSaved) }, lifecycle };
  } finally { await context.close(); }
}

async function storageFailureRecovery(browser, url, result, recordDir, logs) {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  try {
    // These switches inject a rejection before the actual native operation. Healthy operations still use native Storage.
    await context.addInitScript(({ key }) => {
      const storage = globalThis.localStorage;
      const read = Storage.prototype.getItem;
      const write = Storage.prototype.setItem;
      const control = {
        mode: 'none', calls: { getter: 0, read: 0, write: 0 },
        readRaw: () => read.call(storage, key),
        writeRaw: (raw) => write.call(storage, key, raw)
      };
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() {
        control.calls.getter++;
        if (control.mode === 'getter') throw new Error('controlled-localStorage-getter');
        return storage;
      } });
      Storage.prototype.getItem = function (requested) {
        if (this === storage && requested === key) {
          control.calls.read++;
          if (control.mode === 'read') throw new Error('controlled-localStorage-read');
        }
        return read.call(this, requested);
      };
      Storage.prototype.setItem = function (requested, value) {
        if (this === storage && requested === key) {
          control.calls.write++;
          if (control.mode === 'write') throw new Error('controlled-localStorage-write');
        }
        return write.call(this, requested, value);
      };
      globalThis.__webProbeStorageFault = control;
    }, { key: STORAGE_KEY });
    const page = await context.newPage(); watchErrors(page, 'storage-controlled-faults', logs);
    await page.goto(url); await awaitReady(page); await attachButtonObservation(page);
    assert.equal((await storedSave(page, true)).raw, null, 'a dedicated context must begin with an empty project slot');
    await physicalClick(page, 'storage-fault-advance', result, recordDir);
    await physicalClick(page, 'storage-fault-initial-save', result, recordDir, 'SaveLocal', { name: 'save', status: 'completed', timeLabel: 'day 1 minute 420' });
    const saved = await storedSave(page, true);
    await physicalClick(page, 'storage-fault-advance-after-save', result, recordDir);
    const failures = [];
    for (const [index, fault] of [
      { mode: 'getter', name: 'save' }, { mode: 'getter', name: 'load' },
      { mode: 'read', name: 'load' }, { mode: 'write', name: 'save' }
    ].entries()) {
      const before = await storedSave(page, true);
      const countersBefore = await page.evaluate((mode) => {
        globalThis.__webProbeStorageFault.mode = mode;
        return { ...globalThis.__webProbeStorageFault.calls };
      }, fault.mode);
      const failed = await physicalClick(page, 'storage-fault-' + index, result, recordDir, fault.name === 'save' ? 'SaveLocal' : 'LoadLocal', {
        name: fault.name, status: 'failed', timeLabel: 'day 1 minute 480', errorMessage: 'controlled-localStorage-' + fault.mode
      });
      const after = await storedSave(page, true);
      assertStoredSaveUnchanged(before, after);
      const countersAfter = await page.evaluate(() => ({ ...globalThis.__webProbeStorageFault.calls }));
      assert.equal(countersAfter[fault.mode] - countersBefore[fault.mode], 1, 'the rejected operation must be attempted once without fallback or retry');
      await page.evaluate(() => { globalThis.__webProbeStorageFault.mode = 'none'; });
      const healthyLoad = await physicalClick(page, 'storage-fault-' + index + '-healthy-load', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: 'day 1 minute 420' });
      const healthySave = await physicalClick(page, 'storage-fault-' + index + '-healthy-save', result, recordDir, 'SaveLocal', { name: 'save', status: 'completed', timeLabel: 'day 1 minute 420' });
      assertStoredSaveUnchanged(saved, await storedSave(page, true));
      await physicalClick(page, 'storage-fault-' + index + '-continue', result, recordDir);
      failures.push({ ...fault, injected: 'controlled-browser-rejection-before-native-operation; no real quota or policy exhaustion claimed', failed, preserved: storedEvidence(after), countersBefore, countersAfter, healthyLoad, healthySave });
    }
    const invalid = [
      { name: 'json', raw: '{', prefix: 'ERR_COCOS_SESSION_LOAD_REJECTED:web_probe:' },
      { name: 'schema', raw: '{}', prefix: 'ERR_COCOS_SESSION_LOAD_REJECTED:web_probe:ERR_COCOS_SESSION_VALIDATION_FAILED:load_candidate_before_commit:ERR_SCHEMA_VALIDATION_FAILED:' },
      { name: 'audit', raw: (() => {
        const value = JSON.parse(saved.raw);
        assert.ok(value.storage_containers?.length > 0, 'audit fixture requires a real saved container');
        value.storage_containers[0].used_capacity += 1;
        return JSON.stringify(value);
      })(), prefix: 'ERR_COCOS_SESSION_LOAD_REJECTED:web_probe:ERR_COCOS_SESSION_VALIDATION_FAILED:load_candidate_before_commit:ERR_STORAGE_AUDIT_FAILED:' }
    ];
    const badSaves = [];
    for (const bad of invalid) {
      await page.evaluate((raw) => globalThis.__webProbeStorageFault.writeRaw(raw), bad.raw);
      const before = await storedSave(page, true);
      const failed = await physicalClick(page, 'storage-invalid-' + bad.name, result, recordDir, 'LoadLocal', {
        name: 'load', status: 'failed', timeLabel: 'day 1 minute 480', errorMessagePrefix: bad.prefix
      });
      assertStoredSaveUnchanged(before, await storedSave(page, true));
      await page.evaluate((raw) => globalThis.__webProbeStorageFault.writeRaw(raw), saved.raw);
      const healthyLoad = await physicalClick(page, 'storage-invalid-' + bad.name + '-healthy-load', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: 'day 1 minute 420' });
      assertStoredSaveUnchanged(saved, await storedSave(page, true));
      await physicalClick(page, 'storage-invalid-' + bad.name + '-continue', result, recordDir);
      badSaves.push({ name: bad.name, injected: 'deliberately invalid raw string in an isolated browser context', rejected: storedEvidence(before), failed, healthyLoad });
    }
    const lifecycle = await disposeProbe(page);
    assertStoredSaveUnchanged(saved, await storedSave(page, true));
    return { storageScope: 'isolated BrowserContext; real native localStorage with controlled rejection hooks', failures, badSaves, lifecycle };
  } finally { await context.close(); }
}

function watchErrors(page, name, logs) {
  page.on('console', (message) => logs.push({ caseName: name, type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => logs.push({ caseName: name, type: 'pageerror', text: error.message }));
}

export async function verifyWebProbe(options) {
  const parsed = parseWebProbeArgs(Object.entries({ '--project': options.project, '--browser': options.browser, '--report-dir': options.reportDir, '--build-record': options.buildRecord, ...(options.previewUrl ? { '--preview-url': options.previewUrl } : {}) }).flat());
  const projectDir = realpathSync(parsed.project);
  const recordDir = createWebReportDirectory(ROOT, parsed.reportDir, projectDir);
  const result = { format: 'cocos-web-verification/v1', startedAt: new Date().toISOString(), passed: false, mode: parsed.previewUrl ? 'editor-preview' : 'built-web', recordDir, clicks: [], inputs: [] };
  const logs = [];
  let browser;
  let server;
  try {
    const source = readWebProbeSource({ rootDir: ROOT, project: projectDir, buildRecord: parsed.buildRecord });
    Object.assign(result, { sourceCommit: source.manifest.sourceCommit, sourceDirty: source.manifest.sourceDirty, version: source.manifest.version, creatorVersion: source.creatorVersion, preparedManifestSha256: source.preparedManifestSha256, buildRecordSha256: source.buildRecordSha256, toolSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), supportSha256: sha256(readFileSync(new URL('./lib/webProbeSupport.mjs', import.meta.url))) });
    if (!existsSync(parsed.browser)) throw new Error('ERR_WEB_PROBE_BROWSER_MISSING');
    result.browserExecutableSha256 = sha256(readFileSync(parsed.browser));
    if (!parsed.previewUrl) {
      result.webBuild = source.webBuild;
      server = await serveWebProbe(join(projectDir, 'build/web-desktop'));
    } else {
      result.previewSourceLimit = 'Project provenance is checked; build record does not prove the live preview content hash.';
    }
    result.url = parsed.previewUrl ?? server.url;
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ headless: true, executablePath: parsed.browser, args: ['--no-first-run', '--disable-default-apps', '--enable-unsafe-swiftshader'] });
    result.browserVersion = browser.version();
    let resourceUrl;
    const matrix = parsed.previewUrl ? [MATRIX[0], MATRIX[2]] : MATRIX;
    for (const item of matrix) {
      const name = `viewport-${item.width}x${item.height}-dpr${item.dpr}`;
      const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, deviceScaleFactor: item.dpr });
      try {
        const page = await context.newPage();
        watchErrors(page, name, logs);
        page.on('response', async (response) => {
          if (!resourceUrl && response.url().includes('/assets/resources/') && response.url().endsWith('.json')) {
            try { if ((await response.text()).includes('source_config_profile')) resourceUrl = response.url(); } catch { /* Context may close after an unrelated response. */ }
          }
        });
        await page.goto(result.url);
        await awaitReady(page);
        await attachButtonObservation(page);
        await emptySlotClick(page, name + '-empty-load', result, recordDir);
        const observation = await physicalClick(page, name, result, recordDir);
        assert.equal(observation.layout.viewport.dpr, item.dpr, 'browser must use the requested device pixel ratio');
        await physicalClick(page, name + '-save', result, recordDir, 'SaveLocal', { name: 'save', status: 'completed', timeLabel: 'day 1 minute 420' });
        const saved = { ...await storedSave(page), timeLabel: 'day 1 minute 420' };
        await physicalClick(page, name + '-advance-after-save', result, recordDir);
        assert.equal((await status(page)).timeLabel, 'day 1 minute 480');
        assertStoredSaveUnchanged(saved, await storedSave(page));
        const recovery = await reloadAndReopenRecovery(page, name, saved, result, recordDir, logs);
        (result.lifecycles ??= []).push({ caseName: name, ...recovery.lifecycle });
        (result.refreshes ??= []).push({ caseName: name, ...recovery });
      } finally { await context.close(); }
    }
    const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage(); watchErrors(page, 'resize', logs);
      await page.goto(result.url); await awaitReady(page); await attachButtonObservation(page);
      await page.evaluate(async (names) => {
        const cc = await System.import('cc');
        const buttons = cc.director.getScene().getComponentsInChildren(cc.Button);
        globalThis.__webProbeResizeIdentity = {
          observer: globalThis.__cocosWebProbe,
          nodes: Object.fromEntries(names.map((name) => [name, buttons.find((item) => item.node.name === name).node]))
        };
      }, BUTTONS);
      for (const [i, viewport] of resizeViewports(Boolean(parsed.previewUrl)).entries()) {
        const before = await status(page);
        await page.setViewportSize(viewport); await settle(page);
        const after = await status(page);
        assert.equal(after.timeLabel, before.timeLabel, 'resize must retain the same session time');
        assert.equal(await page.evaluate(async (names) => {
          const cc = await System.import('cc');
          const buttons = cc.director.getScene().getComponentsInChildren(cc.Button);
          return globalThis.__webProbeResizeIdentity.observer === globalThis.__cocosWebProbe
            && names.every((name) => globalThis.__webProbeResizeIdentity.nodes[name] === buttons.find((item) => item.node.name === name).node);
        }, BUTTONS), true, 'resize must retain the same public observer and all Button nodes');
        await physicalClick(page, 'resize-' + i, result, recordDir);
        await saveAdvanceLoad(page, 'resize-' + i, result, recordDir);
      }
      result.resizeIdentityVerified = true;
      result.resizeLifecycle = await disposeProbe(page);
    } finally { await context.close(); }
    result.farming = await farmingLoop(browser, result.url, result, recordDir, logs);
    result.inventory = await inventoryLoop(browser, result.url, result, recordDir, logs);
    result.splitting = await splitLoop(browser, result.url, result, recordDir, logs);
    result.storageRecovery = await storageFailureRecovery(browser, result.url, result, recordDir, logs);
    if (!parsed.previewUrl) {
      assert.ok(resourceUrl, 'actual probe resource URL must be observed');
      const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
      try {
        const missing = await context.newPage(); watchErrors(missing, 'missing-resource', logs);
        await missing.route(resourceUrl, (route) => route.fulfill({ status: 404, body: 'missing probe resources' }));
        await missing.goto(result.url);
        await missing.waitForFunction(() => globalThis.__cocosWebProbe?.status().phase === 'failed');
        result.missingResource = await status(missing);
        assert.equal(result.missingResource.hasSession, false); assert.ok(result.missingResource.errors.length > 0);
        await missing.close();
        const early = await context.newPage(); watchErrors(early, 'loading-destroy', logs);
        let release;
        const resumed = new Promise((accept) => { release = accept; });
        await early.route(resourceUrl, async (route) => { await resumed; await route.continue().catch(() => {}); });
        try {
          await early.goto(result.url);
          await early.waitForFunction(() => globalThis.__cocosWebProbe?.status().phase === 'loading');
          await early.evaluate(() => globalThis.__cocosWebProbe.dispose());
          await early.waitForFunction(() => globalThis.__cocosWebProbe.status().phase === 'closed');
          const response = early.waitForResponse(resourceUrl);
          release(); await (await response).body();
          // Wait for the actual asset cache publication, not only the HTTP response or a fixed delay.
          await early.waitForFunction(async () => {
            const cc = await System.import('cc');
            return !!cc.resources.get('probe-resources', cc.JsonAsset);
          });
          await settle(early);
          result.destroyedDuringLoad = await status(early);
          assert.equal(result.destroyedDuringLoad.phase, 'closed'); assert.equal(result.destroyedDuringLoad.hasSession, false); assert.equal(result.destroyedDuringLoad.nodeValid, false);
          result.lateResourceRefCount = await early.evaluate(async () => {
            const cc = await System.import('cc');
            return cc.resources.get('probe-resources', cc.JsonAsset).refCount;
          });
          assert.equal(result.lateResourceRefCount, 0, 'late resource must not be retained by the destroyed component');
        } finally { release(); }
      } finally { await context.close(); }
    }
    assert.deepEqual(logs.filter((entry) => entry.type === 'pageerror' || (entry.type === 'error' && entry.caseName !== 'missing-resource')), [], 'unexpected browser errors');
    if (!parsed.previewUrl) assert.deepEqual(webTreeDigest(join(projectDir, 'build/web-desktop')), result.webBuild, 'Web files must remain unchanged during verification');
    result.passed = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    try { await browser?.close(); } catch (error) { result.passed = false; result.cleanupError = String(error); }
    try { await server?.close(); } catch (error) { result.passed = false; result.cleanupError = String(error); }
    result.finishedAt = new Date().toISOString();
    writeFileSync(join(recordDir, 'browser.log.json'), JSON.stringify(logs, null, 2) + '\n');
    writeFileSync(join(recordDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  }
  if (!result.passed) throw new Error('ERR_WEB_PROBE_FAILED:' + result.error + ':' + recordDir);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => parseWebProbeArgs(process.argv.slice(2))).then(verifyWebProbe).then((result) => {
    console.log(JSON.stringify({ passed: result.passed, sourceCommit: result.sourceCommit, sourceDirty: result.sourceDirty, clicks: result.clicks.length, inputs: result.inputs.length, recordDir: result.recordDir }));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
