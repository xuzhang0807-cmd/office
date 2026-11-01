import { Router } from 'express';
import * as store from '../db.js';
import * as blobs from '../blobs.js';
import { asyncRoute, multipart, ok, sendBuffer } from '../http.js';
import { HttpError, bad, notFound, slugify, truncate } from '../util.js';
import { requireUser } from '../auth.js';

export const assetsRouter = Router();

function scope(req) {
  return req.user ? { ownerId: req.user.id } : { guestKey: req.guestKey };
}

function publicAsset(asset) {
  return {
    id: asset.id,
    kind: asset.kind,
    title: asset.title,
    tags: asset.tags ? asset.tags.split(',').filter(Boolean) : [],
    prompt: asset.prompt,
    mime: asset.mime,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    source: asset.source,
    model: asset.model,
    createdAt: asset.created_at,
    url: `/api/assets/${asset.id}/file`,
    thumbUrl: `/api/assets/${asset.id}/file?w=480`,
    owned: Boolean(asset.owner_id),
  };
}

assetsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 48, 1), 120);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const includeShared = req.query.mine !== '1';
    const { items, total } = store.listAssets({
      ...scope(req),
      kind: req.query.kind ? String(req.query.kind) : undefined,
      query: req.query.q ? truncate(String(req.query.q), 80) : undefined,
      tag: req.query.tag ? String(req.query.tag) : undefined,
      limit,
      offset: (page - 1) * limit,
      includeShared,
    });
    const tags = store.listAssetTags({ ...scope(req), includeShared });
    ok(res, {
      assets: items.map(publicAsset),
      total,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      tags,
    });
  }),
);

assetsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const { files, fields } = await multipart(req, { maxFiles: 12, maxBytes: 12 * 1024 * 1024 });
    if (!files.length) throw bad('未收到图片', 'NO_FILE');
    const created = [];
    for (const file of files) {
      const kind = blobs.sniffImage(file.buffer);
      if (!kind) throw bad(`文件 ${file.filename} 不是受支持的图片（png/jpg/gif/webp/avif/svg）`, 'BAD_IMAGE');
      const stored = blobs.storeContent(file.buffer, kind === 'jpg' ? 'jpg' : kind);
      const size = blobs.imageSize(file.buffer, kind);
      const asset = store.createAsset({
        ownerId: user.id,
        kind: 'image',
        title: truncate(fields.title || file.filename.replace(/\.[^.]+$/, ''), 80) || '未命名素材',
        tags: normalizeTags(fields.tags),
        prompt: '',
        mime: blobs.mimeForExt(kind),
        size: file.buffer.length,
        sha256: stored.sha256,
        blobKey: stored.key,
        width: size?.width ?? null,
        height: size?.height ?? null,
        source: 'upload',
      });
      created.push(publicAsset(asset));
    }
    ok(res, { assets: created }, 201);
  }),
);

function normalizeTags(input) {
  return String(input || '')
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join(',');
}

assetsRouter.get(
  '/:id/file',
  asyncRoute(async (req, res) => {
    const asset = store.getAsset(req.params.id);
    if (!asset) throw notFound('素材不存在');
    if (asset.owner_id && asset.owner_id !== req.user?.id) throw new HttpError(403, '无权访问该素材', 'FORBIDDEN');
    if (!asset.owner_id && asset.guest_key && asset.guest_key !== req.guestKey) {
      throw new HttpError(403, '无权访问该素材', 'FORBIDDEN');
    }
    const buffer = blobs.readBlob(asset.blob_key);
    sendBuffer(res, buffer, {
      mime: asset.mime,
      filename: `${slugify(asset.title, 'asset')}.${asset.mime.split('/')[1] || 'png'}`,
      cache: 'private, max-age=86400',
    });
  }),
);

assetsRouter.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const asset = store.getAsset(req.params.id);
    if (!asset) throw notFound('素材不存在');
    if (asset.owner_id !== req.user?.id) throw new HttpError(403, '只能编辑自己的素材', 'FORBIDDEN');
    const title = req.body?.title !== undefined ? truncate(String(req.body.title).trim(), 80) : asset.title;
    const tags = req.body?.tags !== undefined ? normalizeTags(req.body.tags) : asset.tags;
    store.db
      .prepare('UPDATE assets SET title = ?, tags = ? WHERE id = ?')
      .run(title || asset.title, tags, asset.id);
    ok(res, { asset: publicAsset(store.getAsset(asset.id)) });
  }),
);

assetsRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const asset = store.getAsset(req.params.id);
    if (!asset) throw notFound('素材不存在');
    if (asset.owner_id !== req.user?.id) throw new HttpError(403, '只能删除自己的素材', 'FORBIDDEN');
    store.deleteAsset(asset.id);
    ok(res, { deleted: asset.id });
  }),
);

/* ----------------------------- templates ---------------------------- */

export const templatesRouter = Router();

function publicTemplate(tpl) {
  return {
    id: tpl.id,
    slug: tpl.slug,
    kind: tpl.kind,
    title: tpl.title,
    category: tpl.category,
    description: tpl.description,
    tags: tpl.tags ? tpl.tags.split(',').filter(Boolean) : [],
    preview: tpl.preview,
    size: tpl.size,
    downloads: tpl.downloads,
    featured: Boolean(tpl.featured),
    downloadUrl: `/api/templates/${tpl.slug}/file`,
  };
}

templatesRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const list = store.listTemplates({
      kind: req.query.kind ? String(req.query.kind) : undefined,
      category: req.query.category ? String(req.query.category) : undefined,
      query: req.query.q ? truncate(String(req.query.q), 80) : undefined,
    });
    ok(res, { templates: list.map(publicTemplate) });
  }),
);

templatesRouter.get(
  '/:slug/file',
  asyncRoute(async (req, res) => {
    const tpl = store.getTemplate(req.params.slug);
    if (!tpl) throw notFound('模板不存在');
    const buffer = blobs.readBlob(tpl.blob_key);
    sendBuffer(res, buffer, {
      mime: blobs.mimeForExt(tpl.kind),
      filename: `${slugify(tpl.title, tpl.slug)}.${tpl.kind}`,
      download: req.query.inline !== '1',
      cache: 'public, max-age=3600',
    });
  }),
);
