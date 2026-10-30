import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertClickObservation, createWebReportDirectory, parseWebProbeArgs, readWebProbeSource, resizeViewports, serveWebProbe, sha256, webTreeDigest } from './lib/webProbeSupport.mjs';

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const MATRIX = [
  { width: 1440, height: 1200, dpr: 1 }, { width: 1280, height: 720, dpr: 1 },
  { width: 960, height: 640, dpr: 1 }, { width: 800, height: 600, dpr: 1 },
  { width: 960, height: 640, dpr: 2 }
];
const settle = (page) => page.evaluate(() => new Promise((accept) => requestAnimationFrame(() => requestAnimationFrame(accept))));
const status = (page) => page.evaluate(() => globalThis.__cocosWebProbe.status());
const scroll = (page) => page.evaluate(() => ({ x: scrollX, y: scrollY }));

async function awaitReady(page) {
  await page.waitForFunction(() => ['ready', 'failed'].includes(globalThis.__cocosWebProbe?.status().phase), {}, { timeout: 30000 });
  const initial = await status(page);
  assert.equal(initial.phase, 'ready', JSON.stringify(initial));
  assert.equal(initial.hasSession, true);
  assert.equal(initial.displayedTime, initial.timeLabel);
  await settle(page);
}

async function attachButtonObservation(page) {
  await page.evaluate(async () => {
    const cc = await System.import('cc');
    const button = cc.director.getScene().getComponentsInChildren(cc.Button).find((item) => item.node.name === 'AdvanceOneHour');
    if (!button) throw new Error('ERR_WEB_PROBE_BUTTON_MISSING');
    globalThis.__webProbeButtonEvents = 0;
    button.node.on(cc.Button.EventType.CLICK, () => { globalThis.__webProbeButtonEvents++; });
  });
}

async function physicalClick(page, caseName, result, recordDir) {
  await settle(page);
  const layout = await page.evaluate(async () => {
    const cc = await System.import('cc');
    const scene = cc.director.getScene();
    const button = scene.getComponentsInChildren(cc.Button).find((item) => item.node.name === 'AdvanceOneHour');
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
  });
  const before = await status(page);
  const countBefore = await page.evaluate(() => globalThis.__webProbeButtonEvents);
  const scrollBefore = await scroll(page);
  assert.ok(layout.target.x >= 0 && layout.target.x < layout.viewport.width && layout.target.y >= 0 && layout.target.y < layout.viewport.height, 'physical target must be inside the viewport');
  // Keep the same physical pointer coordinates through down/up. Never scroll, retry or retarget a failed click.
  await page.mouse.move(layout.target.x, layout.target.y);
  await page.mouse.down();
  await settle(page);
  const scrollDown = await scroll(page);
  await page.mouse.up();
  await settle(page);
  const observation = { caseName, layout, before, after: await status(page), eventCount: await page.evaluate(() => globalThis.__webProbeButtonEvents) - countBefore, scrollBefore, scrollDown, scrollAfter: await scroll(page) };
  result.clicks.push(observation);
  await page.screenshot({ path: join(recordDir, caseName + '.png'), fullPage: true });
  assertClickObservation(observation);
  return observation;
}

async function memoryAndDispose(page) {
  const before = await status(page);
  await page.evaluate(() => globalThis.__cocosWebProbe.memoryRoundtrip());
  const restored = await status(page);
  assert.equal(restored.timeLabel, before.timeLabel);
  assert.equal(restored.displayedTime, restored.timeLabel);
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
  return { restored, disposed, resourceBefore, resourceAfter };
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
        const observation = await physicalClick(page, name, result, recordDir);
        assert.equal(observation.layout.viewport.dpr, item.dpr, 'browser must use the requested device pixel ratio');
        const cleanup = await memoryAndDispose(page);
        (result.lifecycles ??= []).push({ caseName: name, ...cleanup });
      } finally { await context.close(); }
    }
    const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage(); watchErrors(page, 'resize', logs);
      await page.goto(result.url); await awaitReady(page); await attachButtonObservation(page);
      await page.evaluate(async () => {
        const cc = await System.import('cc');
        globalThis.__webProbeResizeIdentity = {
          observer: globalThis.__cocosWebProbe,
          node: cc.director.getScene().getComponentsInChildren(cc.Button).find((item) => item.node.name === 'AdvanceOneHour').node
        };
      });
      for (const [i, viewport] of resizeViewports(Boolean(parsed.previewUrl)).entries()) {
        const before = await status(page);
        await page.setViewportSize(viewport); await settle(page);
        const after = await status(page);
        assert.equal(after.timeLabel, before.timeLabel, 'resize must retain the same session time');
        assert.equal(await page.evaluate(async () => {
          const cc = await System.import('cc');
          const button = cc.director.getScene().getComponentsInChildren(cc.Button).find((item) => item.node.name === 'AdvanceOneHour');
          return globalThis.__webProbeResizeIdentity.observer === globalThis.__cocosWebProbe && globalThis.__webProbeResizeIdentity.node === button.node;
        }), true, 'resize must retain the same public observer and Button node');
        await physicalClick(page, 'resize-' + i, result, recordDir);
      }
      result.resizeIdentityVerified = true;
      result.resizeLifecycle = await memoryAndDispose(page);
    } finally { await context.close(); }
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
