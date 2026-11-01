import { Router } from 'express';
import { config } from '../config.js';
import * as store from '../db.js';
import * as blobs from '../blobs.js';
import * as ai from '../ai.js';
import { asyncRoute, ok } from '../http.js';
import { HttpError, bad, RateLimiter, slugify, truncate } from '../util.js';
import { requireUser } from '../auth.js';

export const aiRouter = Router();

const chatLimiter = new RateLimiter(30, 60_000);
const imageLimiter = new RateLimiter(10, 60_000);

function ctxOf(req) {
  return { user: req.user, guestKey: req.guestKey };
}

function limiterKey(req) {
  return req.user ? `u:${req.user.id}` : `g:${req.guestKey}`;
}

function guard(limiter, req) {
  const result = limiter.take(limiterKey(req));
  if (!result.ok) {
    throw new HttpError(429, `请求过于频繁，请 ${result.retryAfter} 秒后再试`, 'RATE_LIMITED');
  }
}

aiRouter.get('/status', asyncRoute(async (req, res) => {
  const models = await ai.modelCatalog();
  ok(res, {
    ...models,
    quota: ai.quotaSnapshot(ctxOf(req)),
  });
}));

aiRouter.post(
  '/chat',
  asyncRoute(async (req, res) => {
    guard(chatLimiter, req);
    const result = await ai.chat(ctxOf(req), {
      task: String(req.body?.task || 'polish'),
      text: String(req.body?.text || ''),
      locale: req.body?.locale,
      extra: req.body?.extra,
    });
    ok(res, { ...result, quota: ai.quotaSnapshot(ctxOf(req)) });
  }),
);

aiRouter.post(
  '/outline',
  asyncRoute(async (req, res) => {
    guard(chatLimiter, req);
    const result = await ai.generateOutline(ctxOf(req), {
      topic: String(req.body?.topic || ''),
      pages: req.body?.pages,
      tone: req.body?.tone,
    });
    ok(res, {
      outline: result.outline,
      repaired: result.repaired,
      model: result.model,
      latencyMs: result.latencyMs,
      quota: ai.quotaSnapshot(ctxOf(req)),
    });
  }),
);

aiRouter.post(
  '/image',
  asyncRoute(async (req, res) => {
    guard(imageLimiter, req);
    const prompt = truncate(String(req.body?.prompt || ''), 2000);
    const size = String(req.body?.size || '16:9');
    const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 4);
    const result = await ai.generateImage(ctxOf(req), { prompt, size, count });

    const saved = [];
    for (const image of result.images) {
      let buffer = image.buffer;
      if (!buffer && image.url) {
        const response = await fetch(image.url);
        if (!response.ok) continue;
        buffer = Buffer.from(await response.arrayBuffer());
      }
      if (!buffer) continue;
      const kind = blobs.sniffImage(buffer);
      if (!kind) continue;
      const stored = blobs.storeContent(buffer, kind === 'jpg' ? 'jpg' : kind);
      const dims = blobs.imageSize(buffer, kind);
      const asset = store.createAsset({
        ownerId: req.user?.id,
        guestKey: req.user ? null : req.guestKey,
        kind: 'image',
        title: truncate(prompt || 'AI 生成图', 60),
        tags: 'ai,generated',
        prompt,
        mime: blobs.mimeForExt(kind),
        size: buffer.length,
        sha256: stored.sha256,
        blobKey: stored.key,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        source: 'ai',
        model: result.model,
      });
      saved.push({
        id: asset.id,
        title: asset.title,
        url: `/api/assets/${asset.id}/file`,
        width: asset.width,
        height: asset.height,
        prompt,
      });
    }
    if (!saved.length) throw new HttpError(502, '生成的图片无法保存（格式无法识别）', 'AI_BAD_IMAGE');
    ok(res, {
      images: saved,
      model: result.model,
      aspect: result.aspect,
      latencyMs: result.latencyMs,
      quota: ai.quotaSnapshot(ctxOf(req)),
    });
  }),
);

aiRouter.get(
  '/usage',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    if (user.role !== 'admin') throw new HttpError(403, '需要管理员权限', 'FORBIDDEN');
    ok(res, { usage: store.usageSummary(80), stats: store.stats() });
  }),
);

/* 素材库里的「生成配图」入口：直接给模板/文档补图 */
aiRouter.post(
  '/image/for-document',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const docId = String(req.body?.documentId || '');
    const doc = store.getDocument(docId);
    if (!doc) throw bad('文档不存在', 'NOT_FOUND');
    if (doc.owner_id && doc.owner_id !== user.id) throw new HttpError(403, '无权访问该文档', 'FORBIDDEN');
    const style = String(req.body?.style || 'flat illustration, clean corporate style, soft light');
    const topic = truncate(String(req.body?.topic || doc.title), 200);
    const result = await ai.generateImage({ user, guestKey: req.guestKey }, {
      prompt: `${topic}，${style}，no text`,
      size: String(req.body?.size || '16:9'),
      count: 1,
    });
    const image = result.images[0];
    if (!image?.buffer) throw new HttpError(502, '生成失败', 'AI_EMPTY');
    const kind = blobs.sniffImage(image.buffer) || 'png';
    const stored = blobs.storeContent(image.buffer, kind);
    const dims = blobs.imageSize(image.buffer, kind);
    const asset = store.createAsset({
      ownerId: user.id,
      kind: 'image',
      title: truncate(`${doc.title} 配图`, 60),
      tags: 'ai,illustration',
      prompt: topic,
      mime: blobs.mimeForExt(kind),
      size: image.buffer.length,
      sha256: stored.sha256,
      blobKey: stored.key,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      source: 'ai',
      model: result.model,
    });
    ok(res, { asset: { id: asset.id, url: `/api/assets/${asset.id}/file`, width: asset.width, height: asset.height } });
  }),
);

export const adminRouter = Router();

adminRouter.get(
  '/overview',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    if (user.role !== 'admin') throw new HttpError(403, '需要管理员权限', 'FORBIDDEN');
    ok(res, {
      users: store.listUsers(),
      stats: store.stats(),
      storage: blobs.storageUsage(),
      usage: store.usageSummary(40),
      audit: store.recentAudit(60),
      models: await ai.modelCatalog(),
      config: {
        museBase: config.muse.baseUrl,
        hasKey: Boolean(config.muse.apiKey),
        quota: config.quota,
      },
    });
  }),
);

adminRouter.patch(
  '/users/:id',
  asyncRoute(async (req, res) => {
    const admin = requireUser(req);
    if (admin.role !== 'admin') throw new HttpError(403, '需要管理员权限', 'FORBIDDEN');
    const target = store.findUserById(req.params.id);
    if (!target) throw bad('用户不存在', 'NOT_FOUND');
    const patch = {};
    if (req.body?.role && ['member', 'admin', 'guest'].includes(req.body.role)) patch.role = req.body.role;
    if (req.body?.disabled !== undefined) patch.disabled = req.body.disabled ? 1 : 0;
    if (target.id === admin.id && patch.disabled) throw bad('不能停用自己', 'SELF_DISABLE');
    const updated = store.updateUser(target.id, patch);
    store.audit({ userId: admin.id, action: 'user-update', target: target.id, detail: JSON.stringify(patch), ip: req.ip });
    ok(res, { user: { id: updated.id, email: updated.email, role: updated.role, disabled: Boolean(updated.disabled) } });
  }),
);
