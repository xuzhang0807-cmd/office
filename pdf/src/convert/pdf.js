import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { HttpError } from '@office/shared/util';
import { asciiSafe, embedCjkFont, fontStatus } from './fonts.js';

async function load(buffer) {
  try {
    return await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  } catch (error) {
    throw new HttpError(400, `PDF 解析失败：${error.message}`, 'BAD_PDF');
  }
}

/** 拿到可写中文的字体；没有系统字体时退回 Helvetica + ASCII 清洗。 */
async function textFont(doc, { bold = false } = {}) {
  const embedded = await embedCjkFont(doc, { bold });
  if (embedded) return { font: embedded, cjk: true };
  return { font: await doc.embedFont(StandardFonts.Helvetica), cjk: false };
}

export async function pdfInfo(buffer) {
  const doc = await load(buffer);
  const pages = doc.getPages();
  const first = pages[0];
  return {
    pageCount: pages.length,
    encrypted: doc.isEncrypted,
    width: first ? Math.round(first.getWidth()) : 0,
    height: first ? Math.round(first.getHeight()) : 0,
    title: doc.getTitle() || '',
    author: doc.getAuthor() || '',
    fonts: fontStatus(),
    pages: pages.map((page, index) => ({
      index,
      width: Math.round(page.getWidth()),
      height: Math.round(page.getHeight()),
      rotation: page.getRotation().angle,
    })),
  };
}

function parsePageList(spec, total) {
  if (!spec || spec === 'all') return Array.from({ length: total }, (_, i) => i);
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const piece = part.trim();
    if (!piece) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(piece);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let i = Math.min(start, end); i <= Math.max(start, end); i += 1) {
        if (i >= 1 && i <= total) out.add(i - 1);
      }
      continue;
    }
    const single = Number(piece);
    if (Number.isInteger(single) && single >= 1 && single <= total) out.add(single - 1);
  }
  if (!out.size) throw new HttpError(400, '页范围无效（示例：1-3,5）', 'BAD_PAGES');
  return [...out].sort((a, b) => a - b);
}

export async function extractPages(buffer, spec) {
  const source = await load(buffer);
  const indices = parsePageList(spec, source.getPageCount());
  const target = await PDFDocument.create();
  const copied = await target.copyPages(source, indices);
  copied.forEach((page) => target.addPage(page));
  return Buffer.from(await target.save());
}

export async function deletePages(buffer, spec) {
  const source = await load(buffer);
  const total = source.getPageCount();
  const remove = new Set(parsePageList(spec, total));
  if (remove.size >= total) throw new HttpError(400, '不能删除全部页面', 'BAD_PAGES');
  const keep = Array.from({ length: total }, (_, i) => i).filter((i) => !remove.has(i));
  const target = await PDFDocument.create();
  const copied = await target.copyPages(source, keep);
  copied.forEach((page) => target.addPage(page));
  return Buffer.from(await target.save());
}

export async function mergePdfs(buffers) {
  if (!buffers.length) throw new HttpError(400, '没有可合并的 PDF', 'EMPTY_MERGE');
  const target = await PDFDocument.create();
  for (const buffer of buffers) {
    const source = await load(buffer);
    const pages = await target.copyPages(source, source.getPageIndices());
    pages.forEach((page) => target.addPage(page));
  }
  return Buffer.from(await target.save());
}

export async function rotatePages(buffer, spec, angle) {
  const doc = await load(buffer);
  const total = doc.getPageCount();
  const targets = new Set(parsePageList(spec, total));
  const delta = (((Number(angle) || 0) % 360) + 360) % 360;
  doc.getPages().forEach((page, index) => {
    if (!targets.has(index)) return;
    page.setRotation(degrees((page.getRotation().angle + delta) % 360));
  });
  return Buffer.from(await doc.save());
}

export async function watermarkPdf(buffer, { text = 'CONFIDENTIAL', opacity = 0.16, size = 42, color = '#94a3b8' }) {
  const doc = await load(buffer);
  const { font, cjk } = await textFont(doc, { bold: true });
  const label = cjk ? String(text) : asciiSafe(text);
  const hex = String(color).replace('#', '');
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: Math.max((width - textWidth) / 2, 12),
      y: height / 2,
      size,
      font,
      color: rgb(r, g, b),
      opacity: Math.min(Math.max(Number(opacity) || 0.16, 0.02), 0.9),
      rotate: degrees(35),
    });
  }
  return Buffer.from(await doc.save());
}

export async function reorderPdf(buffer, order) {
  const source = await load(buffer);
  const total = source.getPageCount();
  const indices = (Array.isArray(order) ? order : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value < total);
  if (indices.length !== total) throw new HttpError(400, '页序必须包含全部页面', 'BAD_ORDER');
  const target = await PDFDocument.create();
  const copied = await target.copyPages(source, indices);
  copied.forEach((page) => target.addPage(page));
  return Buffer.from(await target.save());
}

/** 生成空白/带标题的 PDF，供“新建 PDF”入口使用。 */
export async function createPdf({ title = '', pages = 1, width = 595, height = 842 } = {}) {
  const doc = await PDFDocument.create();
  const { font, cjk } = await textFont(doc);
  const label = cjk ? String(title) : asciiSafe(title);
  for (let i = 0; i < Math.min(Math.max(Number(pages) || 1, 1), 50); i += 1) {
    const page = doc.addPage([width, height]);
    if (label && i === 0) {
      page.drawText(label, { x: 56, y: height - 88, size: 22, font, color: rgb(0.06, 0.09, 0.16) });
    }
  }
  doc.setTitle(cjk ? String(title || 'Untitled') : asciiSafe(title) || 'Untitled');
  doc.setProducer('Office Portal');
  return Buffer.from(await doc.save());
}

export async function setMetadata(buffer, { title, author, subject, keywords }) {
  const doc = await load(buffer);
  if (title !== undefined) doc.setTitle(String(title).slice(0, 200));
  if (author !== undefined) doc.setAuthor(String(author).slice(0, 200));
  if (subject !== undefined) doc.setSubject(String(subject).slice(0, 300));
  if (keywords !== undefined) doc.setKeywords(String(keywords).split(',').map((k) => k.trim()).filter(Boolean));
  return Buffer.from(await doc.save());
}

export { fontStatus };
