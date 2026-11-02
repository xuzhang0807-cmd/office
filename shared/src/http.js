import Busboy from 'busboy';
import { HttpError, extensionOf, slugify } from './util.js';

/**
 * 无配置的 HTTP 胶水。
 * 上限由调用方传入（各服务自己读自己的 env），共享层不认识业务配置。
 */

const DEFAULT_JSON_LIMIT = 64 * 1024 * 1024;
const DEFAULT_UPLOAD_LIMIT = 25 * 1024 * 1024;

export function jsonBody(req, res, next) {
  if (req.is('application/json') === false) return next();
  const limit = Number(req.app?.get('jsonLimit')) || DEFAULT_JSON_LIMIT;
  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > limit) {
      aborted = true;
      next(new HttpError(413, '请求体过大', 'PAYLOAD_TOO_LARGE'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text.trim()) {
      req.body = {};
      return next();
    }
    try {
      req.body = JSON.parse(text);
    } catch {
      return next(new HttpError(400, 'JSON 解析失败', 'BAD_JSON'));
    }
    next();
  });
  req.on('error', (error) => {
    if (!aborted) next(error);
  });
}

/** busboy 封装：同时支持文本字段与文件，超过上限立刻中断。 */
export function multipart(req, { maxBytes = DEFAULT_UPLOAD_LIMIT, maxFiles = 4, fieldName = 'file' } = {}) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: maxBytes, files: maxFiles, fields: 20 } });
    } catch {
      reject(new HttpError(400, '不是合法的 multipart 请求', 'BAD_MULTIPART'));
      return;
    }
    const fields = {};
    const files = [];
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    bb.on('field', (name, value) => {
      fields[name] = value;
    });
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      let size = 0;
      let truncated = false;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) truncated = true;
        else chunks.push(chunk);
      });
      stream.on('end', () => {
        if (truncated) {
          fail(new HttpError(413, `文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`, 'FILE_TOO_LARGE'));
          return;
        }
        if (name !== fieldName && name !== 'file' && name !== 'files' && name !== 'image') return;
        files.push({
          field: name,
          filename: slugify(info.filename || 'upload', 'upload'),
          ext: extensionOf(info.filename || ''),
          mime: info.mimeType || 'application/octet-stream',
          buffer: Buffer.concat(chunks),
        });
      });
    });
    bb.on('error', (error) => fail(new HttpError(400, `上传解析失败：${error.message}`, 'BAD_MULTIPART')));
    bb.on('close', () => {
      if (settled) return;
      settled = true;
      resolve({ fields, files });
    });
    req.pipe(bb);
  });
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function sendBuffer(res, buffer, { mime, filename, download = false, cache = 'private, max-age=60' }) {
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', cache);
  if (filename) {
    const encoded = encodeURIComponent(filename);
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${filename.replace(/[^\w.\-]/g, '_')}"; filename*=UTF-8''${encoded}`,
    );
  }
  res.end(buffer);
}

export function ok(res, data, status = 200) {
  res.status(status).json({ ok: true, data });
}

export function fail(res, status, message, code) {
  res.status(status).json({ ok: false, error: { message, code: code || 'ERROR' } });
}

/** 统一的错误响应：各服务共用同一形状，门户侧才能一套逻辑处理。 */
export function errorHandler(error, req, res, next) {
  const status = Number(error?.status) || 500;
  const message = status >= 500 && !error?.code ? '服务器内部错误' : error?.message || '服务器内部错误';
  if (status >= 500) console.error('[error]', error);
  if (res.headersSent) return;
  res.status(status).json({ ok: false, error: { message, code: error?.code || (status >= 500 ? 'INTERNAL' : 'ERROR') } });
}
