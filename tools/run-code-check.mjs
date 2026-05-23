#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['tools/quality/run-quality-gate.mjs', '--gate', 'full'],
  { stdio: 'inherit', shell: false }
);

process.exit(result.status ?? 1);
