import { Router } from 'express';
import * as store from '../db.js';
import {
  clearSession,
  issueSession,
  login,
  publicUser,
  register,
  requireUser,
} from '../auth.js';
import { asyncRoute, ok } from '@office/shared/http';
import { config } from '../config.js';
import { serviceStatus } from '../capability.js';
import { quotaSnapshot, modelCatalog } from '../ai.js';
import { audit } from '../db.js';
import { HttpError, bad } from '@office/shared/util';

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncRoute(async (req, res) => {
    if (!config.allowRegister) throw new HttpError(403, '本站暂未开放注册', 'REGISTER_CLOSED');
    const { email, password, displayName } = req.body || {};
    const user = await register({ email, password, displayName });
    issueSession(res, user.id, req.get('user-agent'));
    const claimed = store.claimGuestDocuments(req.guestKey, user.id);
    audit({ userId: user.id, action: 'register', detail: `claimed=${claimed}`, ip: req.ip });
    ok(res, { user: publicUser(user), claimedDocuments: claimed }, 201);
  }),
);

authRouter.post(
  '/login',
  asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};
    const user = await login(email, password);
    issueSession(res, user.id, req.get('user-agent'));
    const claimed = store.claimGuestDocuments(req.guestKey, user.id);
    audit({ userId: user.id, action: 'login', ip: req.ip });
    ok(res, { user: publicUser(user), claimedDocuments: claimed });
  }),
);

authRouter.post('/logout', (req, res) => {
  clearSession(req, res);
  ok(res, { loggedOut: true });
});

authRouter.get('/me', (req, res) => {
  ok(res, {
    user: publicUser(req.user),
    guestKey: req.user ? null : req.guestKey,
    quota: quotaSnapshot({ user: req.user, guestKey: req.guestKey }),
    config: {
      siteName: config.siteName,
      blogUrl: config.blogUrl,
      allowRegister: config.allowRegister,
      maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
      maxJsonMb: Math.round(config.maxJsonBytes / 1024 / 1024),
      limits: config.limits,
    },
  });
});

authRouter.post(
  '/password',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const { currentPassword, newPassword } = req.body || {};
    if (String(newPassword || '').length < 8) throw bad('新密码至少 8 位', 'WEAK_PASSWORD');
    const row = store.findUserByEmail(user.email);
    const { verifyPassword, hashPassword } = await import('@office/shared/util');
    if (!(await verifyPassword(String(currentPassword || ''), row.password_hash))) {
      throw new HttpError(403, '当前密码不正确', 'BAD_PASSWORD');
    }
    store.updateUser(user.id, { password_hash: await hashPassword(String(newPassword)) });
    audit({ userId: user.id, action: 'password-change', ip: req.ip });
    ok(res, { changed: true });
  }),
);

export const metaRouter = Router();

metaRouter.get(
  '/bootstrap',
  asyncRoute(async (req, res) => {
    const [models, site, services] = await Promise.all([
      modelCatalog(),
      Promise.resolve(store.stats()),
      serviceStatus(),
    ]);
    ok(res, {
      user: publicUser(req.user),
      quota: quotaSnapshot({ user: req.user, guestKey: req.guestKey }),
      models,
      services,
      site: {
        name: config.siteName,
        blogUrl: config.blogUrl,
        allowRegister: config.allowRegister,
        maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
      },
      stats: {
        templates: site.templates,
        documents: site.documents,
        assets: site.assets,
      },
    });
  }),
);

/** 能力服务健康状态（管理后台与排障用）。 */
metaRouter.get(
  '/services',
  asyncRoute(async (req, res) => {
    ok(res, { services: await serviceStatus({ fresh: req.query.fresh === '1' }) });
  }),
);
