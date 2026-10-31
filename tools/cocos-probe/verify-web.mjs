import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertClickObservation, assertFarmingCommandObservation, assertFarmingLoadRecovery, assertFarmingProjection, assertLocalSaveRecovery, assertLocalSelectionObservation, assertStoredSaveUnchanged, assertUiCommandObservation, createWebReportDirectory, parseWebProbeArgs, readWebProbeSource, resizeViewports, serveWebProbe, sha256, timeInMinutes, webTreeDigest } from './lib/webProbeSupport.mjs';

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
const BUTTONS = ['AdvanceOneHour', 'SaveLocal', 'LoadLocal', ...SELECTION_BUTTONS, 'PlantCrop', 'AdvanceOneDay', 'HarvestCrop'];
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
  }, BUTTONS);
}

async function physicalClick(page, caseName, result, recordDir, buttonName = 'AdvanceOneHour', expected) {
  await settle(page);
  const layout = await page.evaluate(async (name) => {
    const cc = await System.import('cc');
    const scene = cc.director.getScene();
    const button = scene.getComponentsInChildren(cc.Button).find((item) => item.node.name === name);
    if (!button || !button.interactable) throw new Error('ERR_WEB_PROBE_BUTTON_NOT_INTERACTABLE:' + name);
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
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      target: cssPoint(button.node.worldPosition)
    };
  }, buttonName);
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
  if (SELECTION_BUTTONS.includes(buttonName)) {
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
  const result = { format: 'cocos-web-verification/v1', startedAt: new Date().toISOString(), passed: false, mode: parsed.previewUrl ? 'editor-preview' : 'built-web', recordDir, clicks: [] };
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
    console.log(JSON.stringify({ passed: result.passed, sourceCommit: result.sourceCommit, sourceDirty: result.sourceDirty, clicks: result.clicks.length, recordDir: result.recordDir }));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
