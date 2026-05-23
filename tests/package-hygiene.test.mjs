import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

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
  const violations = [];
  walk(root, (abs) => {
    const rel = normalize(relative(root, abs));
    if (!rel) return;
    const first = rel.split('/')[0];
    if (localGeneratedRoots.has(first)) return;
    const name = rel.split('/').at(-1);
    if (forbiddenNames.has(name) || forbiddenSuffixes.some((suffix) => rel.endsWith(suffix)) || rel.endsWith('.log')) {
      violations.push(rel);
      return;
    }
    if (forbiddenLogPatterns.some((pattern) => pattern.test(rel))) {
      violations.push(rel);
    }
  });
  assert.deepEqual(violations.sort(), []);
});

test('package hygiene policy is wired into scripts and architecture validator', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, '0.0.2-24');
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

function walk(dir, visit) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = normalize(relative(root, abs));
    const first = rel.split('/')[0];
    if (localGeneratedRoots.has(first)) continue;
    visit(abs);
    if (statSync(abs).isDirectory()) {
      walk(abs, visit);
    }
  }
}

function normalize(path) {
  return path.replaceAll('\\\\', '/');
}
