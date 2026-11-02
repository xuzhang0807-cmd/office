import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, ensureDirs } from './config.js';
import { attachIdentity } from './auth.js';
import { jsonBody } from '@office/shared/http';
import { purgeExpiredSessions, stats } from './db.js';
import { authRouter, metaRouter } from './routes/auth.js';
import { documentsRouter } from './routes/documents.js';
import { assetsRouter, templatesRouter } from './routes/assets.js';
import { aiRouter, adminRouter } from './routes/ai.js';
import { seedTemplates } from './seed.js';

ensureDirs();

/** 版本号以 package.json 为唯一来源，避免多处手改。 */
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** 前端产物位置：portal/web/dist（Vite 的输出目录）。 */
const WEB_DIST = path.join(config.root, 'portal', 'web', 'dist');

export function createApp({ serveStatic = true } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.set('jsonLimit', config.maxJsonBytes);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'",
    );
    next();
  });

  app.use(cookieParser());
  app.use(jsonBody);
  app.use(attachIdentity);

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, data: { status: 'up', time: Date.now(), version: VERSION } });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/meta', metaRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/assets', assetsRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, error: { message: `接口不存在：${req.method} ${req.originalUrl}`, code: 'NOT_FOUND' } });
  });

  if (serveStatic) {
    if (fs.existsSync(WEB_DIST)) {
      app.use(
        express.static(WEB_DIST, {
          index: false,
          setHeaders(res, filePath) {
            if (filePath.includes(`${path.sep}assets${path.sep}`)) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else {
              res.setHeader('Cache-Control', 'no-cache');
            }
          },
        }),
      );
      app.get(/^(?!\/api).*/, (req, res, next) => {
        if (req.method !== 'GET') return next();
        res.sendFile(path.join(WEB_DIST, 'index.html'));
      });
    } else {
      app.get('/', (req, res) => {
        res.type('text/plain').send('前端尚未构建：请先运行 npm run build（或在开发时使用 npm run dev）。');
      });
    }
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = Number(error?.status) || 500;
    const message = status >= 500 && !error?.code ? '服务器内部错误' : error?.message || '服务器内部错误';
    if (status >= 500) console.error('[portal]', error);
    if (res.headersSent) return;
    res.status(status).json({ ok: false, error: { message, code: error?.code || (status >= 500 ? 'INTERNAL' : 'ERROR') } });
  });

  return app;
}

export async function start({ port = config.port, host = config.host, seed = true } = {}) {
  const seeded = seed ? await seedTemplates() : { created: 0, skipped: 0, failed: [] };
  purgeExpiredSessions();
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      const actual = server.address();
      const failed = seeded.failed?.length ? ` failed=${seeded.failed.length}` : '';
      console.log(
        `[portal] v${VERSION} listening on http://${host}:${actual.port} templates=${seeded.created || 'cached'}${failed} stats=${JSON.stringify(stats())}`,
      );
      resolve(server);
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  // 某些原生/编码库会在异步队列里抛错（try/catch 接不住）。记日志后主动退出，
  // 交给 restart 策略拉起，好过带着不确定状态继续服务或让请求永久挂起。
  process.on('uncaughtException', (error) => {
    console.error('[portal] uncaughtException:', error?.stack || error);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[portal] unhandledRejection:', reason);
    process.exit(1);
  });
  start().catch((error) => {
    console.error('[portal] 启动失败', error);
    process.exit(1);
  });
  setInterval(() => {
    try {
      purgeExpiredSessions();
    } catch (error) {
      console.error('[portal] session purge failed', error.message);
    }
  }, 6 * 3600 * 1000).unref();
}
