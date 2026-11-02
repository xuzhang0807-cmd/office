import crypto from 'node:crypto';
import { config, sessionSecret } from './config.js';
import * as store from './db.js';
import { hashPassword, randomToken, sha256, unauthorized, verifyPassword, forbidden } from '@office/shared/util';

const COOKIE = 'office_sid';
const GUEST_COOKIE = 'office_guest';
const MAX_AGE_MS = config.sessionDays * 86_400_000;

function signToken(raw) {
  const mac = crypto.createHmac('sha256', sessionSecret()).update(raw).digest('base64url');
  return `${raw}.${mac}`;
}

function verifySigned(token) {
  if (!token || !token.includes('.')) return null;
  const index = token.lastIndexOf('.');
  const raw = token.slice(0, index);
  const mac = token.slice(index + 1);
  const expected = crypto.createHmac('sha256', sessionSecret()).update(raw).digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return raw;
}

export function issueSession(res, userId, userAgent) {
  const raw = randomToken(32);
  const id = crypto.randomUUID();
  store.createSession({
    id,
    userId,
    tokenHash: sha256(raw),
    expiresAt: Date.now() + MAX_AGE_MS,
    userAgent,
  });
  res.cookie(COOKIE, signToken(raw), {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: MAX_AGE_MS,
    path: '/',
  });
  return id;
}

export function clearSession(req, res) {
  if (req.sessionId) store.deleteSession(req.sessionId);
  res.clearCookie(COOKIE, { path: '/' });
}

export function ensureGuestKey(req, res) {
  const existing = req.cookies?.[GUEST_COOKIE];
  const raw = verifySigned(existing);
  if (raw) return raw;
  const fresh = randomToken(18);
  res.cookie(GUEST_COOKIE, signToken(fresh), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 180 * 86_400_000,
    path: '/',
  });
  return fresh;
}

/** 每个请求解析一次身份：登录用户 / 游客 / 匿名。 */
export function attachIdentity(req, res, next) {
  req.guestKey = ensureGuestKey(req, res);
  req.user = null;
  req.sessionId = null;
  const token = req.cookies?.[COOKIE];
  const raw = verifySigned(token);
  if (raw) {
    const session = store.findSessionByHash(sha256(raw));
    if (session && session.expires_at > Date.now()) {
      const user = store.findUserById(session.user_id);
      if (user && !user.disabled) {
        req.user = { ...user, role: user.role };
        req.sessionId = session.id;
      }
    } else if (session) {
      store.deleteSession(session.id);
    }
  }
  next();
}

export function requireUser(req) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== 'admin') throw forbidden('需要管理员权限');
  return user;
}

export async function register({ email, password, displayName }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw Object.assign(new Error('邮箱格式不正确'), { status: 400 });
  if (String(password || '').length < 8) throw Object.assign(new Error('密码至少 8 位'), { status: 400 });
  if (store.findUserByEmail(normalized)) throw Object.assign(new Error('该邮箱已注册'), { status: 409 });
  const role = store.countUsers() === 0 ? 'admin' : 'member';
  const user = store.createUser({
    email: normalized,
    passwordHash: await hashPassword(String(password)),
    displayName: String(displayName || normalized.split('@')[0]).slice(0, 40),
    role,
  });
  return user;
}

export async function login(email, password) {
  const row = store.findUserByEmail(String(email || '').toLowerCase());
  if (!row) throw Object.assign(new Error('邮箱或密码不正确'), { status: 401 });
  if (row.disabled) throw Object.assign(new Error('账号已被停用'), { status: 403 });
  const ok = await verifyPassword(String(password || ''), row.password_hash);
  if (!ok) throw Object.assign(new Error('邮箱或密码不正确'), { status: 401 });
  store.touchLogin(row.id);
  return store.findUserById(row.id);
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}
