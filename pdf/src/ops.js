/**
 * PDF 能力的全部操作。
 *
 * 三块职责：
 *   1. 页级操作：拆分/删除/合并/旋转/水印/重排/元数据
 *   2. 文字层：pdf.js 在 Node 里抽正文（pdf-lib 只能改结构，读不了文字）
 *   3. 排版：DOCX/XLSX/PPTX 模型 → PDF（topdf.js，纯 JS，不依赖 LibreOffice）
 */

import { HttpError } from '@office/shared/util';
import { decodeBuffer, encodeBuffer } from '@office/shared/service';
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
} from './convert/pdf.js';
import { pdfBufferToPlainText, pdfBufferToText } from './convert/pdftext.js';
import { htmlToPdfBuffer, pptxModelToPdfBuffer, xlsxModelToPdfBuffer } from './convert/topdf.js';
import { fontStatus } from './convert/fonts.js';

function requireBuffer(args) {
  return decodeBuffer(args.buffer);
}

export const ops = {
  /** PDF 元信息与页尺寸 */
  info: {
    meta: { input: 'buffer(base64)', output: 'pageCount,pages,fonts' },
    async handler({ buffer }) {
      return { info: await pdfInfo(requireBuffer({ buffer })) };
    },
  },

  /** 提取指定页为新 PDF */
  extract: {
    meta: { input: 'buffer,pages', output: 'buffer(base64),ext' },
    async handler({ buffer, pages = 'all' }) {
      const out = await extractPages(requireBuffer({ buffer }), String(pages));
      return encodeBuffer(out, 'pdf');
    },
  },

  /** 删除指定页 */
  delete: {
    meta: { input: 'buffer,pages', output: 'buffer(base64),ext' },
    async handler({ buffer, pages }) {
      if (!pages) throw new HttpError(400, '缺少 pages', 'BAD_PAGES');
      const out = await deletePages(requireBuffer({ buffer }), String(pages));
      return encodeBuffer(out, 'pdf');
    },
  },

  /** 多份 PDF 依序合并 */
  merge: {
    meta: { input: 'buffers[](base64)', output: 'buffer(base64),ext' },
    async handler({ buffers }) {
      if (!Array.isArray(buffers) || !buffers.length) throw new HttpError(400, 'buffers 为空', 'EMPTY_MERGE');
      const list = buffers.map((item, index) => decodeBuffer(item, `buffers[${index}]`));
      return encodeBuffer(await mergePdfs(list), 'pdf');
    },
  },

  /** 旋转指定页 */
  rotate: {
    meta: { input: 'buffer,pages,angle', output: 'buffer(base64),ext' },
    async handler({ buffer, pages = 'all', angle = 90 }) {
      const out = await rotatePages(requireBuffer({ buffer }), String(pages), Number(angle) || 90);
      return encodeBuffer(out, 'pdf');
    },
  },

  /** 平铺水印（中文字体可用时不会退化成 ASCII） */
  watermark: {
    meta: { input: 'buffer,text,opacity?,size?,color?', output: 'buffer(base64),ext' },
    async handler({ buffer, text = 'CONFIDENTIAL', opacity = 0.16, size = 42, color = '#94a3b8' }) {
      const out = await watermarkPdf(requireBuffer({ buffer }), { text: String(text), opacity, size, color });
      return encodeBuffer(out, 'pdf');
    },
  },

  /** 按给定顺序重排全部页面 */
  reorder: {
    meta: { input: 'buffer,order[]', output: 'buffer(base64),ext' },
    async handler({ buffer, order }) {
      if (!Array.isArray(order)) throw new HttpError(400, '缺少 order 数组', 'BAD_ORDER');
      return encodeBuffer(await reorderPdf(requireBuffer({ buffer }), order), 'pdf');
    },
  },

  /** 新建空白/带标题的 PDF */
  create: {
    meta: { input: 'title?,pages?,width?,height?', output: 'buffer(base64),ext' },
    async handler({ title = '', pages = 1, width, height }) {
      const out = await createPdf({ title: String(title), pages: Number(pages) || 1, width, height });
      return encodeBuffer(out, 'pdf');
    },
  },

  /** 写入文档元数据 */
  metadata: {
    meta: { input: 'buffer,title?,author?,subject?,keywords?', output: 'buffer(base64),ext' },
    async handler({ buffer, ...meta }) {
      return encodeBuffer(await setMetadata(requireBuffer({ buffer }), meta), 'pdf');
    },
  },

  /** 文字层提取（结构化，按页） */
  text: {
    meta: { input: 'buffer,maxPages?', output: 'text,pageCount,pages' },
    async handler({ buffer, maxPages }) {
      const { text, pageCount } = await pdfBufferToPlainText(requireBuffer({ buffer }), {
        maxPages: Number(maxPages) || undefined,
      });
      return { text, pageCount };
    },
  },

  /** 文字层提取（逐页切分，供预览/定位） */
  pages: {
    meta: { input: 'buffer,maxPages?', output: 'pages[]' },
    async handler({ buffer, maxPages }) {
      return pdfBufferToText(requireBuffer({ buffer }), { maxPages: Number(maxPages) || undefined });
    },
  },

  /** DOCX 的 HTML 模型 → PDF */
  fromHtml: {
    meta: { input: 'html,title?', output: 'buffer(base64),ext' },
    async handler({ html = '', title = '' }) {
      if (typeof html !== 'string') throw new HttpError(400, 'html 必须是字符串', 'BAD_HTML');
      return encodeBuffer(await htmlToPdfBuffer(html, { title: String(title) }), 'pdf');
    },
  },

  /** XLSX 工作表模型 → PDF */
  fromXlsx: {
    meta: { input: 'model,title?', output: 'buffer(base64),ext' },
    async handler({ model, title = '' }) {
      if (!model || typeof model !== 'object') throw new HttpError(400, '缺少 model', 'NO_MODEL');
      return encodeBuffer(await xlsxModelToPdfBuffer(model, { title: String(title) }), 'pdf');
    },
  },

  /** PPTX 幻灯片模型 → PDF */
  fromPptx: {
    meta: { input: 'model,title?', output: 'buffer(base64),ext' },
    async handler({ model, title = '' }) {
      if (!model || typeof model !== 'object') throw new HttpError(400, '缺少 model', 'NO_MODEL');
      return encodeBuffer(await pptxModelToPdfBuffer(model, { title: String(title) }), 'pdf');
    },
  },

  /** 字体探测结果（诊断用） */
  fonts: {
    meta: { input: '(none)', output: 'available,path,flavor' },
    async handler() {
      return fontStatus();
    },
  },
};

export default ops;
