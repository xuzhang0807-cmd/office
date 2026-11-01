import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { childrenOf, inlineRuns, mergeRuns, parseHtml, textContent } from './html.js';
import { asciiSafe, embedCjkFont } from './fonts.js';

/**
 * 纯 JS 的「导出 PDF」排版引擎。
 *
 * 为什么不挂 LibreOffice：官方镜像 + CJK 字体接近 1GB，冷启动十几秒，而我们
 * 只需要「把结构化内容排成 PDF」这一件事。这里直接复用 docx/xlsx/pptx 的模型，
 * 用 pdf-lib 自己排版，产物是矢量文字（可选中、可搜索），不是截图。
 *
 * 已知取舍：不处理分栏、脚注、浮动图片与自动目录；表格不做跨页表头重复。
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const BODY_SIZE = 11;
const LINE_RATIO = 1.55;

const HEADING_SIZE = { h1: 20, h2: 16, h3: 14, h4: 12.5, h5: 11.5, h6: 11.5 };
const INK = rgb(0.09, 0.12, 0.19);
const MUTED = rgb(0.42, 0.47, 0.56);
const RULE = rgb(0.8, 0.84, 0.9);
const HEADER_FILL = rgb(0.94, 0.96, 0.98);

/**
 * 字体缺字兜底表。
 * wqy-zenhei 的子集里没有 U+2022(•) / U+25AA(▪) / U+25E6(◦) 这些西文项目符号，
 * 直接画会变成豆腐块。统一换成中文字体里确实存在的「·」(U+00B7)。
 */
const GLYPH_SUBSTITUTES = { '\u2022': '\u00b7 ', '\u25aa': '\u00b7 ', '\u25e6': '\u00b7 ', '\u2023': '\u00b7 ', '\u2043': '\u00b7 ' };

/** 字体上下文：有 CJK 字体就嵌入，没有就退化 ASCII，绝不抛错。 */
async function makeFonts(doc) {
  const cjk = await embedCjkFont(doc);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = cjk || helvetica;
  return {
    body,
    bold: cjk || helveticaBold,
    cjk: Boolean(cjk),
    fallback: helvetica,
    encode(text) {
      const raw = String(text ?? '');
      if (!cjk) return asciiSafe(raw);
      return raw.replace(/[\u2022\u25aa\u25e6\u2023\u2043]/g, (ch) => GLYPH_SUBSTITUTES[ch] || ch);
    },
  };
}

/** 逐字符/逐词测量换行，中文按字断，英文按词断。 */function wrapText(text, font, size, maxWidth) {
  const source = String(text ?? '').replace(/\t/g, '    ');
  if (!source) return [''];
  const lines = [];
  for (const paragraph of source.split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    const tokens = paragraph.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]|[^\s\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]+\s*|\s+/g) || [paragraph];
    for (const token of tokens) {
      const candidate = line + token;
      let width = 0;
      try {
        width = font.widthOfTextAtSize(candidate, size);
      } catch {
        width = candidate.length * size * 0.6;
      }
      if (width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line.trimEnd());
        line = token.trimStart();
      }
    }
    if (line) lines.push(line.trimEnd());
  }
  return lines.length ? lines : [''];
}

function measure(text, font, size) {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return String(text).length * size * 0.6;
  }
}

/** 页面游标：统一处理换页，避免每个块各自算 y。 */
class Cursor {
  constructor(pdf, fonts, size = A4, margin = MARGIN) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.size = size;
    this.margin = margin;
    this.page = null;
    this.y = 0;
    this.newPage();
  }

  get usableWidth() {
    return this.size.width - this.margin * 2;
  }

  newPage() {
    this.page = this.pdf.addPage([this.size.width, this.size.height]);
    this.y = this.size.height - this.margin;
    return this.page;
  }

  ensure(height) {
    if (this.y - height < this.margin) this.newPage();
  }

  draw(text, { font, size, color = INK, x = this.margin, maxWidth = this.usableWidth, lineRatio = LINE_RATIO } = {}) {
    const useFont = font || this.fonts.body;
    const useSize = size || BODY_SIZE;
    const lines = wrapText(this.fonts.encode(text), useFont, useSize, maxWidth);
    const lineHeight = useSize * lineRatio;
    for (const line of lines) {
      this.ensure(lineHeight);
      if (line) {
        this.page.drawText(line, { x, y: this.y - useSize, size: useSize, font: useFont, color });
      }
      this.y -= lineHeight;
    }
    return lines.length;
  }

  space(height) {
    this.ensure(height);
    this.y -= height;
  }

  rule() {
    this.ensure(12);
    this.y -= 6;
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.size.width - this.margin, y: this.y },
      thickness: 0.8,
      color: RULE,
    });
    this.y -= 8;
  }
}

/* ------------------------------ DOCX ------------------------------ */

function blocksOf(node, out = []) {
  for (const child of node.children || []) {
    if (child.tag === '#text') {
      const text = child.text.replace(/\s+/g, ' ').trim();
      if (text) out.push({ type: 'p', node: child, text });
      continue;
    }
    if (HEADING_SIZE[child.tag]) {
      out.push({ type: 'h', level: child.tag, text: textContent(child) });
      continue;
    }
    if (child.tag === 'p' || child.tag === 'div' || child.tag === 'blockquote' || child.tag === 'figcaption') {
      out.push({ type: 'p', node: child, text: textContent(child) });
      continue;
    }
    if (child.tag === 'ul' || child.tag === 'ol') {
      childrenOf(child, 'li').forEach((li, index) => {
        out.push({
          type: 'li',
          ordered: child.tag === 'ol',
          index: index + 1,
          runs: mergeRuns(inlineRuns(li)),
          text: textContent(li),
        });
      });
      continue;
    }
    if (child.tag === 'pre') {
      out.push({ type: 'code', text: textContent(child) });
      continue;
    }
    if (child.tag === 'table') {
      out.push({ type: 'table', node: child });
      continue;
    }
    if (child.tag === 'img') {
      out.push({ type: 'img', src: child.attrs?.src });
      continue;
    }
    if (child.tag === 'hr') {
      out.push({ type: 'hr' });
      continue;
    }
    blocksOf(child, out);
  }
  return out;
}

function tableRows(node) {
  const rows = [];
  const collect = (current) => {
    for (const child of current.children || []) {
      if (child.tag === 'tr') {
        const cells = (child.children || []).filter((c) => c.tag === 'td' || c.tag === 'th');
        rows.push({ header: cells.some((c) => c.tag === 'th'), cells: cells.map((c) => textContent(c).trim()) });
      } else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
        collect(child);
      }
    }
  };
  collect(node);
  return rows;
}

async function drawTable(cursor, rows) {
  if (!rows.length) return;
  const columns = Math.max(...rows.map((r) => r.cells.length));
  if (!columns) return;
  const width = cursor.usableWidth;
  const colWidth = width / columns;
  const pad = 5;
  const size = 9.5;

  for (const row of rows) {
    // 先算这一行需要多高
    const wrapped = row.cells.map((cell) => wrapText(cursor.fonts.encode(cell), cursor.fonts.body, size, colWidth - pad * 2));
    const lines = Math.max(1, ...wrapped.map((w) => w.length));
    const rowHeight = lines * size * 1.35 + pad * 2;
    cursor.ensure(rowHeight);
    const top = cursor.y;
    if (row.header) {
      cursor.page.drawRectangle({
        x: cursor.margin,
        y: top - rowHeight,
        width,
        height: rowHeight,
        color: HEADER_FILL,
      });
    }
    for (let c = 0; c < columns; c += 1) {
      const cellLines = wrapped[c] || [''];
      let lineY = top - pad - size;
      for (const line of cellLines) {
        if (line) {
          cursor.page.drawText(line, {
            x: cursor.margin + c * colWidth + pad,
            y: lineY,
            size,
            font: row.header ? cursor.fonts.bold : cursor.fonts.body,
            color: INK,
          });
        }
        lineY -= size * 1.35;
      }
    }
    // 网格线
    cursor.page.drawRectangle({
      x: cursor.margin,
      y: top - rowHeight,
      width,
      height: rowHeight,
      borderColor: RULE,
      borderWidth: 0.6,
    });
    for (let c = 1; c < columns; c += 1) {
      const x = cursor.margin + c * colWidth;
      cursor.page.drawLine({
        start: { x, y: top },
        end: { x, y: top - rowHeight },
        thickness: 0.6,
        color: RULE,
      });
    }
    cursor.y = top - rowHeight;
  }
  cursor.space(8);
}

function dataUrlImage(src) {
  const match = /^data:(image\/(png|jpe?g));base64,(.+)$/i.exec(src || '');
  if (!match) return null;
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[3], 'base64') };
}

async function drawImage(pdf, cursor, src) {
  const data = dataUrlImage(src);
  if (!data) return;
  try {
    const image = data.mime === 'image/png' ? await pdf.embedPng(data.buffer) : await pdf.embedJpg(data.buffer);
    const maxWidth = cursor.usableWidth;
    const scale = Math.min(1, maxWidth / image.width);
    const width = image.width * scale;
    const height = image.height * scale;
    cursor.ensure(height + 8);
    cursor.page.drawImage(image, { x: cursor.margin, y: cursor.y - height, width, height });
    cursor.y -= height + 8;
  } catch {
    /* 坏图跳过，不影响整篇导出 */
  }
}

export async function htmlToPdfBuffer(html, { title = '' } = {}) {
  const pdf = await PDFDocument.create();
  const fonts = await makeFonts(pdf);
  const cursor = new Cursor(pdf, fonts);
  const blocks = blocksOf(parseHtml(html || ''));

  for (const block of blocks) {
    if (block.type === 'h') {
      cursor.space(8);
      cursor.draw(block.text, { font: fonts.bold, size: HEADING_SIZE[block.level], lineRatio: 1.35 });
      if (block.level === 'h1' || block.level === 'h2') cursor.rule();
      else cursor.space(2);
      continue;
    }
    if (block.type === 'p') {
      if (block.node && block.node.tag === 'blockquote') {
        cursor.draw(`「${block.text}」`, { color: MUTED });
      } else {
        cursor.draw(block.text);
      }
      cursor.space(4);
      continue;
    }
    if (block.type === 'li') {
      // 不用 "•" 字形：wqy-zenhei 的子集里没有 U+2022，会渲染成豆腐块。
      // 直接画一个实心圆点，跟字体无关，任何环境都一致。
      const indent = block.ordered ? measure(`${block.index}. `, fonts.body, BODY_SIZE) : BODY_SIZE * 0.9;
      cursor.ensure(BODY_SIZE * LINE_RATIO);
      const startY = cursor.y;
      if (block.ordered) {
        cursor.page.drawText(fonts.encode(`${block.index}.`), {
          x: cursor.margin + 6,
          y: startY - BODY_SIZE,
          size: BODY_SIZE,
          font: fonts.body,
          color: INK,
        });
      } else {
        const r = 1.8;
        cursor.page.drawCircle({
          x: cursor.margin + 6 + BODY_SIZE * 0.28,
          y: startY - BODY_SIZE * 0.62,
          size: r,
          color: INK,
        });
      }
      cursor.draw(block.text, { x: cursor.margin + 6 + indent, maxWidth: cursor.usableWidth - 6 - indent });
      continue;
    }
    if (block.type === 'code') {
      cursor.ensure(20);
      for (const line of String(block.text).split('\n')) {
        cursor.draw(line, { size: 9, lineRatio: 1.4, color: MUTED });
      }
      cursor.space(6);
      continue;
    }
    if (block.type === 'table') {
      await drawTable(cursor, tableRows(block.node));
      continue;
    }
    if (block.type === 'img') {
      await drawImage(pdf, cursor, block.src);
      continue;
    }
    if (block.type === 'hr') {
      cursor.rule();
    }
  }

  if (title && fonts.cjk) pdf.setTitle(title);
  pdf.setProducer('Office Portal');
  return Buffer.from(await pdf.save());
}

/* ------------------------------ XLSX ------------------------------ */

function cellText(cell) {
  if (!cell) return '';
  if (cell.f && (cell.v === undefined || cell.v === null || cell.v === '')) return cell.f;
  return cell.v === undefined || cell.v === null ? '' : String(cell.v);
}

/** 依据底色亮度选文字颜色，避免深色表头上写深色字（看不见）。 */
function contrastInk(fill) {
  const hex = String(fill || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return INK;
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.55 ? rgb(0.97, 0.98, 1) : INK;
}

export async function xlsxModelToPdfBuffer(model, { title = '' } = {}) {
  const pdf = await PDFDocument.create();
  const fonts = await makeFonts(pdf);
  const cursor = new Cursor(pdf, fonts);
  const sheets = Array.isArray(model?.sheets) && model.sheets.length ? model.sheets : [{ name: 'Sheet1', rows: [] }];

  for (const [sheetIndex, sheet] of sheets.entries()) {
    if (sheetIndex > 0) cursor.newPage();
    cursor.draw(sheet.name || `Sheet${sheetIndex + 1}`, { font: fonts.bold, size: 14, lineRatio: 1.3 });
    cursor.space(6);

    const rows = (sheet.rows || []).filter((row) => Array.isArray(row) && row.some((c) => cellText(c) !== ''));
    if (!rows.length) {
      cursor.draw('（空工作表）', { color: MUTED });
      continue;
    }
    const columns = Math.max(...rows.map((r) => r.length));
    const widths = Array.from({ length: columns }, (_, c) => {
      const declared = Number(sheet.colWidths?.[c]);
      return Number.isFinite(declared) && declared > 20 ? declared : 96;
    });
    const totalWidth = widths.reduce((a, b) => a + b, 0);
    const scale = Math.min(1, cursor.usableWidth / totalWidth);
    const colWidths = widths.map((w) => w * scale);
    const size = 9;
    const pad = 4;

    for (const [rowIndex, row] of rows.entries()) {
      const cells = Array.from({ length: columns }, (_, c) => row[c]);
      const wrapped = cells.map((cell, c) =>
        wrapText(fonts.encode(cellText(cell)), cell?.s?.bold ? fonts.bold : fonts.body, size, colWidths[c] - pad * 2),
      );
      const lines = Math.max(1, ...wrapped.map((w) => w.length));
      const rowHeight = lines * size * 1.3 + pad * 2;
      cursor.ensure(rowHeight);
      const top = cursor.y;
      let x = cursor.margin;
      for (let c = 0; c < columns; c += 1) {
        const cell = cells[c];
        if (cell?.s?.fill) {
          const hex = String(cell.s.fill).replace('#', '');
          if (/^[0-9a-f]{6}$/i.test(hex)) {
            cursor.page.drawRectangle({
              x,
              y: top - rowHeight,
              width: colWidths[c],
              height: rowHeight,
              color: rgb(
                Number.parseInt(hex.slice(0, 2), 16) / 255,
                Number.parseInt(hex.slice(2, 4), 16) / 255,
                Number.parseInt(hex.slice(4, 6), 16) / 255,
              ),
            });
          }
        }
        const useFont = cell?.s?.bold ? fonts.bold : fonts.body;
        const ink = cell?.s?.fill ? contrastInk(cell.s.fill) : INK;
        let lineY = top - pad - size;
        for (const line of wrapped[c]) {
          if (line) {
            cursor.page.drawText(line, { x: x + pad, y: lineY, size, font: useFont, color: ink });
          }
          lineY -= size * 1.3;
        }
        cursor.page.drawRectangle({
          x,
          y: top - rowHeight,
          width: colWidths[c],
          height: rowHeight,
          borderColor: RULE,
          borderWidth: 0.5,
        });
        x += colWidths[c];
      }
      cursor.y = top - rowHeight;
      if (rowIndex === 0 && rows.length > 1) {
        // 表头下加一条稍重的线，视觉上区分
        cursor.page.drawLine({
          start: { x: cursor.margin, y: cursor.y },
          end: { x: cursor.margin + colWidths.reduce((a, b) => a + b, 0), y: cursor.y },
          thickness: 0.8,
          color: MUTED,
        });
      }
    }
  }

  if (title && fonts.cjk) pdf.setTitle(title);
  pdf.setProducer('Office Portal');
  return Buffer.from(await pdf.save());
}

/* ------------------------------ PPTX ------------------------------ */

const SLIDE_PAGE = { width: 842, height: 473.6 }; // A4 横向，16:9 内容留边

function hexColor(value, fallback = 'FFFFFF') {
  const hex = String(value || fallback).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return rgb(1, 1, 1);
  return rgb(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  );
}

export async function pptxModelToPdfBuffer(model, { title = '' } = {}) {
  const pdf = await PDFDocument.create();
  const fonts = await makeFonts(pdf);
  const slides = Array.isArray(model?.slides) && model.slides.length ? model.slides : [{ elements: [] }];
  const slideWidth = Number(model?.width) || 1280;
  const slideHeight = Number(model?.height) || 720;
  const pageWidth = SLIDE_PAGE.width;
  const pageHeight = SLIDE_PAGE.height;
  const scale = Math.min(pageWidth / slideWidth, pageHeight / slideHeight);
  const offsetX = (pageWidth - slideWidth * scale) / 2;
  const offsetY = (pageHeight - slideHeight * scale) / 2;

  for (const slide of slides) {
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: hexColor(slide.background, '0F172A') });

    for (const element of slide.elements || []) {
      const x = offsetX + (Number(element.x) || 0) * scale;
      const w = Math.max((Number(element.w) || 100) * scale, 4);
      const h = Math.max((Number(element.h) || 40) * scale, 4);
      const yTop = pageHeight - offsetY - (Number(element.y) || 0) * scale;
      const y = yTop - h;

      if (element.type === 'rect' || element.type === 'ellipse') {
        const color = hexColor(element.fill, '1E293B');
        if (element.type === 'ellipse') page.drawEllipse({ x: x + w / 2, y: y + h / 2, xScale: w / 2, yScale: h / 2, color });
        else page.drawRectangle({ x, y, width: w, height: h, color });
        continue;
      }
      if (element.type === 'image') {
        const data = dataUrlImage(element.src);
        if (!data) continue;
        try {
          const image = data.mime === 'image/png' ? await pdf.embedPng(data.buffer) : await pdf.embedJpg(data.buffer);
          page.drawImage(image, { x, y, width: w, height: h });
        } catch {
          /* 坏图跳过 */
        }
        continue;
      }
      if (element.type === 'table' && Array.isArray(element.rows)) {
        const columns = Math.max(1, ...element.rows.map((r) => (r || []).length));
        const cellW = w / columns;
        const cellH = h / Math.max(element.rows.length, 1);
        element.rows.forEach((row, r) => {
          (row || []).forEach((cell, c) => {
            const cx = x + c * cellW;
            const cy = yTop - (r + 1) * cellH;
            page.drawRectangle({ x: cx, y: cy, width: cellW, height: cellH, borderColor: hexColor('334155'), borderWidth: 0.6 });
            const size = Math.max(5, Math.min(9, cellH * 0.45));
            const lines = wrapText(fonts.encode(String(cell ?? '')), fonts.body, size, cellW - 4);
            let lineY = cy + cellH - size - 2;
            for (const line of lines.slice(0, 3)) {
              if (line) page.drawText(line, { x: cx + 2, y: lineY, size, font: fonts.body, color: hexColor('E2E8F0') });
              lineY -= size * 1.25;
            }
          });
        });
        continue;
      }
      if (element.type === 'text') {
        const size = Math.max(5, (Number(element.size) || 18) * scale);
        const color = hexColor(element.color, 'F8FAFC');
        const font = element.bold ? fonts.bold : fonts.body;
        const align = element.align || 'left';
        const lines = wrapText(fonts.encode(element.text), font, size, w);
        let lineY = yTop - size;
        for (const line of lines) {
          if (lineY < y - size * 0.5) break; // 超出文本框就截断，和 PPT 的溢出行为一致
          let lineX = x;
          if (align === 'center') lineX = x + (w - measure(line, font, size)) / 2;
          else if (align === 'right') lineX = x + w - measure(line, font, size);
          if (line) page.drawText(line, { x: Math.max(lineX, 0), y: lineY, size, font, color });
          lineY -= size * 1.3;
        }
      }
    }

    // 页码
    page.drawText(String(slides.indexOf(slide) + 1), {
      x: pageWidth / 2,
      y: 10,
      size: 7,
      font: fonts.fallback,
      color: rgb(0.6, 0.65, 0.72),
    });
  }

  if (title && fonts.cjk) pdf.setTitle(title);
  pdf.setProducer('Office Portal');
  return Buffer.from(await pdf.save());
}

export { A4, MARGIN, wrapText, makeFonts };
