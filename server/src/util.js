import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const now = () => Date.now();
export const DAY = 86_400_000;

export function uid(prefix = '') {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code || (status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'ERROR');
  }
}

export const bad = (message, code = 'BAD_REQUEST') => new HttpError(400, message, code);
export const unauthorized = (message = '请先登录', code = 'UNAUTHORIZED') => new HttpError(401, message, code);
export const forbidden = (message = '没有权限', code = 'FORBIDDEN') => new HttpError(403, message, code);
export const notFound = (message = '资源不存在', code = 'NOT_FOUND') => new HttpError(404, message, code);
export const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function int(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function safeJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPE[c]);

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  ensp: '\u2002', emsp: '\u2003', mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', copy: '©',
  reg: '®', trade: '™', times: '×', divide: '÷', deg: '°', euro: '€', pound: '£', yen: '¥',
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function slugify(text, fallback = 'file') {
  const cleaned = String(text || '')
    .normalize('NFKD')
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

export function truncate(text, max = 400) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** 固定窗口限流，够用且零依赖。 */
export class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  take(key) {
    const ts = Date.now();
    const bucket = this.hits.get(key);
    if (!bucket || ts - bucket.start >= this.windowMs) {
      this.hits.set(key, { start: ts, count: 1 });
      if (this.hits.size > 5000) this.sweep(ts);
      return { ok: true, remaining: this.limit - 1 };
    }
    bucket.count += 1;
    if (bucket.count > this.limit) {
      return { ok: false, remaining: 0, retryAfter: Math.ceil((bucket.start + this.windowMs - ts) / 1000) };
    }
    return { ok: true, remaining: this.limit - bucket.count };
  }

  sweep(ts = Date.now()) {
    for (const [key, bucket] of this.hits) {
      if (ts - bucket.start >= this.windowMs) this.hits.delete(key);
    }
  }
}

export function extensionOf(name = '') {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match ? match[1].toLowerCase() : '';
}
