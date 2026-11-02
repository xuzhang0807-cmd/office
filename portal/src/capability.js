import { config } from './config.js';
import { HttpError } from '@office/shared/util';

/**
 * 能力服务的 HTTP 客户端。
 *
 * 门户不直接 import 任何转换器——所有格式处理都经过这一层走 HTTP。
 * 好处：能力可以独立重启/升级/换语言；坏处：多一次本地网络往返（实测 <2ms）。
 *
 * 失败语义：
 *   能力服务返回 4xx → 原样透传状态码与 message（用户能看懂的错误）
 *   能力服务不可达   → 502 + SERVICE_UNAVAILABLE，前端提示"该功能暂不可用"
 *   能力服务超时     → 504 + SERVICE_TIMEOUT
 */

const HEALTH_TTL_MS = 5000;
const healthCache = new Map();

async function post(service, op, args, timeoutMs) {
  const base = config.services[service];
  if (!base) throw new HttpError(500, `未配置能力服务：${service}`, 'SERVICE_NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${base}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op, args }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new HttpError(504, `能力服务 ${service} 超时（${Math.round(timeoutMs / 1000)}s）`, 'SERVICE_TIMEOUT');
    }
    throw new HttpError(502, `能力服务 ${service} 不可达：${error.message}`, 'SERVICE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok || body?.ok === false) {
    const message = body?.error?.message || `能力服务 ${service} 返回 ${response.status}`;
    const code = body?.error?.code || 'SERVICE_ERROR';
    throw new HttpError(response.status >= 400 && response.status < 500 ? response.status : 502, message, code);
  }
  return body?.data ?? {};
}

export const capability = {
  docx: {
    export: (args) => post('docx', 'export', args, config.serviceTimeoutMs),
    import: (args) => post('docx', 'import', args, config.serviceTimeoutMs),
    text: (args) => post('docx', 'text', args, config.serviceTimeoutMs),
  },
  xlsx: {
    export: (args) => post('xlsx', 'export', args, config.serviceTimeoutMs),
    import: (args) => post('xlsx', 'import', args, config.serviceTimeoutMs),
    csv: (args) => post('xlsx', 'csv', args, config.serviceTimeoutMs),
    bounds: (args) => post('xlsx', 'bounds', args, config.serviceTimeoutMs),
  },
  pptx: {
    export: (args) => post('pptx', 'export', args, config.serviceTimeoutMs),
    import: (args) => post('pptx', 'import', args, config.serviceTimeoutMs),
    outline: (args) => post('pptx', 'outline', args, config.serviceTimeoutMs),
    blank: (args) => post('pptx', 'blank', args, config.serviceTimeoutMs),
    text: (args) => post('pptx', 'text', args, config.serviceTimeoutMs),
  },
  pdf: {
    info: (args) => post('pdf', 'info', args, config.serviceTimeoutMs),
    create: (args) => post('pdf', 'create', args, config.serviceTimeoutMs),
    extract: (args) => post('pdf', 'extract', args, config.serviceTimeoutMs),
    delete: (args) => post('pdf', 'delete', args, config.serviceTimeoutMs),
    merge: (args) => post('pdf', 'merge', args, config.serviceHeavyTimeoutMs),
    rotate: (args) => post('pdf', 'rotate', args, config.serviceTimeoutMs),
    watermark: (args) => post('pdf', 'watermark', args, config.serviceTimeoutMs),
    reorder: (args) => post('pdf', 'reorder', args, config.serviceTimeoutMs),
    metadata: (args) => post('pdf', 'metadata', args, config.serviceTimeoutMs),
    text: (args) => post('pdf', 'text', args, config.serviceTimeoutMs),
    pages: (args) => post('pdf', 'pages', args, config.serviceTimeoutMs),
    fromHtml: (args) => post('pdf', 'fromHtml', args, config.serviceTimeoutMs),
    fromXlsx: (args) => post('pdf', 'fromXlsx', args, config.serviceTimeoutMs),
    fromPptx: (args) => post('pdf', 'fromPptx', args, config.serviceTimeoutMs),
    fonts: (args) => post('pdf', 'fonts', args || {}, config.serviceTimeoutMs),
  },
};

/** 批量探活，供 /api/meta/services 与后台看板使用。 */
export async function serviceStatus({ fresh = false } = {}) {
  const names = Object.keys(config.services);
  const results = await Promise.all(
    names.map(async (name) => {
      const cached = healthCache.get(name);
      if (!fresh && cached && Date.now() - cached.at < HEALTH_TTL_MS) return cached.value;
      const base = config.services[name];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      let value;
      try {
        const response = await fetch(`${base}/health`, { signal: controller.signal });
        const body = await response.json();
        value = { name, url: base, up: response.ok, version: body?.data?.version || null, error: null };
      } catch (error) {
        value = { name, url: base, up: false, version: null, error: error.message };
      } finally {
        clearTimeout(timer);
      }
      healthCache.set(name, { at: Date.now(), value });
      return value;
    }),
  );
  return results;
}

/** 二进制出入参统一 base64，这里只做编解码，不关心内容。 */
export const toB64 = (buffer) => Buffer.from(buffer).toString('base64');
export const fromB64 = (value) => Buffer.from(value, 'base64');
