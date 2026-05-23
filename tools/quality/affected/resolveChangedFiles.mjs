import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

function normalizeFileList(values) {
  const seen = new Set();
  const files = [];
  for (const value of values) {
    for (const raw of String(value ?? '').split(/[\n,]/)) {
      const normalized = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
      if (!normalized || normalized === '.') continue;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        files.push(normalized);
      }
    }
  }
  return files;
}

export function parseChangedFileArgs(argv) {
  const parsed = { passThroughArgs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--changed-files') {
      parsed.changedFiles = argv[i + 1] ?? '';
      i += 1;
    } else if (arg === '--changed-files-file') {
      parsed.changedFilesFile = argv[i + 1] ?? '';
      i += 1;
    } else if (arg === '--base-ref') {
      parsed.baseRef = argv[i + 1] ?? '';
      i += 1;
    } else if (arg === '--no-cache') {
      parsed.noCache = true;
    } else {
      parsed.passThroughArgs.push(arg);
    }
  }
  return parsed;
}

function compactGitError(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim()) ?? raw;
  if (/Not a git repository/i.test(raw)) return 'git diff unavailable: current directory is not a git repository';
  return firstLine.slice(0, 240);
}

function gitDiffNames(rootDir, args) {
  const result = spawnSync('git', ['diff', '--name-only', ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    shell: false
  });
  if (result.status !== 0) return { files: [], error: compactGitError(result.stderr || result.stdout || '') };
  return { files: normalizeFileList([result.stdout]), error: '' };
}

export async function resolveChangedFiles(rootDir, options = {}) {
  if (options.changedFiles) {
    const files = normalizeFileList([options.changedFiles]);
    return { changedFiles: files, source: 'cli', fallback: files.length === 0, fallbackReason: files.length === 0 ? 'empty --changed-files argument' : '' };
  }

  if (options.changedFilesFile) {
    try {
      const text = await readFile(options.changedFilesFile, 'utf8');
      const files = normalizeFileList([text]);
      return { changedFiles: files, source: 'changed-files-file', fallback: files.length === 0, fallbackReason: files.length === 0 ? 'changed files file is empty' : '' };
    } catch (error) {
      return { changedFiles: [], source: 'changed-files-file', fallback: true, fallbackReason: `cannot read changed files file: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  const explicitRange = options.baseRef ? gitDiffNames(rootDir, [options.baseRef]) : null;
  if (explicitRange?.files.length) return { changedFiles: explicitRange.files, source: 'git-diff-range', fallback: false, fallbackReason: '' };

  const workingTree = gitDiffNames(rootDir, []);
  if (workingTree.files.length) return { changedFiles: workingTree.files, source: 'git-diff-working-tree', fallback: false, fallbackReason: '' };

  const headRange = gitDiffNames(rootDir, ['HEAD~1..HEAD']);
  if (headRange.files.length) return { changedFiles: headRange.files, source: 'git-diff-head-range', fallback: false, fallbackReason: '' };

  const reason = explicitRange?.error || workingTree.error || headRange.error || 'git diff produced no changed files or current directory is not a git repository';
  return { changedFiles: [], source: 'fallback', fallback: true, fallbackReason: reason };
}
