import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');

function readEnvFile(file) {
  const out = {};
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch {
    /* 文件不存在时返回空对象 */
  }
  return out;
}

const localEnv = {
  ...readEnvFile(path.join(ROOT, '.env')),
  ...readEnvFile(path.join(ROOT, '.env.local')),
};

function pick(name, fallback) {
  const value = process.env[name] ?? localEnv[name];
  return value === undefined || value === '' ? fallback : value;
}

function num(name, fallback) {
  const parsed = Number(pick(name, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** muse2api 的密钥优先取环境变量，其次复用同级仓库的 .env，避免二次配置。 */
function resolveMuseKey() {
  const explicit = pick('OFFICE_MUSE_KEY', '') || process.env.MUSE2API_KEY || '';
  if (explicit) return explicit;
  const sibling = readEnvFile(path.resolve(ROOT, '../muse2api/.env'));
  return sibling.MUSE2API_KEY || '';
}

const dataDir = path.resolve(pick('OFFICE_DATA_DIR', path.join(ROOT, 'data')));

export const config = {
  root: ROOT,
  dataDir,
  blobDir: path.join(dataDir, 'blobs'),
  secretFile: path.join(dataDir, 'session.secret'),
  port: num('OFFICE_PORT', 32110),
  host: pick('OFFICE_HOST', '0.0.0.0'),
  publicBase: pick('OFFICE_PUBLIC_BASE', ''),
  blogUrl: pick('OFFICE_BLOG_URL', 'https://blog.example.com'),
  siteName: pick('OFFICE_SITE_NAME', '在线办公'),
  allowRegister: pick('OFFICE_ALLOW_REGISTER', '1') === '1',
  maxUploadBytes: num('OFFICE_MAX_UPLOAD_MB', 25) * 1024 * 1024,
  maxJsonBytes: num('OFFICE_MAX_JSON_MB', 32) * 1024 * 1024,
  sessionDays: num('OFFICE_SESSION_DAYS', 30),
  anonymousPerHour: num('OFFICE_ANON_RATE', 120),
  muse: {
    baseUrl: pick('OFFICE_MUSE_BASE', 'http://127.0.0.1:18610').replace(/\/+$/, ''),
    apiKey: resolveMuseKey(),
    chatModel: pick('OFFICE_MUSE_CHAT_MODEL', 'muse-spark'),
    imageModel: pick('OFFICE_MUSE_IMAGE_MODEL', 'muse-image'),
    chatTimeoutMs: num('OFFICE_MUSE_CHAT_TIMEOUT', 180) * 1000,
    imageTimeoutMs: num('OFFICE_MUSE_IMAGE_TIMEOUT', 240) * 1000,
  },
  quota: {
    user: { chat: num('OFFICE_QUOTA_USER_CHAT', 0), image: num('OFFICE_QUOTA_USER_IMAGE', 0) },
    member: { chat: num('OFFICE_QUOTA_MEMBER_CHAT', 60), image: num('OFFICE_QUOTA_MEMBER_IMAGE', 6) },
  },
  limits: {
    sheetRows: 2000,
    sheetCols: 120,
    slides: 200,
    assetsPerUpload: 12,
  },
};

export function ensureDirs() {
  for (const dir of [config.dataDir, config.blobDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function sessionSecret() {
  ensureDirs();
  try {
    const existing = fs.readFileSync(config.secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* 首次启动 */
  }
  const secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  fs.writeFileSync(config.secretFile, secret, { mode: 0o600 });
  return secret;
}

export const rootDir = ROOT;
