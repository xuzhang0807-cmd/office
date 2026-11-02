import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * 一键起整套：4 个能力服务 + 门户。
 *
 * 顺序有意义：门户启动时会通过 HTTP 生成内置模板，能力服务没起来就会
 * 记一条 failed（不会崩，但模板要等下次启动才补）。所以这里先起能力、
 * 轮询健康检查、再起门户。
 */

const ROOT = path.resolve(import.meta.dirname, '..');

const SERVICES = [
  { name: 'docx', entry: 'docx/src/index.js', port: 32201, env: 'OFFICE_DOCX_PORT' },
  { name: 'xlsx', entry: 'xlsx/src/index.js', port: 32202, env: 'OFFICE_XLSX_PORT' },
  { name: 'pptx', entry: 'pptx/src/index.js', port: 32203, env: 'OFFICE_PPTX_PORT' },
  { name: 'pdf', entry: 'pdf/src/index.js', port: 32204, env: 'OFFICE_PDF_PORT' },
];

const children = new Map();
let shuttingDown = false;

function spawnNode(name, entry, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, entry)], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.set(name, child);
  child.on('exit', (code, signal) => {
    children.delete(name);
    if (shuttingDown) return;
    console.error(`[stack] ${name} 退出（code=${code} signal=${signal}），整套停止`);
    shutdown(1);
  });
  return child;
}

async function waitHealthy(port, name, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      /* 还没起来 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${name} 在 ${timeoutMs}ms 内没有就绪（端口 ${port}）`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 300).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const targets = only.length ? SERVICES.filter((s) => only.includes(s.name)) : SERVICES;

  for (const service of targets) {
    spawnNode(service.name, service.entry, { [service.env]: String(service.port) });
  }
  await Promise.all(targets.map((service) => waitHealthy(service.port, service.name)));
  console.log(`[stack] 能力服务就绪：${targets.map((s) => `${s.name}:${s.port}`).join(' ')}`);

  if (!process.argv.includes('--no-portal')) {
    spawnNode('portal', 'portal/src/index.js');
    await waitHealthy(Number(process.env.OFFICE_PORT) || 32110, 'portal');
    console.log(`[stack] 门户就绪：http://127.0.0.1:${process.env.OFFICE_PORT || 32110}`);
  }
}

main().catch((error) => {
  console.error('[stack] 启动失败', error.message);
  shutdown(1);
});
