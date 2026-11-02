import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertClickObservation, assertDisabledInventoryObservation, assertFarmingCommandObservation, assertFarmingLoadRecovery, assertFarmingProjection, assertInventoryCommandObservation, assertInventoryLoadRecovery, assertInventoryProjection, assertLocalInventoryObservation, assertLocalSaveRecovery, assertLocalSelectionObservation, assertSplitConfirmObservation, assertSplitDisabledObservation, assertSplitLoadRecovery, assertSplitPreviewObservation, assertSplitProjection, assertSplitQuantityObservation, assertStoredSaveUnchanged, assertUiCommandObservation, createWebReportDirectory, parseWebProbeArgs, readWebProbeSource, resizeViewports, serveWebProbe, sha256, timeInMinutes, webTreeDigest } from './lib/webProbeSupport.mjs';
import { assertLocalProcessingObservation, assertProcessingCollectObservation, assertProcessingDisabledObservation, assertProcessingLoadRecovery, assertProcessingPreviewObservation, assertProcessingProjection, assertProcessingQuantityObservation, assertProcessingStartObservation } from './lib/webProbeSupport.mjs';
import { assertCookingProjection, assertCookingPreviewObservation, assertCookingConfirmObservation, assertCookingDisabledObservation, assertCookingInputObservation, assertCookingLoadRecovery, assertLocalCookingObservation } from './lib/webProbeSupport.mjs';

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
const PROCESSING_LOCAL_BUTTONS = ['OpenProcessing', 'SelectProcessingMethod', 'SelectProcessingInput', 'SelectProcessingLot', 'SelectProcessingFacility', 'SelectProcessingTask'];
const COOKING_LOCAL_BUTTONS = ['OpenCooking', 'SelectCookingRecipe', 'SelectCookingRole', 'SelectCookingLot', 'ClearCookingRole', 'SelectCookingHeat', 'SelectCookingStorage'];
const BUTTONS = ['AdvanceOneHour', 'SaveLocal', 'LoadLocal', ...SELECTION_BUTTONS, 'PlantCrop', 'AdvanceOneDay', 'HarvestCrop', ...INVENTORY_LOCAL_BUTTONS, 'MoveInventoryLot', 'SplitPreview', 'SplitConfirm', ...PROCESSING_LOCAL_BUTTONS, 'ProcessingPreview', 'StartProcessing', 'CollectProcessing', ...COOKING_LOCAL_BUTTONS, 'CookingPreview', 'CookDish'];
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
    for (const [name, counters] of [['SplitQuantity', '__webProbeEditEvents'], ['ProcessingQuantity', '__webProbeProcessingEditEvents'], ['CookingQuantity', '__webProbeCookingEditEvents'], ['CookingMinutes', '__webProbeCookingMinutesEditEvents']]) {
      const edits = cc.director.getScene().getComponentsInChildren(cc.EditBox).filter((item) => item.node.name === name);
      if (edits.length !== 1) throw new Error('ERR_WEB_PROBE_INPUT_MISSING_OR_DUPLICATE:' + name);
      globalThis[counters] = { began: 0, changed: 0, ended: 0 };
      for (const [key, event] of [['began', cc.EditBox.EventType.EDITING_DID_BEGAN], ['changed', cc.EditBox.EventType.TEXT_CHANGED], ['ended', cc.EditBox.EventType.EDITING_DID_ENDED]]) {
        edits[0].node.on(event, () => { globalThis[counters][key]++; });
      }
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
    if (buttonName === 'CookingPreview' || buttonName === 'CookDish') assertCookingDisabledObservation(observation, buttonName);
    else if (buttonName === 'SplitPreview' || buttonName === 'SplitConfirm') assertSplitDisabledObservation(observation, buttonName);
    else if (['ProcessingPreview', 'StartProcessing', 'CollectProcessing'].includes(buttonName)) assertProcessingDisabledObservation(observation, buttonName);
    else { assert.equal(buttonName, 'MoveInventoryLot'); assertDisabledInventoryObservation(observation); }
  } else if (COOKING_LOCAL_BUTTONS.includes(buttonName)) {
    assertLocalCookingObservation(observation, expected);
  } else if (buttonName === 'CookingPreview') {
    assertCookingPreviewObservation(observation, expected);
  } else if (buttonName === 'CookDish') {
    assertCookingConfirmObservation(observation);
  } else if (PROCESSING_LOCAL_BUTTONS.includes(buttonName)) {
    assertLocalProcessingObservation(observation, expected);
  } else if (buttonName === 'ProcessingPreview') {
    assertProcessingPreviewObservation(observation, expected);
  } else if (buttonName === 'StartProcessing') {
    assertProcessingStartObservation(observation);
  } else if (buttonName === 'CollectProcessing') {
    assertProcessingCollectObservation(observation);
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

async function physicalQuantityInput(page, caseName, text, result, recordDir, inputName) {
  await settle(page);
  // Read geometry and event counters only. All text changes below come from real mouse/keyboard input.
  const readLayout = () => page.evaluate(async (name) => {
    const cc = await System.import('cc');
    const scene = cc.director.getScene();
    const edit = scene.getComponentsInChildren(cc.EditBox).find((item) => item.node.name === name);
    if (!edit?.enabledInHierarchy || !edit.node.activeInHierarchy) throw new Error('ERR_WEB_PROBE_INPUT_INACTIVE:' + name);
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
      if (!labelTransform) throw new Error('ERR_WEB_PROBE_INPUT_LABEL_MISSING:' + name + ':' + key);
      return [key, bounds(labelTransform)];
    }));
    return { canvas: { left: rectangle.left, top: rectangle.top, right: rectangle.right, bottom: rectangle.bottom, width: rectangle.width, height: rectangle.height },
      button: input, inputLabels, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, target: point(edit.node.worldPosition) };
  }, inputName);
  const layout = await readLayout();
  const before = await status(page); const scrollBefore = await scroll(page);
  const counterName = ({ SplitQuantity: '__webProbeEditEvents', ProcessingQuantity: '__webProbeProcessingEditEvents', CookingQuantity: '__webProbeCookingEditEvents', CookingMinutes: '__webProbeCookingMinutesEditEvents' })[inputName];
  const counters = await page.evaluate((key) => ({ buttons: { ...globalThis.__webProbeButtonEvents }, edit: { ...globalThis[key] } }), counterName);
  await page.mouse.move(layout.target.x, layout.target.y); await page.mouse.down(); await settle(page);
  const scrollDown = await scroll(page); await page.mouse.up();
  await page.waitForFunction(() => document.activeElement?.classList.contains('cocosEditBox'), {}, { timeout: 5000 });
  await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await page.keyboard.type(text);
  const focused = await page.evaluate(() => ({ className: document.activeElement?.className, value: document.activeElement?.value }));
  await page.keyboard.press('Tab'); await settle(page);
  // Inspect the rendered text/placeholder geometry again after the real edit and blur.
  layout.inputLabels = (await readLayout()).inputLabels;
  const afterCounters = await page.evaluate((key) => ({ buttons: { ...globalThis.__webProbeButtonEvents }, edit: { ...globalThis[key] } }), counterName);
  const observation = { caseName, inputName, text, layout, focused, before, after: await status(page),
    eventCount: BUTTONS.reduce((sum, name) => sum + afterCounters.buttons[name] - counters.buttons[name], 0),
    editEvents: Object.fromEntries(['began', 'changed', 'ended'].map((key) => [key, afterCounters.edit[key] - counters.edit[key]])),
    scrollBefore, scrollDown, scrollAfter: await scroll(page) };
  result.inputs.push(observation);
  await page.screenshot({ path: join(recordDir, caseName + '.png'), fullPage: true });
  if (inputName === 'CookingQuantity' || inputName === 'CookingMinutes') assertCookingInputObservation(observation, text);
  else if (inputName === 'SplitQuantity') assertSplitQuantityObservation(observation, text);
  else { assert.equal(inputName, 'ProcessingQuantity'); assertProcessingQuantityObservation(observation, text); }
  return observation;
}

const physicalSplitInput = (...args) => physicalQuantityInput(...args, 'SplitQuantity');
const physicalProcessingInput = (...args) => physicalQuantityInput(...args, 'ProcessingQuantity');

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

async function processingLoop(browser, url, result, recordDir, logs) {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  try {
    let page = await context.newPage(); watchErrors(page, 'processing-loop', logs);
    await page.goto(url); await awaitReady(page); await attachButtonObservation(page);
    const initial = await status(page); const farming = assertFarmingProjection(initial);
    const initiallyStored = await storedSave(page); assert.equal(initiallyStored.raw, null);
    const field = farming.fieldOptions.find((item) => item.enabled); const seed = farming.seedOptions.find((item) => item.enabled);
    assert.ok(field && seed, 'processing materials must come from the ordinary public new game');
    await physicalClick(page, 'processing-farm-field', result, recordDir, 'SelectField', { key: 'selectedFieldId', value: field.id });
    await physicalClick(page, 'processing-farm-seed', result, recordDir, 'SelectSeed', { key: 'selectedSeedId', value: seed.id });
    await physicalClick(page, 'processing-farm-plant', result, recordDir, 'PlantCrop', { actionType: 'plant_crop', status: 'completed', timeLabel: initial.timeLabel });
    for (let days = 0; !(await status(page)).farming.harvestableOptions.some((crop) => crop.enabled); days++) {
      assert.ok(days < 30, 'ordinary time must produce the real processing input within the verification bound');
      const next = timeInMinutes((await status(page)).timeLabel) + 1440;
      await physicalClick(page, 'processing-farm-day-' + days, result, recordDir, 'AdvanceOneDay', { actionType: 'advance_time', status: 'completed', timeLabel: `day ${Math.floor(next / 1440)} minute ${next % 1440}` });
    }
    const mature = await status(page); const crop = mature.farming.harvestableOptions.find((item) => item.enabled);
    await physicalClick(page, 'processing-farm-crop', result, recordDir, 'SelectCrop', { key: 'selectedCropId', value: crop.id });
    const harvested = await physicalClick(page, 'processing-farm-harvest', result, recordDir, 'HarvestCrop', { actionType: 'harvest_crop', status: 'completed', timeLabel: mature.timeLabel });
    const produce = harvested.after.inventory.lotOptions.find((lot) => lot.base_id === 'cabbage' && lot.current_form === 'fresh'
      && !harvested.before.inventory.lotOptions.some((previous) => previous.id === lot.id));
    assert.ok(produce && produce.quantity.unit === 'g' && produce.quantity.amount >= 600, 'the ordinary harvest must supply both real processing tasks');
    await physicalClick(page, 'processing-open', result, recordDir, 'OpenProcessing', { panel: 'processing' });
    const opened = assertProcessingProjection(await status(page));
    assert.equal(opened.selectedMethodId, null); assert.equal(opened.selectedFacilityId, null); assert.equal(opened.selectedTaskId, null);
    const method = opened.methodOptions.find((item) => item.enabled && item.input_requirements.some((requirement) => requirement.constraints.base_id === 'salt'));
    assert.ok(method, 'the current active configuration must publicly expose the pickling method');
    const saltRequirement = method.input_requirements.find((item) => item.constraints.base_id === 'salt');
    const primaryRequirement = method.input_requirements.find((item) => item.lot_ids.includes(produce.id));
    assert.ok(primaryRequirement && saltRequirement?.min_quantity?.unit === 'g' && saltRequirement.min_quantity.amount > 1);
    const salt = opened.lotOptions.find((lot) => saltRequirement.lot_ids.includes(lot.id) && lot.enabled && lot.base_id === 'salt');
    const facility = opened.facilityOptions.find((item) => item.enabled && method.compatible_facility_ids.includes(item.id));
    assert.ok(salt && facility, 'the public new game must offer its existing salt and compatible facility');

    const choose = async (kind, wanted, prefix) => {
      const mapping = {
        method: ['methodOptions', 'selectedMethodId', 'SelectProcessingMethod'],
        facility: ['facilityOptions', 'selectedFacilityId', 'SelectProcessingFacility'],
        task: ['taskOptions', 'selectedTaskId', 'SelectProcessingTask'],
        requirement: ['requirements', 'selectedRequirementIndex', 'SelectProcessingInput'],
        lot: ['currentInputLotOptions', 'lotId', 'SelectProcessingLot']
      };
      const [collection, key, button] = mapping[kind];
      const read = (current) => {
        const options = kind === 'requirement' ? current.methodOptions.find((item) => item.id === current.selectedMethodId).input_requirements : current[collection];
        const choices = ['task', 'requirement'].includes(kind) ? options : options.filter((item) => item.enabled);
        const selected = kind === 'lot' ? current.inputSelections.find((item) => item.requirementIndex === current.selectedRequirementIndex)?.lotId : current[key];
        return { choices, selected, identity: (item) => kind === 'requirement' ? item.requirement_index : item.id };
      };
      const bound = read((await status(page)).processing).choices.length;
      for (let step = 0; step < bound; step++) {
        const current = (await status(page)).processing; const { choices, selected, identity } = read(current);
        if (selected === wanted) return;
        const index = choices.findIndex((item) => identity(item) === selected);
        const next = identity(choices[(index + 1) % choices.length]);
        const expected = kind === 'lot' ? { requirementIndex: current.selectedRequirementIndex, lotId: next } : { key, value: next };
        await physicalClick(page, prefix + '-' + step, result, recordDir, button, expected);
      }
      assert.equal(read((await status(page)).processing).selected, wanted, 'bounded physical processing browsing must reach its declared current option');
    };
    const selectInputs = async (prefix, saltAmount = 15) => {
      await choose('method', method.id, prefix + '-method');
      await choose('requirement', primaryRequirement.requirement_index, prefix + '-primary-requirement');
      await choose('lot', produce.id, prefix + '-primary-lot');
      await physicalProcessingInput(page, prefix + '-primary-300', '300', result, recordDir);
      await choose('requirement', saltRequirement.requirement_index, prefix + '-salt-requirement');
      await choose('lot', salt.id, prefix + '-salt-lot');
      await physicalProcessingInput(page, prefix + '-salt-' + saltAmount, String(saltAmount), result, recordDir);
      await choose('facility', facility.id, prefix + '-facility');
    };
    await choose('method', method.id, 'processing-missing-salt-method');
    await choose('requirement', primaryRequirement.requirement_index, 'processing-missing-salt-primary');
    await choose('lot', produce.id, 'processing-missing-salt-lot');
    await physicalProcessingInput(page, 'processing-missing-salt-primary-300', '300', result, recordDir);
    await choose('facility', facility.id, 'processing-missing-salt-facility');
    const missingSalt = await physicalClick(page, 'processing-missing-salt-refused', result, recordDir, 'ProcessingPreview', { statusCode: 'ERR_PROCESSING_INPUT_MISSING' });
    assert.match(missingSalt.after.displayedOperation, /加工所需材料缺失或数量不足/);
    await physicalClick(page, 'processing-missing-salt-start-disabled', result, recordDir, 'StartProcessing', { disabled: true });
    await selectInputs('processing-initial', 0);
    const zero = await physicalClick(page, 'processing-zero-preview-disabled', result, recordDir, 'ProcessingPreview', { disabled: true });
    await physicalProcessingInput(page, 'processing-subminimum-salt', String(saltRequirement.min_quantity.amount - 1), result, recordDir);
    const refused = await physicalClick(page, 'processing-subminimum-refused', result, recordDir, 'ProcessingPreview', { statusCode: 'ERR_PROCESSING_INPUT_MISSING' });
    assert.match(refused.after.displayedOperation, /加工所需材料缺失或数量不足/);
    await physicalClick(page, 'processing-refused-start-disabled', result, recordDir, 'StartProcessing', { disabled: true });
    await physicalProcessingInput(page, 'processing-legal-salt-15', '15', result, recordDir);
    const preview = await physicalClick(page, 'processing-legal-preview', result, recordDir, 'ProcessingPreview', { statusCode: 'OK' });
    await physicalProcessingInput(page, 'processing-change-invalidates-preview', '16', result, recordDir);
    const staleQuantity = await physicalClick(page, 'processing-stale-quantity-disabled', result, recordDir, 'StartProcessing', { disabled: true });
    await physicalProcessingInput(page, 'processing-restore-salt-15', '15', result, recordDir);
    await physicalClick(page, 'processing-preview-before-input-switch', result, recordDir, 'ProcessingPreview', { statusCode: 'OK' });
    await choose('requirement', primaryRequirement.requirement_index, 'processing-change-input');
    assert.equal((await status(page)).processing.preview, null);
    const staleInput = await physicalClick(page, 'processing-stale-input-disabled', result, recordDir, 'StartProcessing', { disabled: true });
    await choose('requirement', saltRequirement.requirement_index, 'processing-return-salt');
    await physicalClick(page, 'processing-final-preview', result, recordDir, 'ProcessingPreview', { statusCode: 'OK' });
    const started = await physicalClick(page, 'processing-start', result, recordDir, 'StartProcessing');
    const firstTaskId = started.after.processing.startResult.taskId;
    await choose('task', firstTaskId, 'processing-active-task');
    const notReady = await physicalClick(page, 'processing-not-ready-disabled', result, recordDir, 'CollectProcessing', { disabled: true });
    await physicalClick(page, 'processing-save-active', result, recordDir, 'SaveLocal', { name: 'save', status: 'completed', timeLabel: started.after.timeLabel });
    const savedState = await status(page); const saved = { ...await storedSave(page), timeLabel: savedState.timeLabel };
    assert.ok(saved.raw);
    await physicalClick(page, 'processing-transient-hour', result, recordDir);
    const loaded = await physicalClick(page, 'processing-load-active', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
    assertProcessingLoadRecovery(savedState, loaded); assertStoredSaveUnchanged(saved, await storedSave(page));
    await page.reload(); await awaitReady(page); await attachButtonObservation(page);
    const reloadInitial = await status(page); const reloadStartup = await storedSave(page);
    const reloadLoaded = await physicalClick(page, 'processing-refresh-manual-load', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
    assertLocalSaveRecovery({ saved, initial: reloadInitial, afterStartup: reloadStartup, loaded: reloadLoaded, afterLoad: await storedSave(page) });
    assertProcessingLoadRecovery(savedState, reloadLoaded);
    await physicalClick(page, 'processing-refresh-open', result, recordDir, 'OpenProcessing', { panel: 'processing' });
    await choose('task', firstTaskId, 'processing-refresh-task');
    const advanceToReady = async (taskId, prefix, currentSave) => {
      const task = (await status(page)).processing.taskOptions.find((item) => item.id === taskId);
      assert.equal(task?.status, 'active');
      const remaining = task.expected_finish_minute - (timeInMinutes((await status(page)).timeLabel) - 1440);
      assert.ok(Number.isFinite(remaining) && remaining > 0 && remaining <= 7 * 1440, 'public finish time must give a bounded normal-time path');
      const bound = Math.ceil(remaining / 60); const advances = []; let steps = 0;
      while ((await status(page)).processing.taskOptions.find((item) => item.id === taskId)?.status === 'active') {
        assert.ok(steps < bound, 'normal advance_time must make the existing task ready by its public finish time');
        const currentMinute = timeInMinutes((await status(page)).timeLabel);
        const minutes = task.expected_finish_minute - (currentMinute - 1440) >= 1440 ? 1440 : 60;
        if (minutes === 1440) {
          const next = currentMinute + minutes;
          await physicalClick(page, prefix + '-day-' + (++steps), result, recordDir, 'AdvanceOneDay', { actionType: 'advance_time', status: 'completed', timeLabel: `day ${Math.floor(next / 1440)} minute ${next % 1440}` });
        } else await physicalClick(page, prefix + '-hour-' + (++steps), result, recordDir);
        advances.push({ step: steps, minutes });
        assertStoredSaveUnchanged(currentSave, await storedSave(page));
      }
      const ready = (await status(page)).processing.taskOptions.find((item) => item.id === taskId);
      assert.equal(ready?.status, 'ready_to_collect');
      assert.ok(timeInMinutes((await status(page)).timeLabel) - 1440 >= ready.expected_finish_minute);
      return { steps, advances, task: ready };
    };
    const firstReady = await advanceToReady(firstTaskId, 'processing-first', saved);
    const collected = await physicalClick(page, 'processing-collect', result, recordDir, 'CollectProcessing');
    assert.equal(collected.after.inventory.lotOptions.find((lot) => lot.id === collected.after.processing.collectResult.lotId)?.current_form, 'pickled', 'canonical pickling must produce the actually observed pickled lot');
    const duplicate = await physicalClick(page, 'processing-completed-disabled', result, recordDir, 'CollectProcessing', { disabled: true });
    assertStoredSaveUnchanged(saved, await storedSave(page));
    await selectInputs('processing-next');
    await physicalClick(page, 'processing-next-preview', result, recordDir, 'ProcessingPreview', { statusCode: 'OK' });
    const nextStarted = await physicalClick(page, 'processing-next-start', result, recordDir, 'StartProcessing');
    const secondTaskId = nextStarted.after.processing.startResult.taskId; assert.notEqual(secondTaskId, firstTaskId);
    await choose('task', secondTaskId, 'processing-next-task');
    await physicalClick(page, 'processing-save-next-active', result, recordDir, 'SaveLocal', { name: 'save', status: 'completed', timeLabel: nextStarted.after.timeLabel });
    const secondSavedState = await status(page); const secondSaved = { ...await storedSave(page), timeLabel: secondSavedState.timeLabel };
    const firstLifecycle = await disposeProbe(page); assertStoredSaveUnchanged(secondSaved, await storedSave(page));
    await page.close(); page = await context.newPage(); watchErrors(page, 'processing-reopen', logs);
    await page.goto(url); await awaitReady(page); await attachButtonObservation(page);
    const reopenInitial = await status(page); const reopenStartup = await storedSave(page);
    const reopenLoaded = await physicalClick(page, 'processing-reopen-manual-load', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: secondSaved.timeLabel });
    assertLocalSaveRecovery({ saved: secondSaved, initial: reopenInitial, afterStartup: reopenStartup, loaded: reopenLoaded, afterLoad: await storedSave(page) });
    assertProcessingLoadRecovery(secondSavedState, reopenLoaded);
    await physicalClick(page, 'processing-reopen-open', result, recordDir, 'OpenProcessing', { panel: 'processing' });
    await choose('task', secondTaskId, 'processing-reopen-task');
    const secondReady = await advanceToReady(secondTaskId, 'processing-second', secondSaved);
    const nextCollected = await physicalClick(page, 'processing-next-collect', result, recordDir, 'CollectProcessing');
    assert.notEqual(nextCollected.after.processing.collectResult.lotId, collected.after.processing.collectResult.lotId);
    assertStoredSaveUnchanged(secondSaved, await storedSave(page));
    const cooking = await cookingLoop(page, result, recordDir, logs, secondSaved);
    const lifecycle = cooking.lifecycle;
    return { scope: 'isolated 960x640 real mouse and keyboard; ordinary harvest, public method requirements, preview refusal and exact consumption; disabled active/completed collection emits no command; manual save/load, reload and same-context new-page continuation',
      initial, harvested, missingSalt, zero, refused, preview, staleQuantity, staleInput, started, notReady, savedState, saved: storedEvidence(saved), loaded, reloadInitial, reloadLoaded, firstReady, collected, duplicate,
      nextStarted, secondSavedState, secondSaved: storedEvidence(secondSaved), firstLifecycle, reopenInitial, reopenLoaded, secondReady, nextCollected, cooking, lifecycle };
  } finally { await context.close(); }
}

async function cookingLoop(page, result, recordDir, logs, priorSave) {
  // Continue the ordinary farm/process run using its real collected pickled batches.
  await physicalClick(page, 'cooking-open', result, recordDir, 'OpenCooking', { panel: 'cooking' });
  const initial = await status(page); const view = assertCookingProjection(initial);
  assert.equal(view.selectedRecipeId, null); assert.equal(view.activeMinutesText, ''); assert.equal(view.heatLevel, null);
  const recipe = view.recipeOptions.find(item => item.enabled);
  assert.ok(recipe, 'the ordinary harvest/process path must make the active recipe available');
  const choose = async (kind, wanted, prefix) => {
    const button = { recipe: 'SelectCookingRecipe', role: 'SelectCookingRole', lot: 'SelectCookingLot', target: 'SelectCookingStorage', heat: 'SelectCookingHeat' }[kind];
    const read = current => {
      if (kind === 'recipe') return { options: current.recipeOptions, selected: current.selectedRecipeId, id: item => item.id, key: 'selectedRecipeId' };
      if (kind === 'role') return { options: current.recipeOptions.find(item => item.id === current.selectedRecipeId).roles, selected: current.selectedRole, id: item => item.role, key: 'selectedRole' };
      if (kind === 'lot') return { options: current.currentInputLotOptions.filter(item => item.enabled), selected: current.inputSelections.find(item => item.role === current.selectedRole)?.lotId, id: item => item.id };
      if (kind === 'target') return { options: current.targetOptions.filter(item => item.enabled), selected: current.selectedTargetId, id: item => item.id, key: 'selectedTargetId' };
      return { options: [1, 2, 3], selected: current.heatLevel };
    };
    const bound = read((await status(page)).cooking).options.length;
    for (let step = 0; step < bound; step++) {
      const current = (await status(page)).cooking; const selection = read(current);
      if (selection.selected === wanted) return;
      const next = kind === 'heat' ? null : selection.id(selection.options[(selection.options.findIndex(item => selection.id(item) === selection.selected) + 1) % selection.options.length]);
      const expected = kind === 'lot' ? { lotId: next } : selection.key ? { key: selection.key, value: next } : {};
      await physicalClick(page, prefix + '-' + step, result, recordDir, button, expected);
    }
    assert.equal(read((await status(page)).cooking).selected, wanted, 'bounded physical cooking selection must reach its public option');
  };
  await choose('recipe', recipe.id, 'cooking-recipe');
  const role = id => recipe.roles.find(item => item.role === id);
  const pickled = view.lotOptions.filter(item => role('main').lot_ids.includes(item.id) && item.current_form === 'pickled' && item.quantity.amount >= 250);
  assert.ok(pickled.length >= 2, 'both prior real processing outputs must be available for two independent dishes');
  const bacon = view.lotOptions.find(item => role('side').lot_ids.includes(item.id) && item.enabled);
  const oil = view.lotOptions.find(item => role('oil').lot_ids.includes(item.id) && item.enabled);
  assert.ok(bacon && oil);
  const room = view.targetOptions.find(item => item.enabled && item.storage_type === 'room_temp');
  const unsupported = view.targetOptions.find(item => item.enabled && item.storage_type === 'cellar');
  assert.ok(room && unsupported);
  const input = async (id, lot, amount, prefix) => {
    await choose('role', id, prefix + '-role'); await choose('lot', lot.id, prefix + '-lot');
    await physicalQuantityInput(page, prefix + '-quantity', String(amount), result, recordDir, 'CookingQuantity');
  };
  await input('main', pickled[0], 250, 'cooking-main');
  await choose('heat', 'high', 'cooking-heat');
  await physicalQuantityInput(page, 'cooking-minutes-8', '8', result, recordDir, 'CookingMinutes');
  await choose('target', room.id, 'cooking-room');
  const missing = await physicalClick(page, 'cooking-missing-role', result, recordDir, 'CookingPreview', { statusCode: 'ERR_MENU_RECIPE_ROLE_MISSING:side' });
  await physicalClick(page, 'cooking-missing-disabled', result, recordDir, 'CookDish', { disabled: true });
  await input('side', bacon, 49, 'cooking-low-side');
  const insufficient = await physicalClick(page, 'cooking-low-side-refused', result, recordDir, 'CookingPreview', { statusCode: 'ERR_NOT_ENOUGH_RESOURCE' });
  await physicalQuantityInput(page, 'cooking-side-50', '50', result, recordDir, 'CookingQuantity');
  await input('oil', oil, 10, 'cooking-oil');
  await choose('target', unsupported.id, 'cooking-unsupported');
  const storageRefused = await physicalClick(page, 'cooking-storage-refused', result, recordDir, 'CookingPreview', { statusCode: 'ERR_STORAGE_FORM_NOT_SUPPORTED' });
  await choose('target', room.id, 'cooking-restore-room');
  const preview = await physicalClick(page, 'cooking-legal-preview', result, recordDir, 'CookingPreview');
  await physicalQuantityInput(page, 'cooking-edit-invalidates-preview', '9', result, recordDir, 'CookingMinutes');
  const stale = await physicalClick(page, 'cooking-stale-disabled', result, recordDir, 'CookDish', { disabled: true });
  await physicalQuantityInput(page, 'cooking-restore-8', '8', result, recordDir, 'CookingMinutes');
  await physicalClick(page, 'cooking-final-preview', result, recordDir, 'CookingPreview');
  const cooked = await physicalClick(page, 'cooking-first-confirm', result, recordDir, 'CookDish');
  assertStoredSaveUnchanged(priorSave, await storedSave(page));
  await physicalClick(page, 'cooking-save-dish', result, recordDir, 'SaveLocal', { name: 'save', status: 'completed', timeLabel: cooked.after.timeLabel });
  const savedState = await status(page); const saved = { ...await storedSave(page), timeLabel: savedState.timeLabel };
  await physicalClick(page, 'cooking-transient-hour', result, recordDir);
  const loaded = await physicalClick(page, 'cooking-load-dish', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
  assertCookingLoadRecovery(savedState, loaded); assertStoredSaveUnchanged(saved, await storedSave(page));
  await page.reload(); await awaitReady(page); await attachButtonObservation(page);
  const reloadInitial = await status(page); const reloadStartup = await storedSave(page);
  const reloadLoaded = await physicalClick(page, 'cooking-refresh-manual-load', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
  assertLocalSaveRecovery({ saved, initial: reloadInitial, afterStartup: reloadStartup, loaded: reloadLoaded, afterLoad: await storedSave(page) });
  assertCookingLoadRecovery(savedState, reloadLoaded);
  const firstLifecycle = await disposeProbe(page); assertStoredSaveUnchanged(saved, await storedSave(page));
  const context = page.context(); await page.close(); page = await context.newPage(); watchErrors(page, 'cooking-reopen', logs);
  await page.goto(result.url); await awaitReady(page); await attachButtonObservation(page);
  const reopenInitial = await status(page); const reopenStartup = await storedSave(page);
  const reopenLoaded = await physicalClick(page, 'cooking-reopen-manual-load', result, recordDir, 'LoadLocal', { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
  assertLocalSaveRecovery({ saved, initial: reopenInitial, afterStartup: reopenStartup, loaded: reopenLoaded, afterLoad: await storedSave(page) });
  assertCookingLoadRecovery(savedState, reopenLoaded);
  await physicalClick(page, 'cooking-reopen-page', result, recordDir, 'OpenCooking', { panel: 'cooking' });
  await choose('recipe', recipe.id, 'cooking-next-recipe');
  await input('main', pickled[1], 250, 'cooking-next-main'); await input('side', bacon, 50, 'cooking-next-side');
  await choose('heat', 'high', 'cooking-next-heat'); await choose('target', room.id, 'cooking-next-room');
  await physicalQuantityInput(page, 'cooking-next-8', '8', result, recordDir, 'CookingMinutes');
  await physicalClick(page, 'cooking-next-preview', result, recordDir, 'CookingPreview');
  const nextCooked = await physicalClick(page, 'cooking-next-confirm', result, recordDir, 'CookDish');
  assert.notEqual(nextCooked.after.cooking.result.dishLotId, cooked.after.cooking.result.dishLotId);
  assertStoredSaveUnchanged(saved, await storedSave(page));
  const lifecycle = await disposeProbe(page);
  return { scope: '960x640 physical mouse/keyboard, ordinary farm/process inputs; missing role, insufficient quantity, unsupported storage, stale preview, exact material/fuel consumption, real DishLot, manual load/reload/new-page recovery; controlled fuel exhaustion is outside browser scope', initial, missing, insufficient, storageRefused, preview, stale, cooked, savedState, saved: storedEvidence(saved), loaded, reloadInitial, reloadLoaded, firstLifecycle, reopenInitial, reopenLoaded, nextCooked, lifecycle };
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
    result.processing = await processingLoop(browser, result.url, result, recordDir, logs);
    result.cooking = result.processing.cooking;
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
