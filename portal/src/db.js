import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, ensureDirs } from './config.js';
import { dayKey, now, safeJson, uid } from '@office/shared/util';

ensureDirs();

const dbPath = process.env.OFFICE_DB_PATH || path.join(config.dataDir, 'office.db');
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  guest_key TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local',
  size INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}',
  blob_key TEXT,
  thumb_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_guest ON documents(guest_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  guest_key TEXT,
  kind TEXT NOT NULL DEFAULT 'image',
  title TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  blob_key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  source TEXT NOT NULL DEFAULT 'upload',
  model TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_tags ON assets(tags);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  blob_key TEXT NOT NULL,
  preview TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_kind ON templates(kind, category);

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  guest_key TEXT,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  units INTEGER NOT NULL DEFAULT 1,
  day TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user_day ON ai_usage(user_id, day, kind);

CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

/* ------------------------------- users ------------------------------- */

const userColumns = `id, email, display_name, role, disabled, created_at, last_login_at`;

export function findUserByEmail(email) {
  return db.prepare(`SELECT ${userColumns}, password_hash FROM users WHERE email = ?`).get(String(email).toLowerCase());
}

export function findUserById(id) {
  if (!id) return undefined;
  return db.prepare(`SELECT ${userColumns} FROM users WHERE id = ?`).get(id);
}

export function createUser({ email, passwordHash, displayName, role = 'member' }) {
  const row = {
    id: uid('u_'),
    email: String(email).toLowerCase(),
    password_hash: passwordHash,
    display_name: displayName,
    role,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.email, row.password_hash, row.display_name, row.role, row.created_at);
  return findUserById(row.id);
}

export function listUsers() {
  return db
    .prepare(`SELECT ${userColumns}, (SELECT COUNT(*) FROM documents d WHERE d.owner_id = users.id AND d.deleted_at IS NULL) AS documents
              FROM users ORDER BY created_at DESC`)
    .all();
}

export function updateUser(id, patch) {
  const fields = [];
  const values = [];
  for (const key of ['display_name', 'role', 'disabled']) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (patch.password_hash) {
    fields.push('password_hash = ?');
    values.push(patch.password_hash);
  }
  if (!fields.length) return findUserById(id);
  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return findUserById(id);
}

export function touchLogin(id) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), id);
}

export function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

/* ------------------------------ sessions ----------------------------- */

export function createSession({ id, userId, tokenHash, expiresAt, userAgent }) {
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, tokenHash, now(), expiresAt, userAgent || '');
}

export function findSessionByHash(tokenHash) {
  return db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
}

export function deleteSession(id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
}

/* ----------------------------- documents ----------------------------- */

const docColumns = `id, owner_id, guest_key, kind, title, source, size, meta, blob_key, thumb_key, created_at, updated_at`;

export function createDocument(doc) {
  const id = doc.id || uid('d_');
  const ts = now();
  db.prepare(
    `INSERT INTO documents (id, owner_id, guest_key, kind, title, source, size, meta, blob_key, thumb_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    doc.ownerId || null,
    doc.guestKey || null,
    doc.kind,
    doc.title,
    doc.source || 'local',
    doc.size || 0,
    JSON.stringify(doc.meta || {}),
    doc.blobKey || null,
    doc.thumbKey || null,
    ts,
    ts,
  );
  return getDocument(id);
}

export function getDocument(id) {
  const row = db.prepare(`SELECT ${docColumns} FROM documents WHERE id = ? AND deleted_at IS NULL`).get(id);
  return row ? { ...row, meta: safeJson(row.meta, {}) } : undefined;
}

export function listDocuments({ ownerId, guestKey, kind, limit = 100 }) {
  const where = ['deleted_at IS NULL'];
  const params = [];
  if (ownerId) {
    where.push('owner_id = ?');
    params.push(ownerId);
  } else if (guestKey) {
    where.push('guest_key = ?');
    params.push(guestKey);
  }
  if (kind) {
    where.push('kind = ?');
    params.push(kind);
  }
  params.push(limit);
  return db
    .prepare(`SELECT ${docColumns} FROM documents WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`)
    .all(...params)
    .map((row) => ({ ...row, meta: safeJson(row.meta, {}) }));
}

export function updateDocument(id, patch) {
  const fields = [];
  const values = [];
  const map = {
    title: 'title',
    size: 'size',
    blobKey: 'blob_key',
    thumbKey: 'thumb_key',
    meta: 'meta',
    source: 'source',
    ownerId: 'owner_id',
    guestKey: 'guest_key',
  };
  for (const [key, column] of Object.entries(map)) {
    if (patch[key] !== undefined) {
      fields.push(`${column} = ?`);
      values.push(key === 'meta' ? JSON.stringify(patch[key] || {}) : patch[key]);
    }
  }
  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);
  db.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getDocument(id);
}

export function deleteDocument(id) {
  db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(now(), id);
}

export function claimGuestDocuments(guestKey, ownerId) {
  if (!guestKey) return 0;
  const info = db
    .prepare('UPDATE documents SET owner_id = ?, guest_key = NULL WHERE guest_key = ? AND deleted_at IS NULL')
    .run(ownerId, guestKey);
  return info.changes;
}

/* ------------------------------ assets ------------------------------- */

const assetColumns = `id, owner_id, guest_key, kind, title, tags, prompt, mime, size, sha256, blob_key, width, height, source, model, created_at`;

export function createAsset(asset) {
  const id = asset.id || uid('a_');
  db.prepare(
    `INSERT INTO assets (id, owner_id, guest_key, kind, title, tags, prompt, mime, size, sha256, blob_key, width, height, source, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    asset.ownerId || null,
    asset.guestKey || null,
    asset.kind || 'image',
    asset.title,
    asset.tags || '',
    asset.prompt || '',
    asset.mime,
    asset.size,
    asset.sha256,
    asset.blobKey,
    asset.width ?? null,
    asset.height ?? null,
    asset.source || 'upload',
    asset.model || null,
    now(),
  );
  return getAsset(id);
}

export function getAsset(id) {
  return db.prepare(`SELECT ${assetColumns} FROM assets WHERE id = ? AND deleted_at IS NULL`).get(id);
}

/** 素材可见范围：本人 + 公共；游客看自己的 + 公共。列表和标签统计必须用同一套。 */
function assetScope(where, params, { ownerId, guestKey = null, includeShared = true }) {
  if (ownerId) {
    if (includeShared) {
      where.push('(owner_id = ? OR owner_id IS NULL)');
      params.push(ownerId);
    } else {
      where.push('owner_id = ?');
      params.push(ownerId);
    }
  } else if (guestKey) {
    where.push('(guest_key = ? OR (owner_id IS NULL AND guest_key IS NULL))');
    params.push(guestKey);
  } else {
    where.push('owner_id IS NULL AND guest_key IS NULL');
  }
  return where;
}

export function listAssets({ ownerId, guestKey = null, kind, query, tag, limit = 60, offset = 0, includeShared = true }) {
  const where = ['deleted_at IS NULL'];
  const params = [];
  assetScope(where, params, { ownerId, guestKey, includeShared });
  if (kind) {
    where.push('kind = ?');
    params.push(kind);
  }
  if (query) {
    where.push('(title LIKE ? OR tags LIKE ? OR prompt LIKE ?)');
    const like = `%${query}%`;
    params.push(like, like, like);
  }
  if (tag) {
    where.push("(',' || tags || ',') LIKE ?");
    params.push(`%,${tag},%`);
  }
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM assets WHERE ${where.join(' AND ')}`)
    .get(...params).n;
  params.push(limit, offset);
  const items = db
    .prepare(`SELECT ${assetColumns} FROM assets WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params);
  return { items, total };
}

/** 标签统计必须与列表同作用域，否则会把别人的私有标签暴露在筛选栏里。 */
export function listAssetTags({ ownerId, guestKey = null, includeShared = true } = {}) {
  const where = ['deleted_at IS NULL'];
  const params = [];
  assetScope(where, params, { ownerId, guestKey, includeShared });
  const rows = db.prepare(`SELECT tags FROM assets WHERE ${where.join(' AND ')}`).all(...params);
  const counts = new Map();
  for (const row of rows) {
    for (const tag of String(row.tags || '').split(',').filter(Boolean)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name, count]) => ({ name, count }));
}

export function deleteAsset(id) {
  db.prepare('UPDATE assets SET deleted_at = ? WHERE id = ?').run(now(), id);
}

/* ---------------------------- templates ------------------------------ */

const templateColumns = `id, slug, kind, title, category, description, tags, blob_key, preview, size, downloads, featured, created_at`;

export function upsertTemplate(tpl) {
  const existing = db.prepare('SELECT id FROM templates WHERE slug = ?').get(tpl.slug);
  if (existing) {
    db.prepare(
      `UPDATE templates SET kind = ?, title = ?, category = ?, description = ?, tags = ?, blob_key = ?, preview = ?, size = ?, featured = ? WHERE slug = ?`,
    ).run(
      tpl.kind,
      tpl.title,
      tpl.category || 'general',
      tpl.description || '',
      tpl.tags || '',
      tpl.blobKey,
      tpl.preview || '',
      tpl.size || 0,
      tpl.featured ? 1 : 0,
      tpl.slug,
    );
    return db.prepare(`SELECT ${templateColumns} FROM templates WHERE slug = ?`).get(tpl.slug);
  }
  const id = uid('t_');
  db.prepare(
    `INSERT INTO templates (id, slug, kind, title, category, description, tags, blob_key, preview, size, featured, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    tpl.slug,
    tpl.kind,
    tpl.title,
    tpl.category || 'general',
    tpl.description || '',
    tpl.tags || '',
    tpl.blobKey,
    tpl.preview || '',
    tpl.size || 0,
    tpl.featured ? 1 : 0,
    now(),
  );
  return db.prepare(`SELECT ${templateColumns} FROM templates WHERE id = ?`).get(id);
}

export function listTemplates({ kind, category, query, limit = 100 } = {}) {
  const where = ['1=1'];
  const params = [];
  if (kind) {
    where.push('kind = ?');
    params.push(kind);
  }
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  if (query) {
    where.push('(title LIKE ? OR description LIKE ? OR tags LIKE ?)');
    const like = `%${query}%`;
    params.push(like, like, like);
  }
  params.push(limit);
  return db
    .prepare(`SELECT ${templateColumns} FROM templates WHERE ${where.join(' AND ')} ORDER BY featured DESC, created_at ASC LIMIT ?`)
    .all(...params);
}

export function getTemplate(slugOrId) {
  return db
    .prepare(`SELECT ${templateColumns} FROM templates WHERE slug = ? OR id = ?`)
    .get(slugOrId, slugOrId);
}

export function bumpTemplateDownload(id) {
  db.prepare('UPDATE templates SET downloads = downloads + 1 WHERE id = ?').run(id);
}

/* ----------------------------- ai usage ------------------------------ */

export function recordUsage(entry) {
  db.prepare(
    `INSERT INTO ai_usage (id, user_id, guest_key, kind, model, status, latency_ms, units, day, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uid('ai_'),
    entry.userId || null,
    entry.guestKey || null,
    entry.kind,
    entry.model || '',
    entry.status,
    entry.latencyMs || 0,
    entry.units || 1,
    entry.day || dayKey(),
    entry.detail || '',
    now(),
  );
}

export function usageToday({ userId, guestKey, kind }) {
  if (userId) {
    return db
      .prepare('SELECT COALESCE(SUM(units),0) AS n FROM ai_usage WHERE user_id = ? AND day = ? AND kind = ?')
      .get(userId, dayKey(), kind).n;
  }
  return db
    .prepare('SELECT COALESCE(SUM(units),0) AS n FROM ai_usage WHERE guest_key = ? AND day = ? AND kind = ?')
    .get(guestKey, dayKey(), kind).n;
}

export function usageSummary(limit = 50) {
  const byDay = db
    .prepare(
      `SELECT day, kind, COUNT(*) AS calls, SUM(units) AS units, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM ai_usage GROUP BY day, kind ORDER BY day DESC LIMIT ?`,
    )
    .all(limit);
  const recent = db
    .prepare('SELECT * FROM ai_usage ORDER BY created_at DESC LIMIT ?')
    .all(limit);
  const byUser = db
    .prepare(
      `SELECT u.email, u.display_name, COUNT(*) AS calls, SUM(a.units) AS units
       FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id
       GROUP BY a.user_id ORDER BY calls DESC LIMIT ?`,
    )
    .all(limit);
  return { byDay, recent, byUser };
}

/* ------------------------------- audit ------------------------------- */

export function audit(entry) {
  db.prepare(
    `INSERT INTO audit (id, user_id, action, target, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(uid('log_'), entry.userId || null, entry.action, entry.target || null, entry.detail || '', entry.ip || '', now());
}

export function recentAudit(limit = 100) {
  return db
    .prepare(
      `SELECT a.*, u.email FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all(limit);
}

/* ------------------------------ settings ----------------------------- */

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? safeJson(row.value, row.value) : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
  return value;
}

export function stats() {
  const one = (sql, ...params) => db.prepare(sql).get(...params).n;
  return {
    users: one('SELECT COUNT(*) AS n FROM users'),
    documents: one('SELECT COUNT(*) AS n FROM documents WHERE deleted_at IS NULL'),
    assets: one('SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NULL'),
    templates: one('SELECT COUNT(*) AS n FROM templates'),
    aiCalls: one('SELECT COUNT(*) AS n FROM ai_usage'),
    aiToday: one('SELECT COUNT(*) AS n FROM ai_usage WHERE day = ?', dayKey()),
    storageBytes:
      one('SELECT COALESCE(SUM(size),0) AS n FROM assets WHERE deleted_at IS NULL') +
      one('SELECT COALESCE(SUM(size),0) AS n FROM documents WHERE deleted_at IS NULL'),
  };
}
