import express from 'express';
import { HttpError } from './util.js';
import { errorHandler, jsonBody } from './http.js';

/**
 * 能力服务的统一骨架。
 *
 * 每个能力（docx / xlsx / pptx / pdf）都是一个独立可部署的 HTTP 服务，
 * 只暴露一个 RPC 端点 + 健康检查 + 能力清单。门户通过 HTTP 调用它们，
 * 因此任意一个能力都可以单独重启、单独升级、单独换实现（甚至换成别的语言）。
 *
 * 协议（所有服务一致）：
 *   POST /rpc   { "op": "<操作名>", "args": { ... } }
 *            → { "ok": true, "data": { ... } }
 *            → { "ok": false, "error": { "message": "...", "code": "..." } }
 *   二进制入参与出参统一走 base64，字段名固定为 buffer。
 *
 *   GET /health        → { ok, data: { service, version, uptimeMs, status } }
 *   GET /capabilities  → { ok, data: { service, version, ops: [...] } }
 */

export const BINARY_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
};

export function decodeBuffer(value, field = 'buffer') {
  if (typeof value !== 'string' || !value) {
    throw new HttpError(400, `缺少 ${field}（base64）`, 'MISSING_BUFFER');
  }
  const cleaned = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const buffer = Buffer.from(cleaned, 'base64');
  if (!buffer.length) throw new HttpError(400, `${field} 解码为空`, 'EMPTY_BUFFER');
  return buffer;
}

export function encodeBuffer(buffer, ext) {
  const bytes = Buffer.from(buffer);
  return {
    buffer: bytes.toString('base64'),
    ext,
    mime: BINARY_MIME[ext] || 'application/octet-stream',
    bytes: bytes.length,
  };
}

export function createServiceApp({ name, version, ops, jsonLimit = 64 * 1024 * 1024 }) {
  const app = express();
  app.set('trust proxy', 1);
  app.set('jsonLimit', jsonLimit);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(jsonBody);

  const startedAt = Date.now();

  app.get('/health', (req, res) => {
    res.json({ ok: true, data: { service: name, version, uptimeMs: Date.now() - startedAt, status: 'up' } });
  });

  app.get('/capabilities', (req, res) => {
    res.json({
      ok: true,
      data: {
        service: name,
        version,
        ops: Object.entries(ops).map(([op, meta]) => ({ op, ...(meta.meta || {}) })),
      },
    });
  });

  app.post('/rpc', async (req, res, next) => {
    try {
      const op = String(req.body?.op || '');
      const entry = ops[op];
      if (!entry) throw new HttpError(400, `未知操作：${op || '(空)'}`, 'UNKNOWN_OP');
      const handler = typeof entry === 'function' ? entry : entry.handler;
      const args = req.body?.args && typeof req.body.args === 'object' ? req.body.args : {};
      const data = await handler(args, req);
      res.json({ ok: true, data: data ?? {} });
    } catch (error) {
      next(error);
    }
  });

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: { message: `接口不存在：${req.method} ${req.originalUrl}`, code: 'NOT_FOUND' } });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => errorHandler(error, req, res, next));
  return app;
}

export function startService({ name, version, ops, port, host = '0.0.0.0', jsonLimit }) {
  const app = createServiceApp({ name, version, ops, jsonLimit });
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      const actual = server.address();
      console.log(`[${name}] v${version} listening on http://${host}:${actual.port} (${Object.keys(ops).length} ops)`);
      resolve(server);
    });
  });
}

/**
 * 判断当前模块是不是被 `node src/index.js` 直接执行。
 * 直接用 argv 与 import.meta.url 比对，避免各服务各写一套相对路径判断。
 */
export function isEntry(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return importMetaUrl === new URL(`file://${entry.startsWith('/') ? '' : '/'}${entry}`).href
      || importMetaUrl.endsWith(entry);
  } catch {
    return false;
  }
}
