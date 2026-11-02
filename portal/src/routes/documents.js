import { Router } from 'express';
import { config } from '../config.js';
import * as store from '../db.js';
import * as blobs from '../blobs.js';
import { capability } from '../capability.js';
import { asyncRoute, multipart, ok, sendBuffer } from '@office/shared/http';
import { HttpError, bad, notFound, safeJson, slugify, truncate } from '@office/shared/util';

/**
 * 文档路由。
 *
 * 与重构前的区别：这里不再 import 任何转换器。
 * 所有格式处理都经过 capability.* → HTTP → 独立能力服务，
 * 因此 docx/xlsx/pptx/pdf 四个服务可以单独部署、单独重启、单独替换实现。
 */

export const documentsRouter = Router();

const KINDS = new Set(['docx', 'xlsx', 'pptx', 'pdf']);

function ownership(req) {
  return req.user ? { ownerId: req.user.id } : { guestKey: req.guestKey };
}

function canAccess(doc, req) {
  if (!doc) return false;
  if (req.user) return doc.owner_id === req.user.id || (doc.owner_id === null && doc.guest_key === null);
  return !doc.owner_id && doc.guest_key === req.guestKey;
}

function loadDoc(req) {
  const doc = store.getDocument(req.params.id);
  if (!doc) throw notFound('文档不存在或已删除');
  if (!canAccess(doc, req)) throw new HttpError(403, '无权访问该文档', 'FORBIDDEN');
  return doc;
}

function publicDoc(doc) {
  return {
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    source: doc.source,
    size: doc.size,
    meta: doc.meta,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
}

function defaultTitle(kind) {
  const map = { docx: '新建文档', xlsx: '新建表格', pptx: '新建演示文稿', pdf: '新建 PDF' };
  return `${map[kind] || '新建文件'} ${new Date().toISOString().slice(5, 10)}`;
}

/** 各类型的空白模型都来自对应能力服务，门户不再持有格式知识。 */
async function blankModel(kind, title) {
  if (kind === 'docx') return { version: 1, html: `<h1>${title}</h1><p></p>` };
  if (kind === 'xlsx') return { version: 1, sheets: [{ name: 'Sheet1', rows: [], merges: [], colWidths: [] }], activeSheet: 0 };
  if (kind === 'pptx') {
    const { model } = await capability.pptx.blank({ theme: 'midnight' });
    return model;
  }
  return { version: 1, info: null };
}

documentsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const docs = store.listDocuments({
      ...ownership(req),
      kind: req.query.kind && KINDS.has(req.query.kind) ? req.query.kind : undefined,
      limit: 200,
    });
    ok(res, { documents: docs.map(publicDoc) });
  }),
);

documentsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const kind = String(req.body?.kind || 'docx');
    if (!KINDS.has(kind)) throw bad('不支持的文档类型', 'BAD_KIND');
    const title = truncate(String(req.body?.title || defaultTitle(kind)), 120);
    const templateSlug = req.body?.template ? String(req.body.template) : '';
    let source = 'local';
    let payload;

    if (templateSlug) {
      const tpl = store.getTemplate(templateSlug);
      if (!tpl) throw notFound('模板不存在');
      if (tpl.kind !== kind) throw bad('模板类型与文档类型不一致', 'KIND_MISMATCH');
      const buffer = blobs.readBlob(tpl.blob_key);
      payload = await importBuffer(kind, buffer);
      source = `template:${tpl.slug}`;
      store.bumpTemplateDownload(tpl.id);
    } else {
      payload = await blankModel(kind, title);
    }

    const doc = store.createDocument({
      ...ownership(req),
      kind,
      title,
      source,
      size: 0,
    });

    if (kind === 'pdf') {
      const { buffer } = await capability.pdf.create({ title });
      const stored = blobs.writeBlob(`doc/${doc.id}.pdf`, Buffer.from(buffer, 'base64'));
      store.updateDocument(doc.id, { blobKey: stored.key, size: stored.size });
    } else {
      const stored = blobs.writeBlob(`doc/${doc.id}.json`, Buffer.from(JSON.stringify(payload)));
      store.updateDocument(doc.id, { blobKey: stored.key, size: stored.size });
    }
    ok(res, { document: publicDoc(store.getDocument(doc.id)) }, 201);
  }),
);

/** 把上传的字节交给对应能力服务解析成可编辑模型。 */
async function importBuffer(kind, buffer) {
  const b64 = buffer.toString('base64');
  if (kind === 'docx') {
    const { html } = await capability.docx.import({ buffer: b64 });
    return { version: 1, html };
  }
  if (kind === 'xlsx') {
    const { model } = await capability.xlsx.import({ buffer: b64 });
    return model;
  }
  if (kind === 'pptx') {
    const { model } = await capability.pptx.import({ buffer: b64 });
    return model;
  }
  const { info } = await capability.pdf.info({ buffer: b64 });
  return { version: 1, info };
}

function detectKind(ext, buffer) {
  const zip = buffer.slice(0, 2).toString('latin1') === 'PK';
  if (zip) {
    const text = buffer.slice(0, 4000).toString('latin1');
    if (text.includes('word/')) return 'docx';
    if (text.includes('xl/')) return 'xlsx';
    if (text.includes('ppt/')) return 'pptx';
    if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') return ext;
    return null;
  }
  if (buffer.slice(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}

documentsRouter.post(
  '/import',
  asyncRoute(async (req, res) => {
    const { files, fields } = await multipart(req, { maxFiles: 1, maxBytes: config.maxUploadBytes });
    const file = files[0];
    if (!file) throw bad('未收到文件', 'NO_FILE');
    const kind = detectKind(file.ext, file.buffer);
    if (!kind) throw bad('仅支持 .docx / .xlsx / .pptx / .pdf', 'BAD_KIND');
    const title = truncate(fields.title || file.filename.replace(/\.[^.]+$/, ''), 120);
    const payload = await importBuffer(kind, file.buffer);

    const doc = store.createDocument({
      ...ownership(req),
      kind,
      title,
      source: 'upload',
      size: file.buffer.length,
    });
    const stored = kind === 'pdf'
      ? blobs.writeBlob(`doc/${doc.id}.pdf`, file.buffer)
      : blobs.writeBlob(`doc/${doc.id}.json`, Buffer.from(JSON.stringify(payload)));
    store.updateDocument(doc.id, { blobKey: stored.key, size: stored.size });
    ok(res, { document: publicDoc(store.getDocument(doc.id)) }, 201);
  }),
);

documentsRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    if (doc.kind === 'pdf') {
      const buffer = blobs.readBlob(doc.blob_key);
      const { info } = await capability.pdf.info({ buffer: buffer.toString('base64') });
      return ok(res, { document: publicDoc(doc), model: { version: 1, info } });
    }
    let model = null;
    if (doc.blob_key) {
      model = safeJson(blobs.readBlob(doc.blob_key).toString('utf8'), null);
    }
    if (!model) model = await blankModel(doc.kind, doc.title);
    ok(res, { document: publicDoc(doc), model });
  }),
);

documentsRouter.put(
  '/:id',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    const model = req.body?.model;
    if (!model || typeof model !== 'object') throw bad('缺少 model 字段', 'NO_MODEL');
    const buffer = Buffer.from(JSON.stringify(model));
    if (buffer.length > config.maxJsonBytes) throw new HttpError(413, '文档内容过大', 'TOO_LARGE');
    const stored = blobs.writeBlob(`doc/${doc.id}.json`, buffer);
    const patch = { size: stored.size, blobKey: stored.key };
    if (typeof req.body?.title === 'string' && req.body.title.trim()) patch.title = truncate(req.body.title.trim(), 120);
    const updated = store.updateDocument(doc.id, patch);
    ok(res, { document: publicDoc(updated), savedAt: updated.updated_at });
  }),
);

documentsRouter.post(
  '/:id/rename',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    const title = truncate(String(req.body?.title || '').trim(), 120);
    if (!title) throw bad('标题不能为空', 'EMPTY_TITLE');
    ok(res, { document: publicDoc(store.updateDocument(doc.id, { title })) });
  }),
);

documentsRouter.post(
  '/:id/duplicate',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    const copy = store.createDocument({
      ...ownership(req),
      kind: doc.kind,
      title: `${doc.title} 副本`.slice(0, 120),
      source: 'copy',
      meta: doc.meta,
    });
    if (doc.blob_key && blobs.blobExists(doc.blob_key)) {
      const raw = blobs.readBlob(doc.blob_key);
      const ext = doc.kind === 'pdf' ? 'pdf' : 'json';
      const stored = blobs.writeBlob(`doc/${copy.id}.${ext}`, raw);
      store.updateDocument(copy.id, { blobKey: stored.key, size: stored.size });
    }
    ok(res, { document: publicDoc(store.getDocument(copy.id)) }, 201);
  }),
);

documentsRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    store.deleteDocument(doc.id);
    ok(res, { deleted: doc.id });
  }),
);

/* ------------------------------ export ------------------------------ */

documentsRouter.get(
  '/:id/raw',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    if (doc.kind !== 'pdf') throw bad('仅 PDF 提供原始流', 'BAD_KIND');
    const buffer = blobs.readBlob(doc.blob_key);
    sendBuffer(res, buffer, {
      mime: 'application/pdf',
      filename: `${slugify(doc.title, 'document')}.pdf`,
      cache: 'private, no-store',
    });
  }),
);

documentsRouter.post(
  '/:id/export',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    const format = String(req.body?.format || doc.kind);
    const model = req.body?.model;
    const filenameBase = slugify(req.body?.filename || doc.title, 'document');

    if (doc.kind === 'pdf') {
      let buffer = blobs.readBlob(doc.blob_key);
      const ops = req.body?.pdfOps;
      if (ops && typeof ops === 'object') buffer = await applyPdfOps(buffer, ops);
      return sendBuffer(res, buffer, { mime: 'application/pdf', filename: `${filenameBase}.pdf`, download: true });
    }

    if (!model) throw bad('缺少 model 字段', 'NO_MODEL');

    if (format === 'pdf') {
      const b64 = await renderPdf(doc.kind, model, doc.title);
      return sendBuffer(res, Buffer.from(b64, 'base64'), {
        mime: 'application/pdf',
        filename: `${filenameBase}.pdf`,
        download: true,
      });
    }

    if (doc.kind === 'docx') {
      if (format === 'txt') {
        const text = String(model.html || '').replace(/<[^>]+>/g, '');
        return sendBuffer(res, Buffer.from(text, 'utf8'), { mime: 'text/plain; charset=utf-8', filename: `${filenameBase}.txt`, download: true });
      }
      const { buffer } = await capability.docx.export({ html: model.html || '', title: doc.title });
      return sendBuffer(res, Buffer.from(buffer, 'base64'), {
        mime: blobs.mimeForExt('docx'),
        filename: `${filenameBase}.docx`,
        download: true,
      });
    }

    if (doc.kind === 'xlsx') {
      if (format === 'csv') {
        const { csv } = await capability.xlsx.csv({ model, sheetIndex: Number(req.body?.sheetIndex) || 0 });
        return sendBuffer(res, Buffer.from(`\uFEFF${csv}`, 'utf8'), {
          mime: 'text/csv; charset=utf-8',
          filename: `${filenameBase}.csv`,
          download: true,
        });
      }
      const { buffer } = await capability.xlsx.export({ model, title: doc.title });
      return sendBuffer(res, Buffer.from(buffer, 'base64'), {
        mime: blobs.mimeForExt('xlsx'),
        filename: `${filenameBase}.xlsx`,
        download: true,
      });
    }

    if (doc.kind === 'pptx') {
      const { buffer } = await capability.pptx.export({ model, title: doc.title });
      return sendBuffer(res, Buffer.from(buffer, 'base64'), {
        mime: blobs.mimeForExt('pptx'),
        filename: `${filenameBase}.pptx`,
        download: true,
      });
    }

    throw bad('不支持的导出格式', 'BAD_FORMAT');
  }),
);

/** 三种模型统一交给 PDF 能力服务排版。 */
async function renderPdf(kind, model, title) {
  if (kind === 'docx') {
    const { buffer } = await capability.pdf.fromHtml({ html: model.html || '', title });
    return buffer;
  }
  if (kind === 'xlsx') {
    const { buffer } = await capability.pdf.fromXlsx({ model, title });
    return buffer;
  }
  if (kind === 'pptx') {
    const { buffer } = await capability.pdf.fromPptx({ model, title });
    return buffer;
  }
  throw bad('该类型不支持转 PDF', 'BAD_KIND');
}

async function applyPdfOps(buffer, ops) {
  let current = buffer.toString('base64');
  if (ops.watermark?.text) {
    current = (await capability.pdf.watermark({ buffer: current, ...ops.watermark })).buffer;
  }
  if (Array.isArray(ops.mergeWith) && ops.mergeWith.length) {
    const extra = ops.mergeWith.map((key) => blobs.readBlob(key).toString('base64'));
    current = (await capability.pdf.merge({ buffers: [current, ...extra] })).buffer;
  }
  if (ops.extract) current = (await capability.pdf.extract({ buffer: current, pages: ops.extract })).buffer;
  if (ops.delete) current = (await capability.pdf.delete({ buffer: current, pages: ops.delete })).buffer;
  if (ops.rotate) {
    current = (await capability.pdf.rotate({ buffer: current, pages: ops.rotate.pages || 'all', angle: ops.rotate.angle || 90 })).buffer;
  }
  if (Array.isArray(ops.order) && ops.order.length) {
    current = (await capability.pdf.reorder({ buffer: current, order: ops.order })).buffer;
  }
  if (ops.metadata) current = (await capability.pdf.metadata({ buffer: current, ...ops.metadata })).buffer;
  return Buffer.from(current, 'base64');
}

documentsRouter.post(
  '/:id/pdf-ops',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    if (doc.kind !== 'pdf') throw bad('仅 PDF 支持该操作', 'BAD_KIND');
    const buffer = blobs.readBlob(doc.blob_key);
    const next = await applyPdfOps(buffer, req.body?.ops || {});
    const stored = blobs.writeBlob(`doc/${doc.id}.pdf`, next);
    store.updateDocument(doc.id, { blobKey: stored.key, size: stored.size });
    const { info } = await capability.pdf.info({ buffer: next.toString('base64') });
    ok(res, { info, size: stored.size });
  }),
);

/* --------------------------- AI 文档辅助 ---------------------------- */

documentsRouter.post(
  '/:id/outline',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    const theme = String(req.body?.theme || 'midnight');
    const outline = req.body?.outline;
    if (!outline || !Array.isArray(outline.slides)) throw bad('outline.slides 缺失', 'BAD_OUTLINE');
    const { model } = await capability.pptx.outline({ outline, theme });
    const stored = blobs.writeBlob(`doc/${doc.id}.json`, Buffer.from(JSON.stringify(model)));
    store.updateDocument(doc.id, {
      blobKey: stored.key,
      size: stored.size,
      title: truncate(outline.title || doc.title, 120),
    });
    ok(res, { model, document: publicDoc(store.getDocument(doc.id)) });
  }),
);

documentsRouter.get(
  '/:id/text',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    if (doc.kind === 'pdf') {
      const buffer = blobs.readBlob(doc.blob_key);
      const { text, pageCount } = await capability.pdf.text({ buffer: buffer.toString('base64') });
      return ok(res, { text: truncate(text, 20000), pageCount });
    }
    const model = safeJson(blobs.readBlob(doc.blob_key).toString('utf8'), null);
    if (doc.kind === 'xlsx') {
      const { csv } = await capability.xlsx.csv({ model, sheetIndex: Number(req.query.sheet) || 0 });
      return ok(res, { text: truncate(csv, 20000), pageCount: null });
    }
    if (doc.kind === 'pptx') {
      const { text, pageCount } = await capability.pptx.text({ model });
      return ok(res, { text: truncate(text, 20000), pageCount });
    }
    if (doc.kind === 'docx') {
      const text = String(model?.html || '').replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n').trim();
      return ok(res, { text: truncate(text, 20000), pageCount: null });
    }
    throw bad('该类型不支持文本提取', 'BAD_KIND');
  }),
);

documentsRouter.post(
  '/:id/bounds',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    if (doc.kind !== 'xlsx') throw bad('仅 XLSX 支持范围估算', 'BAD_KIND');
    const model = req.body?.model || safeJson(blobs.readBlob(doc.blob_key).toString('utf8'), null);
    const { bounds } = await capability.xlsx.bounds({ model, sheetIndex: Number(req.body?.sheetIndex) || 0 });
    ok(res, { bounds });
  }),
);
