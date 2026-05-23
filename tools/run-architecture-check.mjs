#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const steps = [
  ['legacy validator', 'python3', ['tools/validate_code_architecture.py']],
  ['architecture boundary authoritative rules', process.execPath, ['tools/quality/plugins/architecture-boundary-check.mjs']]
];

let failed = false;
for (const [label, command, args] of steps) {
  console.log(`[arch:check] ${label}: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  const status = result.status ?? 1;
  if (status !== 0) {
    console.error(`[arch:check] failed at ${label} with exit code ${status}`);
    failed = true;
    break;
  }
}

if (!failed) console.log('[arch:check] legacy validator and architecture-boundary authoritative rules passed');
process.exit(failed ? 1 : 0);
