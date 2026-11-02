#!/usr/bin/env node
/**
 * 并行起后端与前端 dev server，Ctrl-C 一起收掉。
 * 现在后端是「4 个能力服务 + 门户」，统一交给 scripts/stack.mjs。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const children = [];

function run(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`[dev] ${name} 退出，code=${code}`);
    shutdown();
  });
  children.push(child);
  return child;
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('stack', process.execPath, ['scripts/stack.mjs'], {});
run('web', process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--config', 'portal/web/vite.config.js'], {
  OFFICE_API_TARGET: `http://127.0.0.1:${process.env.OFFICE_PORT || '32110'}`,
});

console.log('[dev] 前端 http://127.0.0.1:32111 · 门户 http://127.0.0.1:32110');
