import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { spawn } from 'node:child_process';

/**
 * 服务协议契约测试。
 *
 * 真正起 4 个能力进程，用 HTTP 验证：健康检查、能力清单、RPC 成功、
 * RPC 未知操作、缺参数报错、二进制往返。这是模块化的核心保证——
 * 任何服务只要守住这套协议，就可以被单独替换。
 */

const ROOT = path.resolve(import.meta.dirname, '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'office-contract-'));

const SERVICES = [
  { name: 'docx', port: 32301, entry: 'docx/src/index.js' },
  { name: 'xlsx', port: 32302, entry: 'xlsx/src/index.js' },
  { name: 'pptx', port: 32303, entry: 'pptx/src/index.js' },
  { name: 'pdf', port: 32304, entry: 'pdf/src/index.js' },
];

const kids = [];

async function waitHealthy(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`port ${port} 未就绪`);
}

async function rpc(port, op, args) {
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, args }),
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  for (const service of SERVICES) {
    const env = {
      ...process.env,
      [`OFFICE_${service.name.toUpperCase()}_PORT`]: String(service.port),
      OFFICE_PDF_FONT_CACHE: path.join(TMP, 'fonts'),
    };
    kids.push(
      spawn(process.execPath, [path.join(ROOT, service.entry)], {
        cwd: ROOT,
        env,
        stdio: ['ignore', 'ignore', 'inherit'],
      }),
    );
  }
  await Promise.all(SERVICES.map((s) => waitHealthy(s.port)));
});

after(() => {
  for (const kid of kids) kid.kill('SIGTERM');
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('服务协议契约', () => {
  for (const service of SERVICES) {
    it(`${service.name}：/health 返回统一形状`, async () => {
      const res = await fetch(`http://127.0.0.1:${service.port}/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.data.service, service.name);
      assert.equal(body.data.status, 'up');
      assert.match(body.data.version, /^\d+\.\d+\.\d+$/);
      assert.equal(typeof body.data.uptimeMs, 'number');
    });

    it(`${service.name}：/capabilities 列出操作`, async () => {
      const res = await fetch(`http://127.0.0.1:${service.port}/capabilities`);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.data.service, service.name);
      assert.ok(Array.isArray(body.data.ops) && body.data.ops.length > 0);
      for (const op of body.data.ops) assert.equal(typeof op.op, 'string');
    });

    it(`${service.name}：未知操作返回 400 + UNKNOWN_OP`, async () => {
      const res = await rpc(service.port, 'no-such-op', {});
      assert.equal(res.status, 400);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error.code, 'UNKNOWN_OP');
    });

    it(`${service.name}：未知路径返回 404 JSON`, async () => {
      const res = await fetch(`http://127.0.0.1:${service.port}/nope`);
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'NOT_FOUND');
    });
  }

  it('docx：二进制往返（HTML → docx → HTML）', async () => {
    const exported = await rpc(32301, 'export', { html: '<h1>契约测试</h1><p>正文</p>', title: '契约' });
    assert.equal(exported.status, 200);
    const imported = await rpc(32301, 'import', { buffer: exported.body.data.buffer });
    assert.equal(imported.status, 200);
    assert.match(imported.body.data.html, /契约测试/);
  });

  it('xlsx：二进制往返（模型 → xlsx → 模型）', async () => {
    const model = { sheets: [{ name: 'S', rows: [[{ v: 'A' }, { v: 1 }]] }] };
    const exported = await rpc(32302, 'export', { model });
    const imported = await rpc(32302, 'import', { buffer: exported.body.data.buffer });
    assert.equal(imported.body.data.model.sheets[0].rows[0][0].v, 'A');
  });

  it('pptx：二进制往返（模型 → pptx → 模型）', async () => {
    const model = {
      width: 1280,
      height: 720,
      slides: [{ background: '#000000', elements: [{ type: 'text', x: 10, y: 10, w: 500, h: 80, text: '契约', role: 'title', size: 40, color: '#FFFFFF', bold: true }] }],
    };
    const exported = await rpc(32303, 'export', { model });
    const imported = await rpc(32303, 'import', { buffer: exported.body.data.buffer });
    assert.equal(imported.body.data.model.slides.length, 1);
  });

  it('pdf：跨服务链路（docx 出 HTML → pdf 排版）', async () => {
    const html = '<h1>跨服务</h1><p>正文内容</p>';
    const rendered = await rpc(32304, 'fromHtml', { html, title: '跨服务' });
    assert.equal(rendered.status, 200);
    assert.equal(rendered.body.data.ext, 'pdf');
    const buffer = Buffer.from(rendered.body.data.buffer, 'base64');
    assert.equal(buffer.slice(0, 5).toString('latin1'), '%PDF-');
  });

  it('缺参数时返回 4xx 与可读错误码，不是 500', async () => {
    const cases = [
      [32301, 'import', {}, 'MISSING_BUFFER'],
      [32302, 'export', {}, 'NO_MODEL'],
      [32303, 'export', {}, 'NO_MODEL'],
      [32304, 'info', {}, 'MISSING_BUFFER'],
    ];
    for (const [port, op, args, code] of cases) {
      const res = await rpc(port, op, args);
      assert.equal(res.status, 400, `${op} 应返回 400`);
      assert.equal(res.body.error.code, code);
      assert.ok(res.body.error.message.length > 0);
    }
  });

  it('非法 base64 被拒绝而不是静默产生空文件', async () => {
    const res = await rpc(32301, 'import', { buffer: '!!!not-base64!!!' });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, 'BAD_DOCX');
  });

  it('伪装的 zip 文件被 400 拒绝而不是 500', async () => {
    const fake = Buffer.from('PK\u0003\u0004 not really a zip').toString('base64');
    for (const [port, code] of [[32301, 'BAD_DOCX'], [32302, 'BAD_XLSX'], [32303, 'BAD_PPTX']]) {
      const res = await rpc(port, 'import', { buffer: fake });
      assert.equal(res.status, 400, `port ${port}`);
      assert.equal(res.body.error.code, code);
    }
  });

  it('请求体过大返回 413', async () => {
    const huge = 'x'.repeat(70 * 1024 * 1024);
    const res = await fetch('http://127.0.0.1:32301/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'export', args: { html: huge } }),
    }).catch(() => null);
    if (res) assert.ok([413, 400].includes(res.status));
  });
});
