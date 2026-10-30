import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();

const forbiddenNames = new Set(['__pycache__', '.DS_Store']);
const forbiddenSuffixes = ['.pyc'];
const forbiddenLogPatterns = [
  /(^|\/)logs($|\/)/,
  /_logs($|\/)/,
  /开发日志包/,
  /开发记录/,
  /CHANGE_SUMMARY\.md$/,
  /FINAL_CHECK_REPORT\.md$/,
  /EXTERNAL_SCAN_REPORT\.md$/
];
const localGeneratedRoots = new Set(['node_modules', 'dist', 'coverage', '.cache']);

test('code package source tree contains no generated Python cache or log artifacts', () => {
  assert.deepEqual(scanSourceTree(root), []);
});

test('source hygiene excludes only root Git metadata, including worktree pointer files', (t) => {
  for (const metadataKind of ['directory', 'pointer']) {
    const sourceRoot = temporarySourceRoot(t);
    if (metadataKind === 'directory') {
      mkdirSync(join(sourceRoot, '.git', 'logs'), { recursive: true });
      writeFileSync(join(sourceRoot, '.git', 'logs', 'HEAD'), 'Git reflog metadata\n');
    } else {
      writeFileSync(join(sourceRoot, '.git'), 'gitdir: ../repository/.git/worktrees/probe\n');
    }
    mkdirSync(join(sourceRoot, 'src'));
    writeFileSync(join(sourceRoot, 'src', 'module.ts'), 'export {};\n');
    assert.deepEqual(scanSourceTree(sourceRoot), [], metadataKind);
  }
});

test('source hygiene still rejects source logs, nested caches and generated files', (t) => {
  const sourceRoot = temporarySourceRoot(t);
  const directories = [
    'logs',
    'nested/logs',
    'nested/run_logs',
    'nested/__pycache__',
    'nested/.git/logs',
    'nested/开发日志包',
    'nested/开发记录'
  ];
  const files = [
    'logs/root.txt',
    'nested/logs/activity.txt',
    'nested/run_logs/activity.txt',
    'nested/.git/logs/HEAD',
    'nested/compiled.pyc',
    'nested/activity.log',
    'nested/.DS_Store'
  ];
  for (const directory of directories) {
    mkdirSync(join(sourceRoot, directory), { recursive: true });
  }
  for (const file of files) {
    writeFileSync(join(sourceRoot, file), 'source artifact\n');
  }
  assert.deepEqual(scanSourceTree(sourceRoot), [...directories, ...files].sort());
});

test('source hygiene normalizes Windows and POSIX paths consistently', () => {
  assert.equal(normalize('nested\\logs\\activity.log'), 'nested/logs/activity.log');
  assert.equal(normalize('nested/logs/activity.log'), 'nested/logs/activity.log');
});

test('package hygiene policy is wired into scripts and architecture validator', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, '0.0.2-32');
  assert.equal(packageJson.scripts['test:package-hygiene'], 'node --test tests/package-hygiene.test.mjs');

  const registry = readFileSync(join(root, 'tools/quality/test-registry.json'), 'utf8');
  const checkRunner = readFileSync(join(root, 'tools/run-code-check.mjs'), 'utf8');
  assert.match(checkRunner, /run-quality-gate\.mjs/);
  assert.match(registry, /tests\/package-hygiene\.test\.mjs|test:package-hygiene/);

  const validator = readFileSync(join(root, 'tools/validate_code_architecture.py'), 'utf8');
  for (const token of ['__pycache__', '*.pyc', 'node_modules', 'dist', 'coverage', '.DS_Store', '开发日志包']) {
    assert.equal(validator.includes(token), true, `validator must contain package hygiene token: ${token}`);
  }
});


test('release packaging scripts are present and wired into package scripts', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(existsSync(join(root, 'tools/build_release_package.py')), true);
  assert.equal(existsSync(join(root, 'tools/check_release_zip.py')), true);
  assert.match(packageJson.scripts['release:build'], /tools\/build_release_package\.py/);
  assert.match(packageJson.scripts['release:build'], /--project-target/);
  assert.match(packageJson.scripts['release:check'], /tools\/check_release_zip\.py/);
  assert.match(packageJson.scripts['release:check'], /--project-target/);

  const releaseBuilder = readFileSync(join(root, 'tools/build_release_package.py'), 'utf8');
  assert.equal(releaseBuilder.includes('DEFAULT_CODE_ROOT'), false);
  for (const token of ['staging', 'ZIP_DEFLATED', 'node_modules', 'dist', 'coverage', '.cache', 'reports/quality', '开发日志包', '--project-target']) {
    assert.equal(releaseBuilder.includes(token), true, `release builder missing ${token}`);
  }

  const releaseChecker = readFileSync(join(root, 'tools/check_release_zip.py'), 'utf8');
  for (const token of ['UTF8_FLAG', 'mojibake', 'expected-root', '__pycache__', 'node_modules', '.DS_Store', 'reports', 'quality']) {
    assert.equal(releaseChecker.includes(token), true, `release checker missing ${token}`);
  }
});

test('generated dependency and build directories are excluded from package policy', () => {
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
  for (const token of ['node_modules/', 'dist/', 'coverage/', '.cache/', '__pycache__/', '*.pyc', '.DS_Store', '*_logs/']) {
    assert.equal(gitignore.includes(token), true, `.gitignore missing ${token}`);
  }
});

function scanSourceTree(sourceRoot) {
  const violations = [];
  walk(sourceRoot, sourceRoot, (abs) => {
    const rel = normalize(relative(sourceRoot, abs));
    const name = rel.split('/').at(-1);
    if (forbiddenNames.has(name) || forbiddenSuffixes.some((suffix) => rel.endsWith(suffix)) || rel.endsWith('.log')) {
      violations.push(rel);
      return;
    }
    if (forbiddenLogPatterns.some((pattern) => pattern.test(rel))) {
      violations.push(rel);
    }
  });
  return violations.sort();
}

function walk(dir, sourceRoot, visit) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = normalize(relative(sourceRoot, abs));
    const first = rel.split('/')[0];
    // Git's own reflogs are metadata, while nested source logs remain forbidden.
    if (first === '.git' || localGeneratedRoots.has(first)) continue;
    visit(abs);
    if (statSync(abs).isDirectory()) {
      walk(abs, sourceRoot, visit);
    }
  }
}

function normalize(path) {
  return path.replaceAll('\\', '/');
}

function temporarySourceRoot(t) {
  const prefix = join(resolve(tmpdir()), 'qinglan-package-hygiene-');
  const sourceRoot = mkdtempSync(prefix);
  t.after(() => {
    const resolvedRoot = resolve(sourceRoot);
    assert.equal(resolvedRoot.startsWith(prefix), true, 'cleanup must stay within the temporary fixture directory');
    rmSync(resolvedRoot, { recursive: true, force: true });
  });
  return sourceRoot;
}
