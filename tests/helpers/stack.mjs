import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * 测试夹具：起 4 个能力服务 + 门户，返回 base URL 与清理函数。
 *
 * 现在门户依赖能力服务（模板生成、导出、文字提取都走 HTTP），
 * 所以集成测试必须先起整套，不能只起门户。
 */

const ROOT = path.resolve(import.meta.dirname, '../..');

const SERVICE_DEFS = [
  { name: 'docx', entry: 'docx/src/index.js', env: 'OFFICE_DOCX_PORT', port: 32401 },
  { name: 'xlsx', entry: 'xlsx/src/index.js', env: 'OFFICE_XLSX_PORT', port: 32402 },
  { name: 'pptx', entry: 'pptx/src/index.js', env: 'OFFICE_PPTX_PORT', port: 32403 },
  { name: 'pdf', entry: 'pdf/src/index.js', env: 'OFFICE_PDF_PORT', port: 32404 },
];

async function waitHealthy(port, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`端口 ${port} 未就绪`);
}

/**
 * @param {object} opts
 * @param {string} [opts.dataDir] 数据目录（默认临时目录）
 * @param {object} [opts.env] 额外环境变量
 * @param {number} [opts.basePort] 端口基数（默认 32400，第二个实例传 32500）
 */
export async function startStack({ dataDir, env = {}, basePort = 32400 } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'office-stack-'));
  const children = [];
  const baseEnv = {
    ...process.env,
    OFFICE_DATA_DIR: dir,
    OFFICE_DB_PATH: path.join(dir, 'office.db'),
    OFFICE_PDF_FONT_CACHE: path.join(dir, 'fonts'),
    ...env,
  };

  const ports = {};
  for (const [index, def] of SERVICE_DEFS.entries()) {
    ports[def.name] = basePort + 1 + index;
    children.push(
      spawn(process.execPath, [path.join(ROOT, def.entry)], {
        cwd: ROOT,
        env: { ...baseEnv, [def.env]: String(ports[def.name]) },
        stdio: ['ignore', 'ignore', 'inherit'],
      }),
    );
  }
  await Promise.all(Object.values(ports).map((port) => waitHealthy(port)));

  const portalPort = Number(env.OFFICE_PORT) || basePort + 10;
  const portal = spawn(process.execPath, [path.join(ROOT, 'portal/src/index.js')], {
    cwd: ROOT,
    env: {
      ...baseEnv,
      OFFICE_PORT: String(portalPort),
      OFFICE_HOST: '127.0.0.1',
      OFFICE_DOCX_URL: `http://127.0.0.1:${ports.docx}`,
      OFFICE_XLSX_URL: `http://127.0.0.1:${ports.xlsx}`,
      OFFICE_PPTX_URL: `http://127.0.0.1:${ports.pptx}`,
      OFFICE_PDF_URL: env.OFFICE_PDF_URL || `http://127.0.0.1:${ports.pdf}`,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  children.push(portal);
  await waitHealthy(portalPort);

  return {
    base: `http://127.0.0.1:${portalPort}`,
    dataDir: dir,
    ports,
    async close() {
      for (const child of children) {
        if (!child.killed) child.kill('SIGTERM');
      }
      await new Promise((r) => setTimeout(r, 250));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
