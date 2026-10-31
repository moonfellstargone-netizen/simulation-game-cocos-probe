#!/usr/bin/env node
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWebProbeSource, serveWebProbe } from './lib/webProbeSupport.mjs';

export function parseServeArgs(args) {
  const names = { '--project': 'project', '--build-record': 'buildRecord', '--port': 'port' };
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = names[args[i]];
    if (!name || !args[i + 1] || Object.hasOwn(parsed, name)) throw new Error('ERR_WEB_SERVE_ARGUMENTS');
    parsed[name] = args[i + 1];
  }
  for (const name of ['project', 'buildRecord']) {
    if (!isAbsolute(parsed[name] ?? '')) throw new Error('ERR_WEB_SERVE_ABSOLUTE_REQUIRED:' + name);
  }
  if (!/^\d+$/.test(parsed.port ?? '') || Number(parsed.port) < 1 || Number(parsed.port) > 65535) {
    throw new Error('ERR_WEB_SERVE_FIXED_PORT_REQUIRED');
  }
  return { ...parsed, port: Number(parsed.port) };
}

export async function startWebProbeServer(options, { rootDir = process.cwd() } = {}) {
  const parsed = parseServeArgs(['--project', options.project, '--build-record', options.buildRecord, '--port', String(options.port)]);
  const source = readWebProbeSource({ rootDir, ...parsed });
  const server = await serveWebProbe(join(source.projectDir, 'build/web-desktop'), { port: parsed.port });
  return { ...server, sourceCommit: source.manifest.sourceCommit, sourceDirty: source.manifest.sourceDirty };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => parseServeArgs(process.argv.slice(2))).then(startWebProbeServer).then((server) => {
    console.log(JSON.stringify({ url: server.url, sourceCommit: server.sourceCommit, sourceDirty: server.sourceDirty }));
    console.log('在同一浏览器使用上述固定地址。点击保存后，刷新或重新打开页面，再点击读取。Ctrl+C停止服务。');
    const stop = () => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      server.close().catch((error) => { console.error(error.message); process.exitCode = 1; });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
