import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { resolveGateTasks } from '../tools/quality/lib/resolveGateTasks.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const workflowDocument = parseDocument(readFileSync('.github/workflows/quality.yml', 'utf8'), { uniqueKeys: true });
assert.deepEqual(workflowDocument.errors, [], 'workflow must be valid, unambiguous YAML');
const workflow = workflowDocument.toJS();

function assertCiContract(value) {
  assert.deepEqual(Object.keys(value.on).sort(), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(value.on.pull_request, { branches: ['main'] }, 'every PR to main must run without path or type filters');
  assert.deepEqual(value.permissions, { contents: 'read' });
  assert.equal(value.defaults, undefined);
  assert.equal(value.concurrency['cancel-in-progress'], true);
  assert.match(value.concurrency.group, /github\.event\.pull_request\.number/);
  assert.match(value.concurrency.group, /github\.ref/);
  assert.deepEqual(Object.keys(value.jobs), ['q-full']);
  const job = value.jobs['q-full'];
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 15);
  assert.ok(job['continue-on-error'] === undefined || job['continue-on-error'] === false);
  for (const field of ['if', 'permissions', 'strategy', 'defaults']) assert.equal(job[field], undefined);

  for (const step of job.steps) {
    assert.ok(step['continue-on-error'] === undefined || step['continue-on-error'] === false, 'step failures must propagate');
    if (step.uses) assert.match(step.uses, /^actions\/(checkout|setup-node|setup-python|upload-artifact)@[a-f0-9]{40}$/);
    if (!step.uses?.startsWith('actions/upload-artifact@')) assert.equal(step.if, undefined, 'required steps must not be skipped');
  }
  const action = (name) => {
    const matches = job.steps.filter((step) => step.uses?.startsWith(`actions/${name}@`));
    assert.equal(matches.length, 1, `one ${name} action is required`);
    return matches[0];
  };
  const checkout = action('checkout');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(checkout.with.ref, undefined, 'check the PR merge commit, not only its head');
  const node = action('setup-node');
  assert.equal(String(node.with['node-version']), '24');
  assert.equal(node.with['package-manager-cache'], false);
  const python = action('setup-python');
  assert.equal(String(python.with['python-version']), '3.12');
  const install = job.steps.filter((step) => step.id === 'install');
  const quality = job.steps.filter((step) => step.id === 'quality');
  assert.equal(install.length, 1);
  assert.equal(quality.length, 1);
  assert.equal(install[0].run.trim(), 'npm ci', 'install from the lockfile');
  assert.equal(quality[0].run.trim(), 'npm run q:full', 'do not replace full with affected or mask its exit code');
  const upload = action('upload-artifact');
  assert.ok(['always()', '${{ always() }}'].includes(upload.if), 'preserve reports even after failure');
  assert.deepEqual(upload.with.path.trim().split(/\s+/).sort(), ['reports/quality/latest.json', 'reports/quality/latest.md']);
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with['retention-days'], 7);
  assert.match(upload.with.name, /github\.run_id/);
  assert.match(upload.with.name, /github\.run_attempt/);
  const index = (step) => job.steps.indexOf(step);
  assert.ok(index(checkout) < index(node) && index(checkout) < index(python));
  assert.ok(Math.max(index(node), index(python)) < index(install[0]));
  assert.ok(index(install[0]) < index(quality[0]) && index(quality[0]) < index(upload));
}

test('PR workflow runs the full gate with read-only permissions and failure reports', () => {
  assertCiContract(workflow);
});

test('CI contract rejects skipped checks, masked failures, privileged events and missing reports', async (t) => {
  const cases = [
    ['affected replacing full', (w) => { w.jobs['q-full'].steps.find((s) => s.id === 'quality').run = 'npm run q:affected'; }],
    ['masked exit code', (w) => { w.jobs['q-full'].steps.find((s) => s.id === 'quality').run += ' || true'; }],
    ['step failure ignored', (w) => { w.jobs['q-full'].steps.find((s) => s.id === 'quality')['continue-on-error'] = true; }],
    ['job failure ignored', (w) => { w.jobs['q-full']['continue-on-error'] = true; }],
    ['conditional job', (w) => { w.jobs['q-full'].if = '!github.event.pull_request.draft'; }],
    ['PR path filter', (w) => { w.on.pull_request.paths = ['src/**']; }],
    ['privileged PR event', (w) => { w.on.pull_request_target = w.on.pull_request; delete w.on.pull_request; }],
    ['write permission', (w) => { w.permissions.contents = 'write'; }],
    ['mutable action tag', (w) => { w.jobs['q-full'].steps[0].uses = 'actions/checkout@v7'; }],
    ['persisted credentials', (w) => { w.jobs['q-full'].steps[0].with['persist-credentials'] = true; }],
    ['report only on success', (w) => { w.jobs['q-full'].steps.at(-1).if = 'success()'; }],
    ['missing reports only warn', (w) => { w.jobs['q-full'].steps.at(-1).with['if-no-files-found'] = 'warn'; }],
    ['JSON report omitted', (w) => { w.jobs['q-full'].steps.at(-1).with.path = 'reports/quality/latest.md'; }]
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const invalid = structuredClone(workflow);
      mutate(invalid);
      assert.throws(() => assertCiContract(invalid));
    });
  }
});

test('CI workflow contract is registered, traced and selected by full and release gates', () => {
  assert.equal(readJson('package.json').scripts['test:ci-workflow-contracts'], 'node --test tests/ci-workflow-contracts.test.mjs');
  const registry = readJson('tools/quality/test-registry.json');
  const policy = readJson('tools/quality/gate-policy.json');
  const task = registry.tests['test.ci-workflow-contracts'];
  assert.equal(task.stability, 'blocker');
  for (const tag of ['quality', 'full', 'blocker']) assert.ok(task.tags.includes(tag));
  assert.deepEqual(task.args, ['--test', 'tests/ci-workflow-contracts.test.mjs']);
  for (const gate of ['full', 'release']) assert.ok(resolveGateTasks(gate, policy, registry).some((t) => t.id === 'test.ci-workflow-contracts'));
  const modules = readJson('tools/quality/module-graph.json');
  assert.ok(modules.modules.tools.roots.includes('.github/workflows/**'));
  const trace = readJson('tools/quality/rules/traceability-map.json');
  assert.ok(trace.currentFullReleaseTraceIds.includes('trace.quality.pr-ci'));
  const entry = trace.entries.find((item) => item.id === 'trace.quality.pr-ci');
  assert.equal(entry.status, 'active');
  assert.ok(entry.sourceRefs.includes('.github/workflows/quality.yml'));
  assert.ok(entry.testRefs.includes('test.ci-workflow-contracts'));
});
