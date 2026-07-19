import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Lightweight repository governance contract for the PR CI quality gate workflow.
// This is NOT a full YAML linter: it normalizes lines, strips comments/blank lines,
// extracts indentation blocks, and applies small scoped positive/negative assertions
// so that trigger scope, Node version, permission boundary and the formal check
// command cannot silently regress. It intentionally avoids third-party YAML deps,
// fixed field ordering, exact whitespace counts, and locking step display names.

const root = process.cwd();
const workflowRel = '.github/workflows/quality-gate.yml';
const workflowPath = join(root, workflowRel);

function indentOf(line) {
  const match = /^(\s*)/.exec(line);
  return match ? match[1].length : 0;
}

// Strip an inline comment only when the line has no ${{ }} expression, to avoid
// corrupting GitHub expressions. Full-line comments are dropped in parseEntries.
function stripComment(line) {
  if (line.includes('${{')) return line;
  const idx = line.search(/\s#/);
  return idx === -1 ? line : line.slice(0, idx);
}

function parseEntries(text) {
  return text
    .split(/\r?\n/)
    .map((raw) => ({ raw, content: stripComment(raw) }))
    .filter((entry) => entry.content.trim() !== '')
    .map((entry) => {
      const trimmed = entry.content.trim();
      const keyMatch = /^([A-Za-z0-9_.-]+):(.*)$/.exec(trimmed);
      const itemMatch = /^-\s*(.*)$/.exec(trimmed);
      return {
        raw: entry.raw,
        content: entry.content,
        trimmed,
        indent: indentOf(entry.content),
        key: keyMatch ? keyMatch[1] : null,
        value: keyMatch ? keyMatch[2].trim() : null,
        item: itemMatch ? itemMatch[1].trim() : null
      };
    });
}

function subtree(entries, parent) {
  const start = entries.indexOf(parent);
  const out = [];
  for (let pos = start + 1; pos < entries.length; pos += 1) {
    if (entries[pos].indent <= parent.indent) break;
    out.push(entries[pos]);
  }
  return out;
}

function topLevelKey(entries, name) {
  return entries.find((entry) => entry.indent === 0 && entry.key === name);
}

function keyIn(scope, name) {
  return scope.find((entry) => entry.key === name);
}

function directListItems(entries, parent) {
  const kids = subtree(entries, parent).filter((entry) => entry.item !== null);
  if (kids.length === 0) return [];
  const minIndent = Math.min(...kids.map((entry) => entry.indent));
  return kids.filter((entry) => entry.indent === minIndent).map((entry) => entry.item);
}

function collectUses(entries) {
  return entries.filter((entry) => entry.key === 'uses').map((entry) => entry.value);
}

function collectRunCommands(entries) {
  const parts = [];
  for (const entry of entries) {
    if (entry.key !== 'run') continue;
    const inline = entry.value ?? '';
    if (inline && !inline.startsWith('|') && !inline.startsWith('>')) {
      parts.push(inline);
    } else {
      for (const child of subtree(entries, entry)) parts.push(child.content.trim());
    }
  }
  return parts.join('\n');
}

function actionMajor(uses, name) {
  const match = new RegExp(`^${name.replace('/', '\\/')}@v(\\d+)`).exec(uses ?? '');
  return match ? Number(match[1]) : null;
}

function loadWorkflowEntries() {
  assert.equal(existsSync(workflowPath), true, `${workflowRel} must exist`);
  return parseEntries(readFileSync(workflowPath, 'utf8'));
}

test('workflow file exists and declares only main-scoped PR/push plus workflow_dispatch triggers', () => {
  const entries = loadWorkflowEntries();
  const on = topLevelKey(entries, 'on');
  assert.ok(on, 'workflow must declare an on: trigger block');
  const onScope = subtree(entries, on);

  const pullRequest = keyIn(onScope, 'pull_request');
  assert.ok(pullRequest, 'pull_request trigger must exist');
  const pullRequestBranches = keyIn(subtree(entries, pullRequest), 'branches');
  assert.ok(pullRequestBranches, 'pull_request must scope branches');
  assert.deepEqual(directListItems(entries, pullRequestBranches), ['main'], 'pull_request branches must be exactly [main]');

  const push = keyIn(onScope, 'push');
  assert.ok(push, 'push trigger must exist');
  const pushBranches = keyIn(subtree(entries, push), 'branches');
  assert.ok(pushBranches, 'push must scope branches');
  assert.deepEqual(directListItems(entries, pushBranches), ['main'], 'push branches must be exactly [main]');

  assert.ok(keyIn(onScope, 'workflow_dispatch'), 'workflow_dispatch trigger must exist');

  for (const forbidden of ['pull_request_target', 'schedule', 'release', 'workflow_run', 'repository_dispatch']) {
    assert.equal(keyIn(onScope, forbidden), undefined, `forbidden trigger present: ${forbidden}`);
  }
});

test('workflow runs the full gate on ubuntu-latest with Node 20 and npm ci', () => {
  const entries = loadWorkflowEntries();
  const jobs = topLevelKey(entries, 'jobs');
  assert.ok(jobs, 'jobs block must exist');
  const jobsScope = subtree(entries, jobs);
  const jobIndent = Math.min(...jobsScope.map((entry) => entry.indent));
  const jobKeys = jobsScope.filter((entry) => entry.indent === jobIndent && entry.key);
  assert.ok(jobKeys.length >= 1, 'at least one formal job must be defined');

  assert.ok(
    jobsScope.some((entry) => entry.key === 'runs-on' && entry.value === 'ubuntu-latest'),
    'job must run on ubuntu-latest'
  );

  const uses = collectUses(entries);
  const checkout = uses.find((value) => value.startsWith('actions/checkout@'));
  assert.ok(checkout, 'must use actions/checkout');
  assert.ok(actionMajor(checkout, 'actions/checkout') >= 6, 'actions/checkout major must be >= 6');

  const setupNode = uses.find((value) => value.startsWith('actions/setup-node@'));
  assert.ok(setupNode, 'must use actions/setup-node');
  assert.ok(actionMajor(setupNode, 'actions/setup-node') >= 6, 'actions/setup-node major must be >= 6');

  const nodeVersion = keyIn(entries, 'node-version');
  assert.ok(nodeVersion, 'node-version must be set');
  assert.equal(nodeVersion.value.replace(/['"]/g, ''), '20', 'Node version must be 20');

  const runCommands = collectRunCommands(entries);
  assert.match(runCommands, /npm ci/, 'must install with npm ci');
  assert.match(runCommands, /npm run q:full/, 'must run the full quality gate');
});

test('workflow checks out the PR head commit with github.sha fallback and verifies actual HEAD', () => {
  const entries = loadWorkflowEntries();
  const ref = keyIn(entries, 'ref');
  assert.ok(ref, 'checkout ref must be pinned');
  assert.match(ref.value, /github\.event\.pull_request\.head\.sha/, 'ref must use PR head SHA');
  assert.match(ref.value, /github\.sha/, 'ref must fall back to github.sha');

  const runCommands = collectRunCommands(entries);
  assert.match(runCommands, /git rev-parse HEAD/, 'must read the actual checked-out HEAD');
  assert.match(
    runCommands,
    /\btest\b[^\n]*ACTUAL_SHA[^\n]*=[^\n]*EXPECTED_SHA/,
    'must assert actual HEAD equals expected SHA so a mismatch exits non-zero'
  );
});

test('workflow pins a read-only permission boundary and keeps checkout credentials out', () => {
  const entries = loadWorkflowEntries();
  const permissions = topLevelKey(entries, 'permissions');
  assert.ok(permissions, 'top-level permissions must be declared');
  assert.notEqual(permissions.value, 'write-all', 'permissions must not be write-all');
  const permissionsScope = subtree(entries, permissions);
  assert.ok(
    permissionsScope.some((entry) => entry.key === 'contents' && entry.value === 'read'),
    'permissions must grant contents: read'
  );

  for (const entry of entries.filter((item) => item.key === 'permissions')) {
    assert.notEqual(entry.value, 'write-all', 'no permissions block may be write-all');
    for (const child of subtree(entries, entry)) {
      assert.equal(/write/.test(child.trimmed), false, `permissions must not grant write: ${child.trimmed}`);
    }
  }

  const effectiveText = entries.map((entry) => entry.content).join('\n');
  assert.equal(effectiveText.includes('write-all'), false, 'workflow must not use write-all');
  assert.equal(effectiveText.includes('secrets.'), false, 'workflow must not read project secrets');
  assert.equal(/GH_TOKEN/.test(effectiveText), false, 'workflow must not reference GH_TOKEN');
  assert.equal(/\bPAT\b/.test(effectiveText), false, 'workflow must not reference a PAT');
  assert.equal(/personal access token/i.test(effectiveText), false, 'workflow must not reference a personal access token');

  assert.ok(
    entries.some((entry) => entry.key === 'persist-credentials' && entry.value === 'false'),
    'checkout must set persist-credentials: false'
  );
});

test('workflow cancels superseded runs per PR/ref via concurrency', () => {
  const entries = loadWorkflowEntries();
  const concurrency = topLevelKey(entries, 'concurrency');
  assert.ok(concurrency, 'concurrency must be declared');
  const scope = subtree(entries, concurrency);
  const group = keyIn(scope, 'group');
  assert.ok(group, 'concurrency group must be declared');
  assert.match(group.value, /github\.event\.pull_request\.number/, 'group must distinguish PR number');
  assert.match(group.value, /github\.ref/, 'group must distinguish ref');
  const cancel = keyIn(scope, 'cancel-in-progress');
  assert.ok(cancel && cancel.value === 'true', 'cancel-in-progress must be true');
});

test('workflow contains no push/publish/merge or affected/release command surface', () => {
  const entries = loadWorkflowEntries();
  const runCommands = collectRunCommands(entries);
  for (const forbidden of [
    'git push',
    'git tag',
    'gh release',
    'gh pr merge',
    'npm version',
    'q:affected',
    'q:release',
    'release:build',
    'release:check'
  ]) {
    assert.equal(runCommands.includes(forbidden), false, `forbidden command present in run steps: ${forbidden}`);
  }
  for (const uses of collectUses(entries)) {
    assert.equal(/artifact/i.test(uses), false, `forbidden artifact action: ${uses}`);
    assert.equal(/release/i.test(uses), false, `forbidden release action: ${uses}`);
    assert.equal(/merge/i.test(uses), false, `forbidden merge action: ${uses}`);
  }
});

test('package.json still exposes q:full pointing at the full quality gate', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts, 'package.json must declare scripts');
  assert.equal(
    pkg.scripts['q:full'],
    'node tools/quality/run-quality-gate.mjs --gate full',
    'q:full must remain the full quality gate entry'
  );
});

test('parser strips comments and blank lines so commented commands do not satisfy contracts', () => {
  const sample = [
    '# run: npm run q:affected',
    'jobs:',
    '  demo:',
    '    steps:',
    '      - name: full',
    '        run: npm run q:full # inline note',
    '',
    '      - name: install',
    '        run: |',
    '          # git push origin main',
    '          npm ci'
  ].join('\n');
  const entries = parseEntries(sample);
  const runCommands = collectRunCommands(entries);
  assert.equal(runCommands.includes('npm run q:full'), true, 'effective run command must be detected');
  assert.equal(runCommands.includes('npm ci'), true, 'block scalar run command must be detected');
  assert.equal(/q:affected/.test(runCommands), false, 'commented-out q:affected must be ignored');
  assert.equal(/git push/.test(runCommands), false, 'commented-out git push must be ignored');
});
