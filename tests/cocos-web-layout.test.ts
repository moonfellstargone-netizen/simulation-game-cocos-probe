import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createProbeLayout, type ProbeLayoutRect } from '../apps/cocos-probe/template/assets/scripts/ProbeLayout';

const source = readFileSync('apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts', 'utf8');
const createView = source.slice(source.indexOf('const title = this.makeLabel'), source.indexOf('private makeLayout'));
const buttonNames = [...createView.matchAll(/this\.makeButton\([^,]+, '([^']+)'/g)].map(item => item[1]);
const labelNames = [...createView.matchAll(/this\.make(?:Section)?Label\([^,]+, '([^']+)'/g)].map(item => item[1]);
const inputNames = ['SplitQuantity', 'ProcessingQuantity', 'CookingQuantity', 'CookingMinutes'];
const rectanglesOverlap = (a: ProbeLayoutRect, b: ProbeLayoutRect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const [width, height] of [[800, 360], [844, 390], [960, 432], [844, 250]]) {
  test('compact ' + width + 'x' + height + ' keeps real CSS hit targets, readable content and every existing node reachable', () => {
    const plan = createProbeLayout(width, height);
    assert.equal(plan.mode, 'compact');
    assert.deepEqual(plan.design, plan.frame, '44 design units must be 44 CSS pixels, not scaled desktop content');
    const all = [...Object.entries(plan.fixed), ...Object.values(plan.panels).flatMap(page => Object.entries(page.nodes))];
    const names = all.map(([name]) => name);
    assert.equal(new Set(names).size, names.length, 'layout must not silently overwrite or duplicate a control');
    assert.deepEqual([...names].sort(), [...buttonNames, ...labelNames, ...inputNames].sort(), 'all existing controls, summaries and results remain available');
    for (const [name, rect] of all) {
      for (const value of [rect.x, rect.y, rect.width, rect.height]) assert.ok(Number.isFinite(value), name);
      assert.ok(rect.width > 0 && rect.height > 0, name);
      assert.ok((rect.fontSize ?? 14) >= 14, name + ' must remain readable at actual compact scale');
      if (buttonNames.includes(name) || inputNames.includes(name)) {
        assert.ok(rect.height >= 44 && rect.width >= 44, name + ' is a real 44 CSS pixel target');
      }
    }
    const fixed = [...Object.values(plan.fixed), plan.viewport];
    for (const rect of fixed) {
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1e-8 && rect.y + rect.height <= height + 1e-8);
    }
    for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) {
      assert.equal(rectanglesOverlap(fixed[i], fixed[j]), false, 'fixed controls and content viewport must not overlap');
    }
    for (const page of Object.values(plan.panels)) {
      assert.ok(page.height > plan.viewport.height, 'the page uses real content reachability instead of shrinking text');
      const entries = Object.entries(page.nodes);
      for (const [name, rect] of entries) {
        assert.ok(rect.x >= 0 && rect.x + rect.width <= plan.viewport.width + 1e-8, name + ' stays horizontally visible');
        assert.ok(rect.y >= 0 && rect.y + rect.height <= page.height, name + ' stays within scroll content');
        if (buttonNames.includes(name) || inputNames.includes(name)) {
          const offset = Math.min(rect.y, page.height - plan.viewport.height);
          assert.ok(rect.y - offset >= 0 && rect.y + rect.height - offset <= plan.viewport.height, name + ' can be completely revealed by a valid vertical offset');
        }
      }
      for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
        assert.equal(rectanglesOverlap(entries[i][1], entries[j][1]), false, entries[i][0] + ' overlaps ' + entries[j][0]);
      }
    }
  });
}

test('desktop matrices keep the original design and resizing never mutates or reuses a compact plan', () => {
  for (const [width, height] of [[1440,1200], [1280,720], [960,640], [800,600]]) {
    const plan = createProbeLayout(width, height);
    assert.equal(plan.mode, 'desktop'); assert.deepEqual(plan.design, { width: 960, height: 640 });
    assert.deepEqual(plan.fixed, {});
    assert.ok(Object.values(plan.panels).every(page => Object.keys(page.nodes).length === 0));
  }
  const before = createProbeLayout(844,390);
  const immutableCopy = structuredClone(before);
  createProbeLayout(844,250); createProbeLayout(960,640);
  assert.deepEqual(before, immutableCopy);
  assert.deepEqual(createProbeLayout(844,390), before);
  const detached = createProbeLayout(844,390);
  Reflect.set(detached.panels.orders.nodes.SubmitOrder, 'height', 1);
  assert.ok(createProbeLayout(844,390).panels.orders.nodes.SubmitOrder.height >= 44);
});

test('invalid frame geometry is rejected before producing negative or nonfinite node dimensions', () => {
  for (const [width,height] of [[NaN,390], [844,Infinity], [0,390], [-800,360], [844,-1]]) {
    assert.throws(() => createProbeLayout(width,height), /ERR_PROBE_LAYOUT_FRAME_INVALID/);
  }
  assert.equal(createProbeLayout(390,844).mode, 'desktop', 'portrait does not silently claim the compact landscape contract');
  assert.equal(createProbeLayout(1001,500).mode, 'desktop');
});

test('viewport source follows the actual visible browser frame and restores it after simulated contraction', () => {
  const script = readFileSync('apps/cocos-probe/template/build-templates/web-desktop/probe-viewport.js', 'utf8');
  const listeners = new Map<string, () => void>();
  const viewport = { width: 844, height: 390, offsetLeft: 0, offsetTop: 0,
    addEventListener: (name: string, fn: () => void) => listeners.set('visual-' + name, fn) };
  const style: Record<string, string> = {};
  const window = { innerWidth: 844, innerHeight: 390, visualViewport: viewport,
    addEventListener: (name: string, fn: () => void) => listeners.set('window-' + name, fn) };
  runInNewContext(script, { window, document: { getElementById: () => ({ style }) } });
  assert.equal(style.width, '844px'); assert.equal(style.height, '390px');
  viewport.height = 250; viewport.offsetTop = 12; listeners.get('visual-resize')!();
  assert.equal(style.height, '250px'); assert.equal(style.top, '12px');
  viewport.height = 390; viewport.offsetTop = 0; listeners.get('visual-scroll')!();
  assert.equal(style.height, '390px'); assert.equal(style.top, '0px');
  window.innerWidth = 800; window.innerHeight = 360; listeners.get('window-resize')!();
  assert.equal(style.width, '800px'); assert.equal(style.height, '360px');
  assert.throws(() => runInNewContext(script, { document: { getElementById: () => null } }), /ERR_COCOS_PROBE_FRAME_MISSING/);
});
