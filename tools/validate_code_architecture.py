from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]

# v0.0.2.22 起，中风险 token/state-leak 架构边界规则进入 architecture-boundary shadow_aligned 双跑对齐。
# legacy validator 仍保留核心游戏架构红线和兼容入口。
# 本轮为检查体系测试登记闭合（Quality Test Registry Closure）：把 test:cocos-session /
# tests/cocos-runtime-session.test.ts 纳入 test-registry、q:full 与 traceability 闭合，
# 只做版本面传播与最小同步，不删除高风险红线，也不改动业务架构语义。
# 当前版本名从 project-target.json 动态派生，不再逐版硬编码。

FORBIDDEN_TASK_CONTEXT_FILES = [
    'docs/CURRENT_TASK_CONTEXT.md',
    'docs/CURRENT_TASK_CONTEXT_TEMPLATE.md',
    'docs/TASK_CONTEXT.md',
    'docs/TASK_HANDOFF.md',
    'docs/PLANNING_CONVERSATION_CONTEXT.md',
]


def read_rel(rel: str) -> str:
    return (ROOT / rel).read_text(encoding='utf-8')


def assert_contains(rel: str, phrases: list[str]) -> None:
    text = read_rel(rel)
    for phrase in phrases:
        if phrase not in text:
            print(f'{rel} missing required phrase: {phrase}')
            sys.exit(1)


def markdown_referenced_paths(text: str) -> list[str]:
    paths = []
    for match in re.finditer(r'`((?:docs|tests|tools)/[A-Za-z0-9_./-]+)`', text):
        rel = match.group(1).rstrip('/')
        if '*' not in rel:
            paths.append(rel)
    return sorted(set(paths))


FORBIDDEN_PACKAGE_DIR_NAMES = {'__pycache__', 'node_modules', 'dist', 'coverage'}
FORBIDDEN_PACKAGE_FILE_SUFFIXES = {'.pyc'}
FORBIDDEN_PACKAGE_FILE_NAMES = {'.DS_Store'}
FORBIDDEN_LOG_ARTIFACT_PATTERNS = [
    re.compile(r'(^|/)logs($|/)'),
    re.compile(r'_logs($|/)'),
    re.compile(r'开发日志包'),
    re.compile(r'开发记录'),
    re.compile(r'CHANGE_SUMMARY\.md$'),
    re.compile(r'FINAL_CHECK_REPORT\.md$'),
    re.compile(r'EXTERNAL_SCAN_REPORT\.md$'),
]
LOCAL_INSTALL_OR_BUILD_DIRS = {'node_modules', 'dist', 'coverage'}


def scan_package_hygiene() -> None:
    """Fail on generated/cache/log artifacts that would pollute the code package.

    Top-level node_modules/dist/coverage are skipped as local generated directories so
    `npm ci && npm run check` remains possible. The delivery zip is separately built
    from an explicit clean copy and re-scanned after extraction, so those directories
    still cannot enter the actual code package.
    """
    violations: list[str] = []
    for path in ROOT.rglob('*'):
        rel = path.relative_to(ROOT).as_posix()
        parts = rel.split('/')
        if parts and parts[0] == '.git':
            continue
        if parts and parts[0] in LOCAL_INSTALL_OR_BUILD_DIRS:
            continue
        if parts[:2] == ['reports', 'quality']:
            continue
        if any(pattern.search(rel) for pattern in FORBIDDEN_LOG_ARTIFACT_PATTERNS):
            violations.append(rel)
            continue
        if path.is_dir():
            if path.name in FORBIDDEN_PACKAGE_DIR_NAMES:
                violations.append(rel + '/')
            continue
        if path.name in FORBIDDEN_PACKAGE_FILE_NAMES or path.suffix in FORBIDDEN_PACKAGE_FILE_SUFFIXES or path.name.endswith('.log'):
            violations.append(rel)
    if violations:
        print('Package hygiene violation: generated/cache/log artifacts must not enter the code package:')
        for rel in sorted(set(violations)):
            print(f' - {rel}')
        sys.exit(1)


scan_package_hygiene()
required = [
    'src/game-core/action/ActionPipeline.ts',
    'src/game-core/action/ActionRequestBuilder.ts',
    'src/game-core/action/FormalStage1AActionCatalog.ts',
    'src/game-core/action/FormalStage1AActionValidator.ts',
    'src/game-core/index.ts',
    'src/game-core/dev-api.ts',
    'src/game-core/testing-api.ts',
    'src/game-core/save/NewGameBuilder.ts',
    'src/game-core/storage/StorageReconciler.ts',
    'src/game-core/storage/StorageAudit.ts',
    'src/game-core/reservation/ReservationGuard.ts',
    'src/game-core/dev/Stage1AHeadlessRuntime.ts',
    'src/game-core/dev/Stage1AActionScriptRunner.ts',
    'src/game-core/runtime/RuntimeStateSummary.ts',
    'scripts/run-stage1a-headless.ts',
    'src/game-core/storage/StorageOccupant.ts',
    'src/game-core/cooking/CookingConfigResolver.ts',
    'src/game-core/cooking/CookingSystem.ts',
    'src/game-core/demand/DemandResolver.ts',
    'src/game-core/config/ConfigRepository.ts',
    'src/game-core/transaction/TransactionRunner.ts',
    'src/game-core/id/IdService.ts',
    'src/game-core/validation/RuntimeSchemaValidator.ts',
    'src/game-core/validation/RuntimeContractValidator.ts',
    'src/cocos-app/adapters/CocosActionDispatcher.ts',
    'src/cocos-app/adapters/CocosRuntimeFacade.ts',
    'src/cocos-app/adapters/CocosActionDraftBuilder.ts',
    'src/cocos-app/adapters/CocosActionPreviewer.ts',
    'src/cocos-app/view-models/CocosStateViewModel.ts',
    'src/cocos-app/view-models/CocosSelectableViewModel.ts',
    'src/cocos-app/runtime/CocosAppRuntimeSession.ts',
    'src/game-core/save/SaveStoragePort.ts',
    'design_snapshot/generated/stage_1A_runtime_snapshot.json',
    'design_snapshot/SOURCE_DESIGN_PACK.txt',
    'tests/stage1a-baseline.test.ts',
    'tests/cocos-ui-readiness.test.ts',
    'tests/action-preview-boundary.test.ts',
    'src/cocos-creator-adapter/CocosSessionHost.ts',
    'src/cocos-creator-adapter/CocosLifecyclePort.ts',
    'src/cocos-creator-adapter/CocosUiBindingPort.ts',
    'src/cocos-creator-adapter/QinglanSessionProbeComponent.ts',
    'src/cocos-creator-adapter/index.ts',
    'src/cocos-creator-adapter/menu/MenuActionBinding.ts',
    'src/cocos-creator-adapter/menu/MenuRenderSnapshot.ts',
    'src/cocos-creator-adapter/menu/MinimalMenuInteractionController.ts',
    'src/cocos-creator-adapter/menu/MinimalMenuPresenter.ts',
    'src/cocos-creator-adapter/menu/index.ts',
    'src/cocos-creator-adapter/save/SaveLoadInteractionController.ts',
    'src/cocos-creator-adapter/save/SaveLoadPresenter.ts',
    'src/cocos-creator-adapter/save/SaveLoadRenderSnapshot.ts',
    'src/cocos-creator-adapter/save/SaveSlotBinding.ts',
    'src/cocos-creator-adapter/save/index.ts',
    'src/cocos-creator-adapter/errors/CocosErrorPresenter.ts',
    'src/cocos-creator-adapter/shell/CocosUiShellController.ts',
    'src/cocos-creator-adapter/shell/CocosUiShellPresenter.ts',
    'src/cocos-creator-adapter/shell/CocosUiShellRenderSnapshot.ts',
    'src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts',
    'src/cocos-creator-adapter/shell/CocosUiShellSnapshotDiff.ts',
    'src/cocos-creator-adapter/shell/index.ts',
    'src/cocos-creator-adapter/scene/CocosSceneBindingPort.ts',
    'src/cocos-creator-adapter/scene/CocosSceneBindingSnapshotApplier.ts',
    'src/cocos-creator-adapter/scene/CocosSceneBindingController.ts',
    'src/cocos-creator-adapter/scene/index.ts',
    'src/cocos-creator-adapter/component/CocosComponentNodeBindingPort.ts',
    'src/cocos-creator-adapter/component/CocosComponentNodeBindingAdapter.ts',
    'src/cocos-creator-adapter/component/QinglanUiSceneProbeComponent.ts',
    'src/cocos-creator-adapter/component/index.ts',
    'tests/cocos-creator-lifecycle-probe.test.ts',
    'tests/cocos-minimal-menu-binding.test.ts',
    'tests/cocos-ui-shell-composition.test.ts',
    'tests/cocos-ui-command-queue.test.ts',
    'tests/cocos-ui-render-diff.test.ts',
    'tests/cocos-scene-binding-boundary.test.ts',
    'tests/cocos-scene-binding-application.test.ts',
    'tests/cocos-component-node-binding-boundary.test.ts',
    'tests/cocos-component-node-binding-application.test.ts',
    'tests/context-governance-contracts.test.mjs',
    'tests/package-hygiene.test.mjs',
    'tools/build_release_package.py',
    'tools/check_release_zip.py',
    'docs/CODE_CONTEXT_INDEX.md',
    'docs/adr/ADR-0001-game-core-independent-from-engine.md',
    'docs/adr/ADR-0002-actionpipeline-as-only-formal-state-entry.md',
    'docs/adr/ADR-0003-load-failure-must-not-mutate-current-session.md',
    'docs/adr/ADR-0004-context-governance-artifacts-are-versioned-contracts.md',
    'docs/module_contracts/CocosAppRuntimeSession.contract.md',
    'docs/module_contracts/CocosSessionHost.contract.md',
    'docs/module_contracts/MinimalMenuInteractionController.contract.md',
    'docs/module_contracts/SaveLoadInteractionController.contract.md',
    'docs/module_contracts/CocosActionPreviewer.contract.md',
    'docs/module_contracts/CocosActionDraftBuilder.contract.md',
    'docs/module_contracts/SaveStoragePort.contract.md',
    'docs/module_contracts/CocosErrorPresenter.contract.md',
    'docs/module_contracts/CocosUiShellController.contract.md',
    'docs/module_contracts/CocosUiCommandQueue.contract.md',
    'docs/module_contracts/CocosUiShellSnapshotDiff.contract.md',
    'docs/module_contracts/CocosSceneBindingPort.contract.md',
    'docs/module_contracts/CocosSceneBindingController.contract.md',
    'docs/module_contracts/CocosComponentNodeBindingPort.contract.md',
    'docs/module_contracts/QinglanUiSceneProbeComponent.contract.md',
]
missing = [p for p in required if not (ROOT / p).exists()]
if missing:
    print('Missing required architecture files:', missing)
    sys.exit(1)

for forbidden_path in ['src/game-core/dev/ActionRequestBuilder.ts', 'src/game-core/dev/RuntimeStateSummary.ts']:
    if (ROOT / forbidden_path).exists():
        print('Public runtime helper still lives in dev folder:', forbidden_path)
        sys.exit(1)

snapshot = json.loads((ROOT / 'design_snapshot/generated/stage_1A_runtime_snapshot.json').read_text(encoding='utf-8'))
assert snapshot['source_formal_design_version'] == 'v1.5.2.2'
assert snapshot['source_config_profile'] == 'configs/active_stage_1A/load_order.yaml'
assert 'configs/active_stage_1A/stage_1A_active_config.yaml' in snapshot['loaded_documents']

src_text = '\n'.join(p.read_text(encoding='utf-8') for p in (ROOT / 'src').rglob('*.ts'))
for forbidden in [
    r'new\s+Date\s*\(',
    r'Date\.now\s*\(',
    r'Math\.random\s*\(',
    r'save_file\.inventory\s*=\s*\[\]',
]:
    if re.search(forbidden, src_text):
        print('Forbidden temporary shortcut found:', forbidden)
        sys.exit(1)

# Test fixture/system-step mechanics are allowed only in the dedicated fixture runner and tests.
for src_file in (ROOT / 'src').rglob('*.ts'):
    rel = src_file.relative_to(ROOT).as_posix()
    text = src_file.read_text(encoding='utf-8')
    if rel != 'src/game-core/testing/Stage1AFixtureRunner.ts':
        for forbidden_runtime_token in ['system.load_config_profile', 'system.start_new_game', 'system.save_and_load_roundtrip', 'system.inject_active_reservation', 'system.release_reservation', 'save_result_aliases', 'fixture_id', 'wx.']:
            if forbidden_runtime_token in text:
                print(f'Test fixture logic leaked into runtime source {rel}: {forbidden_runtime_token}')
                sys.exit(1)
    if not rel.startswith('src/game-core/testing/'):
        if re.search(r'T\d{2}[_A-Za-z]', text):
            print(f'Fixture step id leaked into non-testing source: {rel}')
            sys.exit(1)

# Source code must not import from tests; tests may import source, never the inverse.
for src_file in (ROOT / 'src').rglob('*.ts'):
    text = src_file.read_text(encoding='utf-8')
    if re.search(r"from\s+['\"]\.\./\.\./tests|from\s+['\"].*tests/", text):
        print(f'Source imports test-only code: {src_file.relative_to(ROOT)}')
        sys.exit(1)

# Runtime code must not use Node/Cocos/platform filesystem APIs; schema/config documents are injected by host/test harness.
for runtime_file in (ROOT / 'src' / 'game-core').rglob('*.ts'):
    text = runtime_file.read_text(encoding='utf-8')
    for forbidden_import in ["from 'node:fs'", 'from "node:fs"', "from 'fs'", 'from "fs"', "from 'cc'", 'from "cc"']:
        if forbidden_import in text:
            print(f'Forbidden runtime dependency in {runtime_file.relative_to(ROOT)}: {forbidden_import}')
            sys.exit(1)

# Public/dev/testing barrel boundary.
public_index = (ROOT / 'src/game-core/index.ts').read_text(encoding='utf-8')
for forbidden_export in ['./testing/Stage1AFixtureRunner', './dev/Stage1AHeadlessRuntime', './dev/Stage1AActionScriptRunner', './dev-api', './testing-api']:
    if forbidden_export in public_index:
        print(f'Public game-core barrel exports non-public API: {forbidden_export}')
        sys.exit(1)
for required_export in ['./action/ActionRequestBuilder', './runtime/RuntimeStateSummary', './action/FormalStage1AActionCatalog', './save/SaveStoragePort']:
    if required_export not in public_index:
        print(f'Public game-core barrel missing public runtime export: {required_export}')
        sys.exit(1)

dev_api = (ROOT / 'src/game-core/dev-api.ts').read_text(encoding='utf-8')
for required_token in ['./dev/Stage1AHeadlessRuntime', './dev/Stage1AActionScriptRunner']:
    if required_token not in dev_api:
        print(f'dev-api missing required export: {required_token}')
        sys.exit(1)
for forbidden_token in ['Stage1AFixtureRunner', './testing']:
    if forbidden_token in dev_api:
        print(f'dev-api leaked testing API: {forbidden_token}')
        sys.exit(1)

testing_api = (ROOT / 'src/game-core/testing-api.ts').read_text(encoding='utf-8')
if './testing/Stage1AFixtureRunner' not in testing_api:
    print('testing-api missing Stage1AFixtureRunner export')
    sys.exit(1)
for forbidden_token in ['Stage1AHeadlessRuntime', './dev/']:
    if forbidden_token in testing_api:
        print(f'testing-api leaked dev API: {forbidden_token}')
        sys.exit(1)

# Cocos adapter must use only public game-core API, never dev/testing API.
for adapter_file in (ROOT / 'src' / 'cocos-app').rglob('*.ts'):
    rel = adapter_file.relative_to(ROOT).as_posix()
    text = adapter_file.read_text(encoding='utf-8')
    for forbidden_token in ['game-core/dev-api', 'game-core/testing-api', 'Stage1AFixtureRunner', 'Stage1AHeadlessRuntime', 'Stage1AActionScriptRunner', 'save_result_aliases', 'fixture_id', 'wx.']:
        if forbidden_token in text:
            print(f'Cocos adapter imported or mentioned non-public runtime API in {rel}: {forbidden_token}')
            sys.exit(1)
    for forbidden_pattern in [r'save_file\.[A-Za-z0-9_]+\s*=', r'\.inventory\s*=', r'\.orders\s*=', r'\.dish_lots\s*=', r'\.reservations\s*=']:
        if re.search(forbidden_pattern, text):
            print(f'Cocos adapter appears to mutate core state directly: {rel}:{forbidden_pattern}')
            sys.exit(1)
    for forbidden_import in ["from 'node:fs'", 'from "node:fs"', "from 'fs'", 'from "fs"', "from 'cc'", 'from "cc"']:
        if forbidden_import in text:
            print(f'Cocos adapter boundary probe must stay engine/platform-neutral: {rel}: {forbidden_import}')
            sys.exit(1)


# Cocos Creator lifecycle probe must stay in its own engine-neutral boundary and must not touch core state directly.
creator_dir = ROOT / 'src' / 'cocos-creator-adapter'
creator_text = ''
if creator_dir.exists():
    creator_text = '\n'.join(p.read_text(encoding='utf-8') for p in creator_dir.rglob('*.ts'))
else:
    print('Missing cocos-creator-adapter boundary directory')
    sys.exit(1)
for forbidden_token in [
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
    'domain_events',
    'system.'
]:
    if forbidden_token in creator_text:
        print(f'Cocos Creator lifecycle probe leaked forbidden token: {forbidden_token}')
        sys.exit(1)
for forbidden_pattern in [r'\.inventory\s*=', r'\.orders\s*=', r'\.dish_lots\s*=', r'\.reservations\s*=', r'\.money\s*=']:
    if re.search(forbidden_pattern, creator_text):
        print(f'Cocos Creator lifecycle probe appears to mutate core state directly: {forbidden_pattern}')
        sys.exit(1)
for required_token in ['CocosSessionHost', 'CocosLifecyclePort', 'CocosUiBindingPort', 'QinglanSessionProbeComponent', 'getViewModel', 'getSelectableViewModel', 'preview', 'dispatch', 'save', 'load']:
    if required_token not in creator_text:
        print(f'Cocos Creator lifecycle probe missing required boundary token: {required_token}')
        sys.exit(1)

# Save/load UI binding must stay adapter-only and must not bypass the session host or storage port boundary.
save_ui_dir = ROOT / 'src' / 'cocos-creator-adapter' / 'save'
if not save_ui_dir.exists():
    print('Missing cocos-creator-adapter/save boundary directory')
    sys.exit(1)
save_ui_text = '\n'.join(p.read_text(encoding='utf-8') for p in save_ui_dir.rglob('*.ts'))
for required_token in ['SaveLoadInteractionController', 'SaveLoadPresenter', 'SaveLoadRenderSnapshot', 'SaveSlotBinding', 'session.save', 'session.load', 'getViewModel', 'getSelectableViewModel']:
    if required_token not in save_ui_text:
        print(f'Save/load UI binding missing required boundary token: {required_token}')
        sys.exit(1)
for forbidden_token in ['game-core/dev-api', 'game-core/testing-api', 'Stage1AFixtureRunner', 'Stage1AHeadlessRuntime', 'Stage1AActionScriptRunner', "from 'cc'", 'from "cc"', "from 'node:fs'", 'from "node:fs"', "from 'fs'", 'from "fs"', 'wx.', 'GameState', 'SaveFile', 'save_file', 'domain_events']:
    if forbidden_token in save_ui_text:
        print(f'Save/load UI binding leaked forbidden token: {forbidden_token}')
        sys.exit(1)
for forbidden_pattern in [r'\.inventory\s*=', r'\.orders\s*=', r'\.dish_lots\s*=', r'\.reservations\s*=', r'\.money\s*=']:
    if re.search(forbidden_pattern, save_ui_text):
        print(f'Save/load UI binding appears to mutate core state directly: {forbidden_pattern}')
        sys.exit(1)

error_presenter = ROOT / 'src' / 'cocos-creator-adapter' / 'errors' / 'CocosErrorPresenter.ts'
if not error_presenter.exists():
    print('Missing CocosErrorPresenter')
    sys.exit(1)

shell_dir = ROOT / 'src' / 'cocos-creator-adapter' / 'shell'
if not shell_dir.exists():
    print('Missing cocos-creator-adapter/shell boundary directory')
    sys.exit(1)
shell_text = '\n'.join(p.read_text(encoding='utf-8') for p in shell_dir.rglob('*.ts'))
for required_token in ['CocosUiShellController', 'CocosUiShellPresenter', 'CocosUiShellRenderSnapshot', 'CocosUiCommandQueue', 'CocosUiShellSnapshotDiff', 'diffCocosUiShellSnapshots', 'CocosSessionHost', 'MinimalMenuInteractionController', 'SaveLoadInteractionController', 'CocosErrorPresenter']:
    if required_token not in shell_text:
        print(f'Cocos UI shell missing required composition token: {required_token}')
        sys.exit(1)
for forbidden_token in ['game-core/dev-api', 'game-core/testing-api', 'Stage1AFixtureRunner', 'Stage1AHeadlessRuntime', 'Stage1AActionScriptRunner', "from 'cc'", 'from "cc"', "from 'node:fs'", 'from "node:fs"', "from 'fs'", 'from "fs"', 'wx.', 'GameState', 'SaveFile', 'save_file', 'domain_events', 'field_plot_01', 'seed_cabbage_initial_001', 'salt_initial_001', 'pickling_jar_basic_01']:
    if forbidden_token in shell_text:
        print(f'Cocos UI shell leaked forbidden token: {forbidden_token}')
        sys.exit(1)
for forbidden_pattern in [r'\.inventory\s*=', r'\.orders\s*=', r'\.dish_lots\s*=', r'\.reservations\s*=', r'\.money\s*=']:
    if re.search(forbidden_pattern, shell_text):
        print(f'Cocos UI shell appears to mutate core state directly: {forbidden_pattern}')
        sys.exit(1)

# Processing runtime must use the formal ProcessingTask schema shape, not legacy temporary task fields.
processing_text = (ROOT / 'src/game-core/processing/ProcessingSystem.ts').read_text(encoding='utf-8')
for legacy_token in ['output_hint', 'input_lots:', 'ready_time', 'start_time:', "status: 'ready'"]:
    if legacy_token in processing_text:
        print(f'Legacy ProcessingTask shortcut still present: {legacy_token}')
        sys.exit(1)
for required_token in ['ProcessingConfigResolver', 'input_lot_refs', 'reserved_quantities', 'start_world_minute', 'expected_finish_minute', 'ready_to_collect', 'output_preview']:
    if required_token not in processing_text:
        print(f'ProcessingSystem missing formal contract token: {required_token}')
        sys.exit(1)

# Cooking and demand runtime must resolve formal config, not fixture-specific shortcuts.
for rel in ['src/game-core/cooking/CookingSystem.ts', 'src/game-core/cooking/CookingConfigResolver.ts', 'src/game-core/demand/DemandResolver.ts']:
    text = (ROOT / rel).read_text(encoding='utf-8')
    for forbidden_token in ['T13_', 'T14_', 'created_objects[0]', 'tavern_home_dish_001']:
        if forbidden_token in text:
            print(f'Fixture or single-test shortcut leaked into {rel}: {forbidden_token}')
            sys.exit(1)

cooking_text = (ROOT / 'src/game-core/cooking/CookingSystem.ts').read_text(encoding='utf-8')
for forbidden_token in ["recipe_variants/bacon_cabbage_basic.yaml", "recognized_dish_id: 'bacon_cabbage'", "quality_score:"]:
    if forbidden_token in cooking_text:
        print(f'CookingSystem contains hardcoded or legacy DishLot shortcut: {forbidden_token}')
        sys.exit(1)
for required_token in ['RecipeConfigResolver', 'resolveRecipeVariant', 'resolveDishStructure', 'dish_profile', 'suitability_tags', 'quantity_used', 'component_profile', 'storage_footprint']:
    if required_token not in cooking_text:
        print(f'CookingSystem missing formal cooking contract token: {required_token}')
        sys.exit(1)

demand_text = (ROOT / 'src/game-core/demand/DemandResolver.ts').read_text(encoding='utf-8')
for forbidden_token in ['resolveTavernHomeDish', 'dish.property_profile', 'dish.quantity', 'dish.flags']:
    if forbidden_token in demand_text:
        print(f'DemandResolver contains hardcoded or legacy demand shortcut: {forbidden_token}')
        sys.exit(1)
for required_token in ['resolveDemandProfile', 'configs/demands/', 'accepted_object_types', 'hard_requirements', 'weighted_requirements', 'dish_profile', 'suitability_tags', 'reward_final', 'result_key']:
    if required_token not in demand_text:
        print(f'DemandResolver missing formal demand contract token: {required_token}')
        sys.exit(1)

# Developer headless runtime is a formal-action driver, not a fixture runner or Cocos adapter shortcut.
package_json = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
for script_name in ['dev:stage1a', 'test:dev-runner', 'test:cocos-adapter', 'test:cocos-session', 'test:cocos-ui-readiness', 'test:action-preview-boundary', 'test:cocos-lifecycle', 'test:cocos-menu', 'test:cocos-save-load', 'test:cocos-ui-shell', 'test:cocos-ui-command-queue', 'test:cocos-ui-render-diff', 'test:cocos-scene-binding', 'test:cocos-component-node-binding', 'test:context-governance', 'test:project-map-contracts', 'test:api-boundary', 'test:stage1a-baseline', 'test:package-hygiene', 'test:quality-gate-contracts', 'test:quality-plugin-contracts', 'test:quality-rule-authority-contracts', 'test:architecture-boundary-plugin-contracts', 'test:architecture-boundary-authority-contracts', 'test:architecture-boundary-token-alignment', 'arch:legacy', 'quality:version', 'quality:config', 'quality:test-registry', 'quality:release-surface', 'quality:context-docs', 'quality:architecture-boundary', 'release:build', 'release:check', 'q:fast', 'q:full', 'q:release']:
    if script_name not in package_json.get('scripts', {}):
        print(f'package.json missing required script: {script_name}')
        sys.exit(1)
if 'run-stage1a-headless.ts' not in package_json['scripts']['dev:stage1a']:
    print('dev:stage1a must run the headless Stage 1A script')
    sys.exit(1)

if 'tools/build_release_package.py' not in package_json['scripts']['release:build'] or '--project-target' not in package_json['scripts']['release:build']:
    print('release:build must use tools/build_release_package.py with --project-target')
    sys.exit(1)
if 'tools/check_release_zip.py' not in package_json['scripts']['release:check'] or '--project-target' not in package_json['scripts']['release:check']:
    print('release:check must use tools/check_release_zip.py with --project-target')
    sys.exit(1)

project_target = json.loads((ROOT / 'tools/quality/rules/project-target.json').read_text(encoding='utf-8'))
expected_npm_version = project_target['version']['npmVersion']
expected_code_version = project_target['version']['codePackageVersion']
expected_version_name = project_target['version']['versionName']
expected_chinese_version_name = project_target['version']['chineseVersionName']
if package_json.get('version') != expected_npm_version:
    print(f"package.json version must encode code package {expected_code_version}, got {package_json.get('version')}")
    sys.exit(1)
check_surface = package_json.get('scripts', {}).get('check', '')
check_runner = ROOT / 'tools' / 'run-code-check.mjs'
if check_runner.exists():
    check_surface += '\n' + check_runner.read_text(encoding='utf-8')
for quality_rel in ['tools/quality/test-registry.json', 'tools/quality/gate-policy.json', 'tools/quality/quality.config.json']:
    quality_path = ROOT / quality_rel
    if quality_path.exists():
        check_surface += '\n' + quality_path.read_text(encoding='utf-8')
for required_check_target in ['tests/cocos-ui-readiness.test.ts', 'tests/action-preview-boundary.test.ts', 'tests/cocos-creator-lifecycle-probe.test.ts', 'tests/cocos-minimal-menu-binding.test.ts', 'tests/cocos-save-load-ui-binding.test.ts', 'tests/cocos-error-presentation.test.ts', 'tests/cocos-ui-shell-composition.test.ts', 'tests/cocos-ui-command-queue.test.ts', 'tests/cocos-ui-render-diff.test.ts', 'tests/cocos-scene-binding-boundary.test.ts', 'tests/cocos-scene-binding-application.test.ts', 'tests/cocos-component-node-binding-boundary.test.ts', 'tests/cocos-component-node-binding-application.test.ts', 'tests/context-governance-contracts.test.mjs', 'tests/project-map-contracts.test.mjs', 'tests/package-hygiene.test.mjs', 'tests/stage1a-baseline.test.ts', 'tests/architecture-boundary-plugin-contracts.test.mjs', 'tests/architecture-boundary-authority-contracts.test.mjs', 'tests/architecture-boundary-token-alignment.test.mjs']:
    if required_check_target not in check_surface:
        print(f'npm run check must include {required_check_target}')
        sys.exit(1)

for rel in ['tools/quality/rules/architecture-boundary.rules.json', 'tools/quality/plugins/architecture-boundary-check.mjs']:
    if not (ROOT / rel).exists():
        print(f'architecture-boundary shadow file missing: {rel}')
        sys.exit(1)
quality_registry_text = read_rel('tools/quality/test-registry.json')
for required_phrase in ['quality.architectureBoundary', 'test.architecture-boundary-plugin-contracts', 'test.architecture-boundary-authority-contracts', 'test.architecture-boundary-token-alignment', 'quality:architecture-boundary', 'test:architecture-boundary-plugin-contracts', 'test:architecture-boundary-authority-contracts', 'test:architecture-boundary-token-alignment']:
    if required_phrase not in quality_registry_text + json.dumps(package_json.get('scripts', {}), ensure_ascii=False):
        print(f'architecture-boundary quality registration missing: {required_phrase}')
        sys.exit(1)
architecture_rules_text = read_rel('tools/quality/rules/architecture-boundary.rules.json')
for required_phrase in ['authoritative', 'shadow', 'importBoundaries', 'tokenBoundaries', 'pathOwnership', 'shadow_error', 'shadow_aligned', 'includeFiles', 'excludeFiles', 'allowedPhrases']:
    if required_phrase not in architecture_rules_text:
        print(f'architecture-boundary rule source missing required token: {required_phrase}')
        sys.exit(1)

cocos_session_registration_surface = quality_registry_text + json.dumps(package_json.get('scripts', {}), ensure_ascii=False)
for required_phrase in ['test.cocos-session', 'test:cocos-session', 'tests/cocos-runtime-session.test.ts']:
    if required_phrase not in cocos_session_registration_surface:
        print(f'cocos session test registry closure missing: {required_phrase}')
        sys.exit(1)

source_design_text = (ROOT / 'design_snapshot/SOURCE_DESIGN_PACK.txt').read_text(encoding='utf-8')
if f"code_package_version: {expected_code_version}" not in source_design_text:
    print(f'design_snapshot/SOURCE_DESIGN_PACK.txt must declare code_package_version: {expected_code_version}')
    sys.exit(1)
for rel in ['README.md', 'docs/ARCHITECTURE.md', 'docs/IMPLEMENTATION_SCOPE.md', 'docs/SOURCE_DESIGN_PACK.md', 'design_snapshot/SOURCE_DESIGN_PACK.txt', 'src/cocos-app/README.md']:
    text = (ROOT / rel).read_text(encoding='utf-8')
    old_marker_patterns = []
    for patch in range(0, 26):
        old_marker_patterns.extend([
            rf'v0\.0\.2\.{patch}(?![0-9])',
            rf'v0_0_2_{patch}(?![0-9])',
            rf'0\.0\.2-{patch}(?![0-9])',
        ])
    old_marker_patterns.extend([r'v0\.0\.1\.(8|9)', r'v0_0_1_(8|9)', r'0\.0\.1-9'])
    if re.search('|'.join(old_marker_patterns), text):
        print(f'Old code package version marker remains in {rel}')
        sys.exit(1)

current_scope_requirements = {
    'README.md': [
        expected_version_name,
        expected_chinese_version_name,
        'traceability',
        'TRACEABILITY_MATRIX',
        'traceability-map.json',
        'project-target.json',
        '本轮唯一目标',
        '后续建议不是授权目标',
        'tools/quality/rules/project-target.json',
        'tools/quality/rules/context-doc-surface.rules.json',
        'architecture-boundary.rules.json',
        'docs/GITHUB_WORKFLOW.md',
        'docs/PROJECT_MAP.md',
        'docs/DOCS_GOVERNANCE.md',
        'project-map-contracts',
        'Scope Discovery',
        'release gate 禁止 cache',
        'q:full',
        'test:project-map-contracts',
        'test:traceability-contracts',
    ],
    'docs/IMPLEMENTATION_SCOPE.md': [
        expected_version_name,
        expected_chinese_version_name,
        'traceability',
        'traceability-map.json',
        'TRACEABILITY_MATRIX',
        'project-target.json',
        'architecture-boundary.rules.json',
        'architecture-boundary-check.mjs',
        'authoritative',
        'shadow findings',
        '不进入 Stage 1B',
        '不接真实 Cocos',
        '不接 wx',
        '不删除旧 validator 核心红线',
        'planned',
        '不是当前实现',
    ],
    'docs/SOURCE_DESIGN_PACK.md': [
        f'code package version: `{expected_code_version}`',
        '正式包 v1.5.2.2',
        '代码包内部检查体系治理',
        '不改变正式包设定',
        '不把日志包或规划对话作为正式设计来源',
    ],
    'docs/CODE_CONTEXT_INDEX.md': [
        '执行前必读顺序',
        '预检报告必须包含',
        '未覆盖模块声明',
        '不跳过 ActionPipeline',
        '不直接改 SaveFile',
        '不接真实 `cc / wx / fs`',
        'UTF-8 metadata',
        'mojibake 路径',
        'Task Intent Lock',
        '本轮唯一目标',
        '后续建议不是授权目标',
        '外部执行指令',
        '版本号出现两个不同任务意图',
        '当前任务上下文交接来自外部执行指令或开发日志包',
        '代码包不保存每轮具体任务上下文',
        '代码包只保存执行端上下文治理约束',
        'architecture-boundary.rules.json',
        'architecture-boundary-check.mjs',
        'quality:architecture-boundary',
        'loadArchitectureBoundaryRules',
        '旧 validator 仍保留权威红线',
        'GITHUB_WORKFLOW.md',
        'PROJECT_MAP.md',
        'test:project-map-contracts',
        'test:traceability-contracts',
        'TRACEABILITY_MATRIX',
        'traceability-map.json',
        'Scope Discovery',
    ],
    'docs/CHECK_ARCHITECTURE.md': [
        expected_version_name,
        'traceability',
        'traceability-map.json',
        'traceability-contracts',
        'project-target.json',
        'architecture-boundary.rules.json',
        'architecture-boundary-check.mjs',
        'authoritative',
        'legacy validator',
        'shadow findings',
        'q:affected',
        'cache probe',
        'release gate 禁止 cache',
        'release gate 仍全量、无缓存、可复现',
    ],
}
for rel, required_phrases in current_scope_requirements.items():
    text = (ROOT / rel).read_text(encoding='utf-8')
    for required_phrase in required_phrases:
        if required_phrase not in text:
            print(f'Current package scope wording missing in {rel}: {required_phrase}')
            sys.exit(1)

for rel in FORBIDDEN_TASK_CONTEXT_FILES:
    if (ROOT / rel).exists():
        print(f'Concrete task context file must not enter code package: {rel}')
        sys.exit(1)

adr4_rel = 'docs/adr/ADR-0004-context-governance-artifacts-are-versioned-contracts.md'
adr4_text = read_rel(adr4_rel)
if 'tests/context-governance-contracts.test.ts' in adr4_text:
    print('ADR-0004 must not reference non-existent tests/context-governance-contracts.test.ts')
    sys.exit(1)
if 'tests/context-governance-contracts.test.mjs' not in adr4_text:
    print('ADR-0004 must reference tests/context-governance-contracts.test.mjs')
    sys.exit(1)
if not (ROOT / 'tests/context-governance-contracts.test.mjs').exists():
    print('tests/context-governance-contracts.test.mjs must exist')
    sys.exit(1)
for rel in markdown_referenced_paths(adr4_text):
    if not (ROOT / rel).exists():
        print(f'ADR-0004 references missing path: {rel}')
        sys.exit(1)

assert_contains('docs/CODE_CONTEXT_INDEX.md', [
    'Task Intent Lock',
    '任务意图',
    '后续建议不是授权目标',
    '外部执行指令',
    '当前任务上下文交接来自外部执行指令或开发日志包',
    '代码包不保存每轮具体任务上下文',
    '代码包只保存执行端上下文治理约束',
])

adr_dir = ROOT / 'docs' / 'adr'
adr_text = '\n'.join(p.read_text(encoding='utf-8') for p in adr_dir.glob('*.md'))
for required_phrase in [
    'game-core 必须保持 engine-neutral / platform-neutral',
    '所有正式状态变化必须通过',
    '读档失败不得污染当前 session',
    '上下文治理文件必须随代码包版本化',
    'Task Intent Lock',
    '后续建议不是授权目标',
    '## 后果',
    '## 禁止项',
    '## 验证',
]:
    if required_phrase not in adr_text:
        print(f'ADR governance content missing: {required_phrase}')
        sys.exit(1)

contract_dir = ROOT / 'docs' / 'module_contracts'
contract_text = '\n'.join(p.read_text(encoding='utf-8') for p in contract_dir.glob('*.md'))
for required_phrase in [
    'CocosAppRuntimeSession',
    'CocosSessionHost',
    'MinimalMenuInteractionController',
    'SaveLoadInteractionController',
    'CocosActionPreviewer',
    'CocosActionDraftBuilder',
    'SaveStoragePort',
    'CocosErrorPresenter',
    'CocosUiShellController',
    'CocosUiShellCommandQueue',
    'CocosUiShellSnapshotDiff',
    'CocosSceneBindingPort',
    'CocosSceneBindingController',
    'CocosComponentNodeBindingPort',
    'QinglanUiSceneProbeComponent',
    '## 职责',
    '## 允许依赖',
    '## 禁止依赖',
    '## 不变量',
    '## 关联测试',
    'load 失败不得污染当前 session',
    'confirm 必须最终走 `session.dispatch -> ActionPipeline`',
    'Queue 是表现层命令排队，不是业务事务系统',
    'Diff 是节点绑定前置摘要，不是 JSON Patch 引擎',
    'Scene Binding Boundary Stub 是抽象场景绑定边界，不是真实 Cocos 场景实现',
    'Component Node Binding Adapter Probe',
    'Patch payload 必须拷贝',
]:
    if required_phrase not in contract_text:
        print(f'Module contract content missing: {required_phrase}')
        sys.exit(1)

context_test_text = (ROOT / 'tests/context-governance-contracts.test.mjs').read_text(encoding='utf-8')
for required_phrase in ['CODE_CONTEXT_INDEX', 'ADR', 'module contracts', 'CocosUiShellController', 'CocosUiShellCommandQueue', 'CocosUiShellSnapshotDiff', 'CocosSceneBindingController', 'CocosSceneBindingPort', 'CocosComponentNodeBindingPort', 'QinglanUiSceneProbeComponent', expected_npm_version, 'Task Intent Lock', '后续建议不是授权目标', '外部执行指令', 'tests/context-governance-contracts.test.mjs', expected_version_name, 'test:traceability-contracts']:
    if required_phrase not in context_test_text:
        print(f'context-governance-contracts.test.mjs missing required governance assertion token: {required_phrase}')
        sys.exit(1)



escaped_old_marker_patterns = []
for patch in range(0, 26):
    escaped_old_marker_patterns.extend([
        rf'v0\\\.0\\\.2\\\.{patch}(?![0-9])',
        rf'0\\\.0\\\.2-{patch}(?![0-9])',
    ])
for test_file in (ROOT / 'tests').rglob('*'):
    if test_file.is_file() and test_file.suffix in {'.ts', '.mjs'}:
        test_text = test_file.read_text(encoding='utf-8')
        if re.search('|'.join(escaped_old_marker_patterns), test_text):
            print(f'Escaped old code package version assertion remains in {test_file.relative_to(ROOT)}')
            sys.exit(1)

package_hygiene_test_text = (ROOT / 'tests/package-hygiene.test.mjs').read_text(encoding='utf-8')
for required_phrase in ['__pycache__', '*.pyc', 'node_modules', 'dist', 'coverage', '.DS_Store', '开发日志包', 'validate_code_architecture.py', 'build_release_package.py', 'check_release_zip.py', 'UTF8_FLAG', 'mojibake']:
    if required_phrase not in package_hygiene_test_text:
        print(f'package-hygiene.test.mjs missing required hygiene assertion token: {required_phrase}')
        sys.exit(1)


for rel in [
    'src/game-core/dev/Stage1AHeadlessRuntime.ts',
    'src/game-core/dev/Stage1AActionScriptRunner.ts',
    'src/game-core/action/ActionRequestBuilder.ts',
    'src/game-core/runtime/RuntimeStateSummary.ts',
    'src/cocos-app/adapters/CocosActionDispatcher.ts',
    'src/cocos-app/runtime/CocosAppRuntimeSession.ts',
    'src/game-core/save/SaveStoragePort.ts'
]:
    text = (ROOT / rel).read_text(encoding='utf-8')
    for forbidden_token in ['Stage1AFixtureRunner', 'save_result_aliases', 'fixture_id', 'wx.']:
        if forbidden_token in text:
            print(f'Runtime leaked fixture runner mechanics in {rel}: {forbidden_token}')
            sys.exit(1)

headless_text = '\n'.join((ROOT / rel).read_text(encoding='utf-8') for rel in [
    'src/game-core/dev/Stage1AHeadlessRuntime.ts',
    'src/game-core/dev/Stage1AActionScriptRunner.ts'
])
for forbidden_token in ['system.load_config_profile', 'system.start_new_game', 'system.save_and_load_roundtrip', 'system.inject_active_reservation', 'system.release_reservation']:
    if forbidden_token in headless_text:
        print(f'Headless runtime uses fixture system action token: {forbidden_token}')
        sys.exit(1)
for required_token in ['ActionPipeline', 'pipeline.dispatch', 'assertSaveFile', 'StorageAudit', 'RuntimeStateSummary']:
    if required_token not in headless_text:
        print(f'Headless runtime missing required formal runtime token: {required_token}')
        sys.exit(1)

builder_text = (ROOT / 'src/game-core/action/ActionRequestBuilder.ts').read_text(encoding='utf-8')
for required_token in ['request_id', 'actor_id', 'created_time', 'idempotency_key', 'parameters', 'ERR_DEV_RUNNER_SYSTEM_ACTION_FORBIDDEN', 'isFormalStage1AActionType']:
    if required_token not in builder_text:
        print(f'ActionRequestBuilder missing required request envelope token: {required_token}')
        sys.exit(1)
for forbidden_token in ['SaveFile', 'save_file', 'created_objects[0]', 'order_id ==', 'const formalStage1AActions']:
    if forbidden_token in builder_text:
        print(f'ActionRequestBuilder contains business/state shortcut or duplicated action list: {forbidden_token}')
        sys.exit(1)

validator_text = (ROOT / 'src/game-core/action/FormalStage1AActionValidator.ts').read_text(encoding='utf-8')
for required_token in ['FORMAL_STAGE_1A_ACTION_TYPES', 'STAGE_1A_REQUIRED_PARAMETERS']:
    if required_token not in validator_text:
        print(f'FormalStage1AActionValidator missing shared action catalog token: {required_token}')
        sys.exit(1)

summary_text = (ROOT / 'src/game-core/runtime/RuntimeStateSummary.ts').read_text(encoding='utf-8')
for forbidden_pattern in [r'save\.[A-Za-z0-9_]+\s*=', r'save_file\.[A-Za-z0-9_]+\s*=']:
    if re.search(forbidden_pattern, summary_text):
        print(f'RuntimeStateSummary appears to mutate SaveFile: {forbidden_pattern}')
        sys.exit(1)

cocos_dispatcher_text = (ROOT / 'src/cocos-app/adapters/CocosActionDispatcher.ts').read_text(encoding='utf-8')
for required_token in ['ActionRequestBuilder', 'FormalStage1AActionType', 'assertFormalActionType', 'pipeline.dispatch']:
    if required_token not in cocos_dispatcher_text:
        print(f'CocosActionDispatcher missing formal request boundary token: {required_token}')
        sys.exit(1)
for forbidden_token in ['action_type: string', 'ActionRequest<string']:
    if forbidden_token in cocos_dispatcher_text:
        print(f'CocosActionDispatcher still accepts unbounded string action type: {forbidden_token}')
        sys.exit(1)

cocos_facade_text = (ROOT / 'src/cocos-app/adapters/CocosRuntimeFacade.ts').read_text(encoding='utf-8')
for required_token in ['CocosActionDispatcher', 'RuntimeStateSummary', 'CocosStateViewModel', 'CocosSelectableViewModel', 'CocosActionPreviewer', 'ActionResult']:
    if required_token not in cocos_facade_text:
        print(f'CocosRuntimeFacade missing presentation facade token: {required_token}')
        sys.exit(1)

cocos_session_text = (ROOT / 'src/cocos-app/runtime/CocosAppRuntimeSession.ts').read_text(encoding='utf-8')
for required_token in ['CocosActionDispatcher', 'CocosRuntimeFacade', 'SaveManager', 'SaveStoragePort', 'assertSaveFile', 'StorageAudit', 'dispatch', 'getViewModel', 'getSelectableViewModel', 'preview']:
    if required_token not in cocos_session_text:
        print(f'CocosAppRuntimeSession missing session/save boundary token: {required_token}')
        sys.exit(1)
for forbidden_token in ['Stage1AFixtureRunner', 'Stage1AHeadlessRuntime', 'Stage1AActionScriptRunner', 'system.inject_active_reservation', 'system.release_reservation', 'game-core/dev-api', 'game-core/testing-api']:
    if forbidden_token in cocos_session_text:
        print(f'CocosAppRuntimeSession leaked forbidden runtime boundary token: {forbidden_token}')
        sys.exit(1)

save_port_text = (ROOT / 'src/game-core/save/SaveStoragePort.ts').read_text(encoding='utf-8')
for required_token in ['SaveStoragePort', 'InMemorySaveStoragePort', 'write', 'read']:
    if required_token not in save_port_text:
        print(f'SaveStoragePort missing platform-neutral port token: {required_token}')
        sys.exit(1)
for forbidden_token in ["from 'node:fs'", 'from "node:fs"', "from 'fs'", 'from "fs"', "from 'cc'", 'from "cc"', 'wx.']:
    if forbidden_token in save_port_text:
        print(f'SaveStoragePort is not platform-neutral: {forbidden_token}')
        sys.exit(1)

for view_model_rel in ['src/cocos-app/view-models/CocosStateViewModel.ts', 'src/cocos-app/view-models/CocosSelectableViewModel.ts']:
    view_model_text = (ROOT / view_model_rel).read_text(encoding='utf-8')
    for forbidden_pattern in [r'save\.[A-Za-z0-9_]+\s*=', r'save_file\.[A-Za-z0-9_]+\s*=', r'\.inventory\s*=', r'\.orders\s*=', r'\.dish_lots\s*=', r'\.reservations\s*=']:
        if re.search(forbidden_pattern, view_model_text):
            print(f'{view_model_rel} appears to mutate runtime state: {forbidden_pattern}')
            sys.exit(1)

must_contain = {
    'ActionPipeline.ts': ['FormalStage1AActionValidator', 'TransactionRunner', 'StorageReconciler', 'assertActionRequest', 'assertActionResult', 'ERR_PREVIEW_ONLY_NOT_ALLOWED_IN_FORMAL_DISPATCH'],
    'NewGameBuilder.ts': ['rule_versions.yaml', 'storageReconciler.reconcile', 'featureFlags.buildSnapshot'],
    'StorageOccupant.ts': ['MaterialLot', 'DishLot', 'StorageOccupantRef', 'storage_footprint'],
    'StorageReconciler.ts': ['listStorageOccupants', 'active_object_refs', 'used_capacity'],
    'CocosActionDispatcher.ts': ['ActionRequestBuilder', 'FormalStage1AActionType', 'pipeline.dispatch', 'save_file'],
    'CocosRuntimeFacade.ts': ['CocosActionDispatcher', 'RuntimeStateSummary', 'CocosStateViewModel', 'CocosSelectableViewModel', 'CocosActionPreviewer', 'ActionResult'],
    'CocosStateViewModel.ts': ['RuntimeStateSummaryData', 'money', 'orders', 'recent_events'],
    'CocosSelectableViewModel.ts': ['field_options', 'seed_lot_options', 'harvestable_crop_options', 'processable_lot_options', 'cookable_recipe_options', 'storage_target_options', 'processing_facility_options'],
    'CocosActionDraftBuilder.ts': ['plantCrop', 'splitLot', 'startProcessing', 'cookDish', 'submitOrder', 'ERR_DRAFT_ID_INVALID'],
    'CocosActionPreviewer.ts': ['structuredClone', 'new GameRuntime', 'pipeline.dispatch', 'domain_events_written', 'real_id_sequence_consumed'],
    'CocosAppRuntimeSession.ts': ['CocosActionDispatcher', 'CocosRuntimeFacade', 'SaveManager', 'SaveStoragePort', 'assertSaveFile', 'StorageAudit', 'dispatch', 'getViewModel', 'getSelectableViewModel', 'preview'],
    'SaveStoragePort.ts': ['SaveStoragePort', 'InMemorySaveStoragePort', 'write', 'read'],
    'RuntimeSchemaValidator.ts': ['Ajv2020', 'assertValid', 'ERR_SCHEMA_VALIDATION_FAILED'],
    'RuntimeContractValidator.ts': ['assertActionRequest', 'assertActionResult', 'assertSaveFile', 'assertProcessingTask', 'assertMaterialLot', 'assertDishLot', 'assertOrder', 'assertReservation'],
    'Stage1AFixtureRunner.ts': ['runFixtureThroughStepId', 'system.load_config_profile', 'system.start_new_game', 'system.save_and_load_roundtrip', 'system.inject_active_reservation', 'system.release_reservation'],
    'StorageAudit.ts': ['ERR_STORAGE_GHOST_REF', 'ERR_STORAGE_USED_CAPACITY_MISMATCH', 'ERR_RESERVATION_TARGET_MISSING', 'ERR_RESERVATION_QUANTITY_EXCEEDS_LOT', 'assertReconciled'],
    'ReservationGuard.ts': ['activeReservedQuantityForLot', 'assertNoActiveReservationForConsumption', 'ERR_ALREADY_RESERVED', 'ERR_RESERVATION_QUANTITY_EXCEEDS_LOT'],
    'ActionRequestBuilder.ts': ['request_id', 'actor_id', 'created_time', 'idempotency_key', 'ERR_DEV_RUNNER_SYSTEM_ACTION_FORBIDDEN', 'isFormalStage1AActionType'],
    'FormalStage1AActionCatalog.ts': ['FORMAL_STAGE_1A_ACTION_TYPES', 'STAGE_1A_REQUIRED_PARAMETERS', 'isFormalStage1AActionType'],
    'FormalStage1AActionValidator.ts': ['FORMAL_STAGE_1A_ACTION_TYPES', 'STAGE_1A_REQUIRED_PARAMETERS'],
    'Stage1AHeadlessRuntime.ts': ['ActionRequestBuilder', 'pipeline.dispatch', 'assertSaveFile', 'StorageAudit', 'RuntimeStateSummary'],
    'Stage1AActionScriptRunner.ts': ['plant_crop', 'start_processing', 'collect_processing_result', 'cook_dish', 'submit_order'],
    'RuntimeStateSummary.ts': ['world_time', 'player_state', 'inventory', 'dish_lots', 'processing_tasks', 'orders', 'active_reservation_count'],
    'ProcessingConfigResolver.ts': ['resolveMethod', 'configs/processing/methods/'],
    'CookingConfigResolver.ts': ['resolveRecipeVariant', 'resolveDishStructure', 'configs/cooking/recipe_variants/', 'configs/cooking/dish_structures/'],
    'CookingSystem.ts': ['RecipeConfigResolver', 'dish_profile', 'components', 'suitability_tags', 'storage_footprint'],
    'DemandResolver.ts': ['resolveDemandProfile', 'configs/demands/', 'hard_requirements', 'weighted_requirements', 'reward_final'],
    'MenuActionBinding.ts': ['CocosActionDraftBuilder', 'buildDraft', 'processing_facility_options', 'ERR_MENU_OPTION_NOT_FOUND'],
    'MinimalMenuInteractionController.ts': ['getSelectableViewModel', 'preview', 'dispatch', 'refresh'],
    'MinimalMenuPresenter.ts': ['renderViewModel', 'renderSelectableViewModel', 'renderPreviewResult', 'renderActionResult'],
    'MenuRenderSnapshot.ts': ['view_model', 'selectable_view_model', 'last_preview_result', 'last_action_result'],
}

for filename, needles in must_contain.items():
    matches = list((ROOT / 'src').rglob(filename))
    if not matches:
        print('File missing for check:', filename)
        sys.exit(1)
    text = matches[0].read_text(encoding='utf-8')
    for needle in needles:
        if needle not in text:
            print(f'{filename} missing required architecture token: {needle}')
            sys.exit(1)

baseline_text = (ROOT / 'tests/stage1a-baseline.test.ts').read_text(encoding='utf-8')
for required_token in ['FORMAL_STAGE_1A_ACTION_TYPES', 'Stage1AFixtureRunner', 'Stage1AHeadlessRuntime', 'CocosAppRuntimeSession', 'InMemorySaveStoragePort', 'assertStage1ABaselineSaveFile']:
    if required_token not in baseline_text:
        print(f'stage1a-baseline.test.ts missing required baseline token: {required_token}')
        sys.exit(1)

ui_readiness_text = (ROOT / 'tests/cocos-ui-readiness.test.ts').read_text(encoding='utf-8')
for required_token in ['getSelectableViewModel', 'CocosActionDraftBuilder', 'seed_lot_options', 'harvestable_crop_options', 'processable_lot_options']:
    if required_token not in ui_readiness_text:
        print(f'cocos-ui-readiness.test.ts missing required UI readiness token: {required_token}')
        sys.exit(1)

preview_text = (ROOT / 'tests/action-preview-boundary.test.ts').read_text(encoding='utf-8')
for required_token in ['preview', 'ERR_PREVIEW_ONLY_NOT_ALLOWED_IN_FORMAL_DISPATCH', 'real_id_sequence_consumed', 'domain_events_written']:
    if required_token not in preview_text:
        print(f'action-preview-boundary.test.ts missing required preview boundary token: {required_token}')
        sys.exit(1)


menu_test_text = (ROOT / 'tests/cocos-minimal-menu-binding.test.ts').read_text(encoding='utf-8')
for required_token in ['MinimalMenuInteractionController', 'selectable -> draft -> preview -> confirm dispatch -> refresh', 'processing_facility_options', 'test:cocos-menu']:
    if required_token not in menu_test_text and required_token != 'test:cocos-menu':
        print(f'cocos-minimal-menu-binding.test.ts missing required menu binding token: {required_token}')
        sys.exit(1)
if 'tests/cocos-minimal-menu-binding.test.ts' not in check_surface:
    print('npm run check must include tests/cocos-minimal-menu-binding.test.ts')
    sys.exit(1)

menu_dir = ROOT / 'src' / 'cocos-creator-adapter' / 'menu'
menu_text = '\n'.join(p.read_text(encoding='utf-8') for p in menu_dir.rglob('*.ts'))
for required_token in ['MinimalMenuPresenter', 'MinimalMenuInteractionController', 'MenuActionBinding', 'MenuRenderSnapshot', 'getSelectableViewModel', 'preview', 'dispatch']:
    if required_token not in menu_text:
        print(f'Minimal menu binding missing required token: {required_token}')
        sys.exit(1)
for forbidden_token in ['game-core/dev-api', 'game-core/testing-api', 'Stage1AFixtureRunner', 'Stage1AHeadlessRuntime', 'Stage1AActionScriptRunner', "from 'cc'", 'from "cc"', "from 'node:fs'", 'from "node:fs"', "from 'fs'", 'from "fs"', 'wx.', 'field_plot_01', 'seed_cabbage_initial_001', 'salt_initial_001', 'pickling_jar_basic_01', 'tavern_home_dish_001']:
    if forbidden_token in menu_text:
        print(f'Minimal menu binding leaked forbidden token: {forbidden_token}')
        sys.exit(1)
for forbidden_pattern in [r'\.inventory\s*=', r'\.orders\s*=', r'\.dish_lots\s*=', r'\.reservations\s*=', r'\.money\s*=']:
    if re.search(forbidden_pattern, menu_text):
        print(f'Minimal menu binding appears to mutate core state directly: {forbidden_pattern}')
        sys.exit(1)

shell_test_text = (ROOT / 'tests/cocos-ui-shell-composition.test.ts').read_text(encoding='utf-8')
for required_token in ['CocosUiShellController', 'menu_preview', 'menu_confirm', 'ERR_COCOS_SESSION_LOAD_REJECTED', 'test:cocos-ui-shell']:
    if required_token not in shell_test_text and required_token != 'test:cocos-ui-shell':
        print(f'cocos-ui-shell-composition.test.ts missing required shell token: {required_token}')
        sys.exit(1)
if 'tests/cocos-ui-shell-composition.test.ts' not in check_surface:
    print('npm run check must include tests/cocos-ui-shell-composition.test.ts')
    sys.exit(1)
for required_shell_check in ['tests/cocos-ui-command-queue.test.ts', 'tests/cocos-ui-render-diff.test.ts', 'tests/cocos-scene-binding-boundary.test.ts', 'tests/cocos-scene-binding-application.test.ts', 'tests/cocos-component-node-binding-boundary.test.ts', 'tests/cocos-component-node-binding-application.test.ts']:
    if required_shell_check not in check_surface:
        print(f'npm run check must include {required_shell_check}')
        sys.exit(1)
for script_name in ['test:cocos-ui-command-queue', 'test:cocos-ui-render-diff', 'test:cocos-scene-binding', 'test:cocos-component-node-binding']:
    if script_name not in package_json.get('scripts', {}):
        print(f'package.json missing required script: {script_name}')
        sys.exit(1)


scene_dir = ROOT / 'src' / 'cocos-creator-adapter' / 'scene'
scene_text = '\n'.join(p.read_text(encoding='utf-8') for p in scene_dir.rglob('*.ts'))
for required_token in ['CocosSceneBindingPort', 'CocosSceneBindingController', 'CocosSceneBindingSnapshotApplier', 'CocosSceneBindingUpdate', 'CocosUiShellCommandQueue', 'diffCocosUiShellSnapshots']:
    if required_token not in scene_text:
        print(f'Scene binding source missing required token: {required_token}')
        sys.exit(1)
for forbidden_token in ['game-core/dev-api', 'game-core/testing-api', 'Stage1AFixtureRunner', 'Stage1AHeadlessRuntime', 'Stage1AActionScriptRunner', "from 'cc'", 'from "cc"', "from 'node:fs'", 'from "node:fs"', "from 'fs'", 'from "fs"', 'wx.', 'GameState', 'SaveFile', 'save_file', 'InventoryLot', 'Order', 'inventory', 'orders', 'dish_lots', 'reservations', 'field_plot_01', 'seed_cabbage_initial_001', 'tavern_home_dish_001']:
    if forbidden_token in scene_text:
        print(f'Scene binding leaked forbidden token: {forbidden_token}')
        sys.exit(1)
for forbidden_pattern in [r'\.inventory\s*=', r'\.orders\s*=', r'\.dish_lots\s*=', r'\.reservations\s*=', r'\.money\s*=']:
    if re.search(forbidden_pattern, scene_text):
        print(f'Scene binding appears to mutate core state directly: {forbidden_pattern}')
        sys.exit(1)


component_dir = ROOT / 'src' / 'cocos-creator-adapter' / 'component'
component_text = '\n'.join(p.read_text(encoding='utf-8') for p in component_dir.rglob('*.ts'))
for required_token in ['CocosComponentNodeBindingPort', 'CocosComponentNodeBindingAdapter', 'QinglanUiSceneProbeComponent', 'CocosComponentNodeBindingPatch', 'mapSceneSectionToNodeTarget', 'CocosSceneBindingController', 'CocosUiShellController']:
    if required_token not in component_text:
        print(f'Component node binding source missing required token: {required_token}')
        sys.exit(1)
for forbidden_token in ['game-core/dev-api', 'game-core/testing-api', 'Stage1AFixtureRunner', 'Stage1AHeadlessRuntime', 'Stage1AActionScriptRunner', "from 'cc'", 'from "cc"', "from 'node:fs'", 'from "node:fs"', "from 'fs'", 'from "fs"', 'wx.', 'GameState', 'SaveFile', 'save_file', 'InventoryLot', 'Order', 'inventory', 'orders', 'dish_lots', 'reservations', 'field_plot_01', 'seed_cabbage_initial_001', 'tavern_home_dish_001']:
    if forbidden_token in component_text:
        print(f'Component node binding leaked forbidden token: {forbidden_token}')
        sys.exit(1)
for forbidden_pattern in [r'\.inventory\s*=', r'\.orders\s*=', r'\.dish_lots\s*=', r'\.reservations\s*=', r'\.money\s*=']:
    if re.search(forbidden_pattern, component_text):
        print(f'Component node binding appears to mutate core state directly: {forbidden_pattern}')
        sys.exit(1)

draft_builder_text = (ROOT / 'src/cocos-app/adapters/CocosActionDraftBuilder.ts').read_text(encoding='utf-8')
for forbidden_token in ['field_plot_01', 'seed_cabbage_initial_001', 'tavern_home_dish_001', 'pickling_jar_basic_01']:
    if forbidden_token in draft_builder_text:
        print(f'CocosActionDraftBuilder hardcoded fixture/initial ID: {forbidden_token}')
        sys.exit(1)



# Legacy validator only keeps a lightweight guard that the migrated governance plugins exist
# and are registered. The detailed governance checks live in tools/quality/plugins.
quality_registry = json.loads((ROOT / 'tools/quality/test-registry.json').read_text(encoding='utf-8'))
required_quality_plugins = {
    'quality.versionConsistency': 'tools/quality/plugins/version-consistency-check.mjs',
    'quality.configIntegrity': 'tools/quality/plugins/quality-config-integrity-check.mjs',
    'quality.testRegistryIntegrity': 'tools/quality/plugins/test-registry-integrity-check.mjs',
    'quality.releaseSurface': 'tools/quality/plugins/release-surface-check.mjs',
    'quality.contextDocSurface': 'tools/quality/plugins/context-doc-surface-check.mjs',
}
for task_id, plugin_rel in required_quality_plugins.items():
    task = quality_registry.get('tests', {}).get(task_id)
    if not task:
        print(f'test-registry.json missing migrated governance plugin task: {task_id}')
        sys.exit(1)
    if task.get('type') != 'quality-plugin' or task.get('group') != 'quality':
        print(f'migrated governance plugin task has wrong type/group: {task_id}')
        sys.exit(1)
    if plugin_rel not in task.get('args', []):
        print(f'migrated governance plugin task does not invoke expected file: {task_id} -> {plugin_rel}')
        sys.exit(1)
    if not (ROOT / plugin_rel).exists():
        print(f'migrated governance plugin file missing: {plugin_rel}')
        sys.exit(1)
if not (ROOT / 'tests/quality-plugin-contracts.test.mjs').exists():
    print('tests/quality-plugin-contracts.test.mjs must exist')
    sys.exit(1)
if 'test.quality-plugin-contracts' not in quality_registry.get('tests', {}):
    print('test-registry.json missing quality plugin contract test task')
    sys.exit(1)
print('architecture check passed')
