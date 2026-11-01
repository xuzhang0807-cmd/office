import { Router } from 'express';
import { config } from '../config.js';
import * as store from '../db.js';
import * as blobs from '../blobs.js';
import { asyncRoute, multipart, ok, sendBuffer } from '../http.js';
import { HttpError, bad, notFound, safeJson, slugify, truncate } from '../util.js';
import { docxBufferToHtml, docxBufferToText, htmlToDocxBuffer } from '../convert/docx.js';
import { modelBounds, modelToCsv, modelToXlsxBuffer, xlsxBufferToModel } from '../convert/xlsx.js';
import { blankModel, modelToPptxBuffer, outlineToModel, pptxBufferToModel } from '../convert/pptx.js';
import { htmlToPdfBuffer, pptxModelToPdfBuffer, xlsxModelToPdfBuffer } from '../convert/topdf.js';
import {
  createPdf,
  deletePages,
  extractPages,
  mergePdfs,
  pdfInfo,
  reorderPdf,
  rotatePages,
  setMetadata,
  watermarkPdf,
} from '../convert/pdf.js';

export const documentsRouter = Router();

const KINDS = new Set(['docx', 'xlsx', 'pptx', 'pdf']);

function ownership(req) {
  return req.user ? { ownerId: req.user.id } : { guestKey: req.guestKey };
}

function canAccess(doc, req) {
  if (!doc) return false;
  if (req.user) return doc.owner_id === req.user.id || doc.owner_id === null && doc.guest_key === null;
  return !doc.owner_id && doc.guest_key === req.guestKey;
}

function loadDoc(req) {
  const doc = store.getDocument(req.params.id);
  if (!doc) throw notFound('文档不存在或已删除');
  if (!canAccess(doc, req)) throw new HttpError(403, '无权访问该文档', 'FORBIDDEN');
  return doc;
}

function blankDocModel(kind, title) {
  if (kind === 'docx') return { version: 1, html: `<h1>${title}</h1><p></p>` };
  if (kind === 'xlsx') {
    return {
      version: 1,
      sheets: [{ name: 'Sheet1', rows: [], merges: [], colWidths: [] }],
      activeSheet: 0,
    };
  }
  if (kind === 'pptx') return blankModel('midnight');
  return { version: 1, info: { pageCount: 1 } };
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

documentsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const kind = String(req.body?.kind || 'docx');
    if (!KINDS.has(kind)) throw bad('不支持的文档类型', 'BAD_KIND');
    const title = truncate(String(req.body?.title || defaultTitle(kind)), 120);
    const templateSlug = req.body?.template ? String(req.body.template) : '';
    let model;
    let source = 'local';
    if (templateSlug) {
      const tpl = store.getTemplate(templateSlug);
      if (!tpl) throw notFound('模板不存在');
      if (tpl.kind !== kind) throw bad('模板类型与文档类型不一致', 'KIND_MISMATCH');
      const buffer = blobs.readBlob(tpl.blob_key);
      model = await importBuffer(kind, buffer);
      source = `template:${tpl.slug}`;
      store.bumpTemplateDownload(tpl.id);
    } else {
      model = blankDocModel(kind, title);
    }
    const doc = store.createDocument({
      ...ownership(req),
      kind,
      title,
      source,
      meta: { model: kind === 'pdf' ? model : undefined },
      size: 0,
    });
    if (kind === 'pdf') {
      const buffer = await createPdf({ title });
      const stored = blobs.writeBlob(`doc/${doc.id}.pdf`, buffer);
      store.updateDocument(doc.id, { blobKey: stored.key, size: stored.size });
    } else {
      const stored = blobs.writeBlob(`doc/${doc.id}.json`, Buffer.from(JSON.stringify(model)));
      store.updateDocument(doc.id, { blobKey: stored.key, size: stored.size });
    }
    ok(res, { document: publicDoc(store.getDocument(doc.id)) }, 201);
  }),
);

function defaultTitle(kind) {
  const map = { docx: '新建文档', xlsx: '新建表格', pptx: '新建演示文稿', pdf: '新建 PDF' };
  return `${map[kind] || '新建文件'} ${new Date().toISOString().slice(5, 10)}`;
}

async function importBuffer(kind, buffer) {
  if (kind === 'docx') {
    const { html } = await docxBufferToHtml(buffer);
    return { version: 1, html };
  }
  if (kind === 'xlsx') return xlsxBufferToModel(buffer);
  if (kind === 'pptx') return pptxBufferToModel(buffer);
  const info = await pdfInfo(buffer);
  return { version: 1, info };
}

documentsRouter.post(
  '/import',
  asyncRoute(async (req, res) => {
    const { files, fields } = await multipart(req, { maxFiles: 1 });
    const file = files[0];
    if (!file) throw bad('未收到文件', 'NO_FILE');
    const kind = detectKind(file.ext, file.buffer);
    if (!kind) throw bad('仅支持 .docx / .xlsx / .pptx / .pdf', 'BAD_KIND');
    const title = truncate(fields.title || file.filename.replace(/\.[^.]+$/, ''), 120);
    const model = await importBuffer(kind, file.buffer);
    const doc = store.createDocument({
      ...ownership(req),
      kind,
      title,
      source: 'upload',
      size: file.buffer.length,
      meta: kind === 'pdf' ? { info: model.info } : undefined,
    });
    const stored = kind === 'pdf'
      ? blobs.writeBlob(`doc/${doc.id}.pdf`, file.buffer)
      : blobs.writeBlob(`doc/${doc.id}.json`, Buffer.from(JSON.stringify(model)));
    store.updateDocument(doc.id, { blobKey: stored.key, size: stored.size });
    ok(res, { document: publicDoc(store.getDocument(doc.id)) }, 201);
  }),
);

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

documentsRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    if (doc.kind === 'pdf') {
      const buffer = blobs.readBlob(doc.blob_key);
      const info = await pdfInfo(buffer);
      return ok(res, { document: publicDoc(doc), model: { version: 1, info } });
    }
    let model = null;
    if (doc.blob_key) {
      const raw = blobs.readBlob(doc.blob_key);
      model = safeJson(raw.toString('utf8'), null);
    }
    if (!model) model = blankDocModel(doc.kind, doc.title);
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
    if (doc.kind === 'docx') {
      if (format === 'pdf') {
        const buffer = await htmlToPdfBuffer(model.html || '', { title: doc.title });
        return sendBuffer(res, buffer, { mime: 'application/pdf', filename: `${filenameBase}.pdf`, download: true });
      }
      if (format === 'txt') {
        const text = String(model.html || '').replace(/<[^>]+>/g, '');
        return sendBuffer(res, Buffer.from(text, 'utf8'), { mime: 'text/plain; charset=utf-8', filename: `${filenameBase}.txt`, download: true });
      }
      const buffer = await htmlToDocxBuffer(model.html || '', { title: doc.title });
      return sendBuffer(res, buffer, { mime: blobs.mimeForExt('docx'), filename: `${filenameBase}.docx`, download: true });
    }
    if (doc.kind === 'xlsx') {
      if (format === 'csv') {
        const csv = modelToCsv(model, Number(req.body?.sheetIndex) || 0);
        return sendBuffer(res, Buffer.from(`\uFEFF${csv}`, 'utf8'), { mime: 'text/csv; charset=utf-8', filename: `${filenameBase}.csv`, download: true });
      }
      if (format === 'pdf') {
        const buffer = await xlsxModelToPdfBuffer(model, { title: doc.title });
        return sendBuffer(res, buffer, { mime: 'application/pdf', filename: `${filenameBase}.pdf`, download: true });
      }
      const buffer = await modelToXlsxBuffer(model);
      return sendBuffer(res, buffer, { mime: blobs.mimeForExt('xlsx'), filename: `${filenameBase}.xlsx`, download: true });
    }
    if (doc.kind === 'pptx') {
      if (format === 'pdf') {
        const buffer = await pptxModelToPdfBuffer(model, { title: doc.title });
        return sendBuffer(res, buffer, { mime: 'application/pdf', filename: `${filenameBase}.pdf`, download: true });
      }
      const buffer = await modelToPptxBuffer(model, { title: doc.title });
      return sendBuffer(res, buffer, { mime: blobs.mimeForExt('pptx'), filename: `${filenameBase}.pptx`, download: true });
    }
    throw bad('不支持的导出格式', 'BAD_FORMAT');
  }),
);

async function applyPdfOps(buffer, ops) {
  let current = buffer;
  if (ops.watermark?.text) current = await watermarkPdf(current, ops.watermark);
  if (Array.isArray(ops.mergeWith) && ops.mergeWith.length) {
    const extra = ops.mergeWith.map((key) => blobs.readBlob(key));
    current = await mergePdfs([current, ...extra]);
  }
  if (ops.extract) current = await extractPages(current, ops.extract);
  if (ops.delete) current = await deletePages(current, ops.delete);
  if (ops.rotate) current = await rotatePages(current, ops.rotate.pages || 'all', ops.rotate.angle || 90);
  if (Array.isArray(ops.order) && ops.order.length) current = await reorderPdf(current, ops.order);
  if (ops.metadata) current = await setMetadata(current, ops.metadata);
  return current;
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
    const info = await pdfInfo(next);
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
    const model = outlineToModel(outline, theme);
    const stored = blobs.writeBlob(`doc/${doc.id}.json`, Buffer.from(JSON.stringify(model)));
    store.updateDocument(doc.id, { blobKey: stored.key, size: stored.size, title: truncate(outline.title || doc.title, 120) });
    ok(res, { model, document: publicDoc(store.getDocument(doc.id)) });
  }),
);

documentsRouter.get(
  '/:id/text',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    if (doc.kind !== 'docx') throw bad('仅 DOCX 提供纯文本提取', 'BAD_KIND');
    const model = safeJson(blobs.readBlob(doc.blob_key).toString('utf8'), { html: '' });
    const text = String(model.html || '').replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n').trim();
    ok(res, { text: truncate(text, 20000) });
  }),
);

documentsRouter.post(
  '/:id/bounds',
  asyncRoute(async (req, res) => {
    const doc = loadDoc(req);
    if (doc.kind !== 'xlsx') throw bad('仅 XLSX 支持范围估算', 'BAD_KIND');
    const model = req.body?.model || safeJson(blobs.readBlob(doc.blob_key).toString('utf8'), null);
    ok(res, { bounds: modelBounds(model, Number(req.body?.sheetIndex) || 0) });
  }),
);

export { detectKind, importBuffer, blankDocModel, docxBufferToText };
