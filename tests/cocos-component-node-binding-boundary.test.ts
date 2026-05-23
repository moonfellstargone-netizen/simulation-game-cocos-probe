import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

test('component node binding source stays behind scene binding and avoids platform/core shortcuts', () => {
  const files = collectFiles(join(process.cwd(), 'src/cocos-creator-adapter/component')).filter((file) => file.endsWith('.ts'));
  const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n');

  for (const required of [
    'CocosComponentNodeBindingPort',
    'CocosComponentNodeBindingAdapter',
    'QinglanUiSceneProbeComponent',
    'CocosComponentNodeBindingPatch',
    'mapSceneSectionToNodeTarget',
    'CocosSceneBindingController',
    'CocosUiShellController'
  ]) {
    assert.equal(combined.includes(required), true, `component node binding source missing ${required}`);
  }

  for (const forbidden of [
    "from 'cc'",
    'from "cc"',
    "from 'wx'",
    'from "wx"',
    'wx.',
    "from 'fs'",
    'from "fs"',
    "from 'node:fs'",
    'from "node:fs"',
    'game-core/dev-api',
    'game-core/testing-api',
    'Stage1AFixtureRunner',
    'Stage1AHeadlessRuntime',
    'Stage1AActionScriptRunner',
    'GameState',
    'SaveFile',
    'save_file',
    'InventoryLot',
    'Order',
    'inventory',
    'orders',
    'dish_lots',
    'reservations',
    'field_plot_01',
    'seed_cabbage_initial_001',
    'tavern_home_dish_001'
  ]) {
    assert.equal(combined.includes(forbidden), false, `component node binding source leaked forbidden token ${forbidden}`);
  }

  for (const forbiddenPattern of [/\.inventory\s*=/, /\.orders\s*=/, /\.dish_lots\s*=/, /\.reservations\s*=/, /\.money\s*=/]) {
    assert.equal(forbiddenPattern.test(combined), false, `component node binding source contains direct state mutation pattern ${forbiddenPattern}`);
  }
});

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(full) : [full];
  });
}
