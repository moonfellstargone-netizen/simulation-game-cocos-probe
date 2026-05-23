import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

test('game-core public barrel does not export dev or testing APIs', () => {
  const publicIndex = readFileSync(join(process.cwd(), 'src/game-core/index.ts'), 'utf8');
  for (const forbidden of [
    './testing/Stage1AFixtureRunner',
    './dev/Stage1AHeadlessRuntime',
    './dev/Stage1AActionScriptRunner',
    './dev-api',
    './testing-api'
  ]) {
    assert.equal(publicIndex.includes(forbidden), false, `public index leaked ${forbidden}`);
  }
  assert.equal(publicIndex.includes("./action/ActionRequestBuilder"), true);
  assert.equal(publicIndex.includes("./runtime/RuntimeStateSummary"), true);
});

test('dev and testing APIs are split into explicit barrels', () => {
  const devApi = readFileSync(join(process.cwd(), 'src/game-core/dev-api.ts'), 'utf8');
  const testingApi = readFileSync(join(process.cwd(), 'src/game-core/testing-api.ts'), 'utf8');

  assert.equal(devApi.includes('./dev/Stage1AHeadlessRuntime'), true);
  assert.equal(devApi.includes('./dev/Stage1AActionScriptRunner'), true);
  assert.equal(devApi.includes('Stage1AFixtureRunner'), false);
  assert.equal(testingApi.includes('./testing/Stage1AFixtureRunner'), true);
  assert.equal(testingApi.includes('Stage1AHeadlessRuntime'), false);
});

test('ActionRequestBuilder and RuntimeStateSummary live in public runtime layers, not dev folder', () => {
  assert.equal(existsSync(join(process.cwd(), 'src/game-core/action/ActionRequestBuilder.ts')), true);
  assert.equal(existsSync(join(process.cwd(), 'src/game-core/runtime/RuntimeStateSummary.ts')), true);
  assert.equal(existsSync(join(process.cwd(), 'src/game-core/dev/ActionRequestBuilder.ts')), false);
  assert.equal(existsSync(join(process.cwd(), 'src/game-core/dev/RuntimeStateSummary.ts')), false);
});

test('Cocos adapter imports only public game-core API and never dev/testing API', () => {
  const files = collectFiles(join(process.cwd(), 'src/cocos-app')).filter((file) => file.endsWith('.ts'));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.equal(source.includes('../../game-core/dev-api'), false, `${file} imports dev-api`);
    assert.equal(source.includes('../../game-core/testing-api'), false, `${file} imports testing-api`);
    assert.equal(source.includes('Stage1AFixtureRunner'), false, `${file} mentions fixture runner`);
    assert.equal(source.includes('Stage1AHeadlessRuntime'), false, `${file} mentions headless runtime`);
    assert.equal(source.includes('Stage1AActionScriptRunner'), false, `${file} mentions action script runner`);
  }
});

test('dev runner imports dev API and fixture tests import testing API explicitly', () => {
  const script = readFileSync(join(process.cwd(), 'scripts/run-stage1a-headless.ts'), 'utf8');
  const headlessTest = readFileSync(join(process.cwd(), 'tests/stage1a-headless-runtime.test.ts'), 'utf8');
  const fixtureTest = readFileSync(join(process.cwd(), 'tests/stage1a-fixture-runner.test.ts'), 'utf8');

  assert.equal(script.includes('../src/game-core/dev-api'), true);
  assert.equal(headlessTest.includes('../src/game-core/dev-api'), true);
  assert.equal(headlessTest.includes('../src/game-core/testing-api'), true);
  assert.equal(fixtureTest.includes('../src/game-core/testing-api'), true);
});

test('formal action catalog is the single source used by validator and request builder', () => {
  const validator = readFileSync(join(process.cwd(), 'src/game-core/action/FormalStage1AActionValidator.ts'), 'utf8');
  const builder = readFileSync(join(process.cwd(), 'src/game-core/action/ActionRequestBuilder.ts'), 'utf8');

  assert.equal(validator.includes('STAGE_1A_REQUIRED_PARAMETERS'), true);
  assert.equal(validator.includes('FORMAL_STAGE_1A_ACTION_TYPES'), true);
  assert.equal(builder.includes('isFormalStage1AActionType'), true);
  assert.equal(builder.includes('const formalStage1AActions'), false);
});

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(full) : [full];
  });
}
