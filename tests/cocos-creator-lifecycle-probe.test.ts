import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CocosSessionHost, type CocosUiBindingPort, QinglanSessionProbeComponent } from '../src/cocos-creator-adapter';
import type { ActionResult } from '../src/game-core';
import { InMemorySaveStoragePort } from '../src/game-core';
import type { CocosActionPreviewResult } from '../src/cocos-app/adapters/CocosActionPreviewer';
import type { CocosSelectableViewModelData } from '../src/cocos-app/view-models/CocosSelectableViewModel';
import type { CocosStateViewModelData } from '../src/cocos-app/view-models/CocosStateViewModel';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';

class RecordingUiBinding implements CocosUiBindingPort {
  readonly viewModels: CocosStateViewModelData[] = [];
  readonly selectableViewModels: CocosSelectableViewModelData[] = [];
  readonly previews: CocosActionPreviewResult[] = [];
  readonly actions: ActionResult[] = [];
  readonly errors: Error[] = [];

  renderViewModel(viewModel: CocosStateViewModelData): void {
    this.viewModels.push(cloneForCompare(viewModel));
  }

  renderSelectableViewModel(viewModel: CocosSelectableViewModelData): void {
    this.selectableViewModels.push(cloneForCompare(viewModel));
  }

  renderPreviewResult(result: CocosActionPreviewResult): void {
    this.previews.push(cloneForCompare(result));
  }

  renderActionResult(result: ActionResult): void {
    this.actions.push(cloneForCompare(result));
  }

  renderError(error: Error): void {
    this.errors.push(error);
  }
}

function makeProbe() {
  const { configs, contracts } = buildRuntimeWithoutState();
  const storage = new InMemorySaveStoragePort();
  const host = new CocosSessionHost(configs, contracts, storage, {
    buildId: 'cocos_lifecycle_probe_test_v0_0_2_22',
    nowIso8601: '2026-05-21T00:00:00.000Z'
  });
  const binding = new RecordingUiBinding();
  const component = new QinglanSessionProbeComponent(host, binding);
  return { component, host, binding, storage };
}

test('QinglanSessionProbeComponent creates, reads, calls, and destroys session through lifecycle boundary', () => {
  const { component, host, binding } = makeProbe();
  assert.equal(host.hasSession(), false);

  component.onLoad();
  assert.equal(host.hasSession(), true);

  component.start();
  assert.equal(binding.viewModels.length, 1);
  assert.equal(binding.selectableViewModels.length, 1);
  assert.equal(binding.selectableViewModels[0].field_options.some((option) => option.enabled), true);

  const beforePreview = cloneForCompare(host.requireSession().getViewModel());
  const preview = component.preview('plant_crop', {
    field_plot_id: 'field_plot_01',
    seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 1, unit: 'count' }
  });
  assert.equal(preview.success, true);
  assert.equal(preview.side_effect_contract.save_file_changed, false);
  assert.deepEqual(host.requireSession().getViewModel(), beforePreview);
  assert.equal(binding.previews.length, 1);

  const result = component.dispatch('plant_crop', {
    field_plot_id: 'field_plot_01',
    seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 1, unit: 'count' }
  });
  assert.equal(result.success, true);
  assert.equal(result.created_objects.find((item) => item.object_type === 'CropInstance')?.object_id, 'crop_000001');
  assert.equal(binding.actions.length, 1);
  assert.equal(binding.selectableViewModels.at(-1)?.field_options.find((field) => field.id === 'field_plot_01')?.active_crop_count, 1);

  component.onDestroy();
  assert.equal(host.hasSession(), false);
  assert.throws(() => host.requireSession(), /ERR_COCOS_SESSION_NOT_CREATED/);
});

test('CocosSessionHost prevents accidental duplicate session creation and supports save/load only through session methods', async () => {
  const { component, host } = makeProbe();
  component.onLoad();
  assert.throws(() => host.createSession(), /ERR_COCOS_SESSION_ALREADY_CREATED/);

  const beforeSave = cloneForCompare(host.requireSession().getViewModel());
  const saved = await component.save('lifecycle_slot');
  assert.equal(saved.slot_id, 'lifecycle_slot');
  assert.equal(saved.byte_length > 0, true);

  const loaded = await component.load('lifecycle_slot');
  assert.equal(loaded.slot_id, 'lifecycle_slot');
  assert.deepEqual(loaded.view_model, beforeSave);
});

test('Creator lifecycle probe boundary stays engine-neutral and does not import dev/testing API or raw state types', () => {
  const files = collectFiles(join(process.cwd(), 'src/cocos-creator-adapter')).filter((file) => file.endsWith('.ts'));
  const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n');

  for (const forbidden of [
    'game-core/dev-api',
    'game-core/testing-api',
    'Stage1AFixtureRunner',
    'Stage1AHeadlessRuntime',
    'Stage1AActionScriptRunner',
    "from 'cc'",
    'from "cc"',
    'wx.',
    'GameState',
    'SaveFile',
    'save_file',
    'domain_events'
  ]) {
    assert.equal(combined.includes(forbidden), false, `Creator lifecycle adapter leaked forbidden token ${forbidden}`);
  }

  for (const forbiddenPattern of [/\.inventory\s*=/, /\.orders\s*=/, /\.dish_lots\s*=/, /\.reservations\s*=/]) {
    assert.equal(forbiddenPattern.test(combined), false, `Creator lifecycle adapter contains direct state mutation pattern ${forbiddenPattern}`);
  }
});

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(full) : [full];
  });
}
