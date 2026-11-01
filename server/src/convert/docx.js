import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import mammoth from 'mammoth';
import { childrenOf, inlineRuns, mergeRuns, parseHtml, textContent } from './html.js';
import { decodeEntities } from '../util.js';

const HEADINGS = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3, h4: HeadingLevel.HEADING_4, h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6 };

const PT_TO_HALF_POINT = 2;

function dataUrlToBuffer(src) {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(src || '');
  if (!match) return null;
  return { buffer: Buffer.from(match[2], 'base64'), mime: match[1].toLowerCase() };
}

function runsFrom(node) {
  const runs = mergeRuns(inlineRuns(node));
  return runs.map((run) => {
    const text = run.text.replace(/\u00a0/g, ' ');
    return new TextRun({
      text,
      bold: run.bold || undefined,
      italics: run.italic || undefined,
      underline: run.underline ? {} : undefined,
      strike: run.strike || undefined,
      font: run.code ? 'Consolas' : undefined,
      size: run.size ? Math.round(run.size * PT_TO_HALF_POINT) : undefined,
      color: run.color || undefined,
    });
  });
}

function paragraphFrom(node, { list } = {}) {
  const tag = node.tag;
  const runs = runsFrom(node);
  if (!runs.length) return new Paragraph({ text: '' });
  return new Paragraph({
    children: runs,
    heading: HEADINGS[tag],
    bullet: list === 'ul' ? { level: 0 } : undefined,
    numbering: list === 'ol' ? { reference: 'ordered', level: 0 } : undefined,
    alignment: node.attrs?.style?.includes('text-align: center') ? AlignmentType.CENTER : undefined,
    spacing: { after: 120 },
  });
}

function tableFrom(node) {
  const rows = [];
  const collect = (current) => {
    for (const child of current.children || []) {
      if (child.tag === 'tr') rows.push(child);
      else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') collect(child);
    }
  };
  collect(node);
  if (!rows.length) return null;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row) =>
        new TableRow({
          children: childrenOf(row, 'td')
            .concat(childrenOf(row, 'th'))
            .map(
              (cell) =>
                new TableCell({
                  shading: cell.tag === 'th' ? { type: ShadingType.CLEAR, fill: 'F1F5F9' } : undefined,
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                  children: [
                    new Paragraph({
                      children: (mergeRuns(inlineRuns(cell)) || []).map(
                        (run) =>
                          new TextRun({
                            text: run.text.replace(/\u00a0/g, ' '),
                            bold: cell.tag === 'th' ? true : run.bold || undefined,
                            italics: run.italic || undefined,
                          }),
                      ),
                    }),
                  ],
                }),
            ),
        }),
    ),
  });
}

function blocksFrom(node, ctx) {
  const out = [];
  for (const child of node.children || []) {
    if (child.tag === '#text') {
      const text = child.text.replace(/\s+/g, ' ').trim();
      if (text) out.push(new Paragraph({ children: [new TextRun(text)] }));
      continue;
    }
    if (HEADINGS[child.tag] || child.tag === 'p' || child.tag === 'div' || child.tag === 'blockquote') {
      out.push(paragraphFrom(child));
      continue;
    }
    if (child.tag === 'ul' || child.tag === 'ol') {
      for (const li of childrenOf(child, 'li')) out.push(paragraphFrom(li, { list: child.tag }));
      continue;
    }
    if (child.tag === 'pre') {
      const text = textContent(child);
      for (const line of text.split('\n')) {
        out.push(
          new Paragraph({
            children: [new TextRun({ text: line, font: 'Consolas', size: 20 })],
            shading: { type: ShadingType.CLEAR, fill: 'F5F5F5' },
          }),
        );
      }
      continue;
    }
    if (child.tag === 'hr') {
      out.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' } },
          children: [new TextRun('')],
        }),
      );
      continue;
    }
    if (child.tag === 'table') {
      const table = tableFrom(child);
      if (table) out.push(table);
      continue;
    }
    if (child.tag === 'img') {
      const data = dataUrlToBuffer(child.attrs?.src);
      if (data) {
        out.push(
          new Paragraph({
            children: [
              new ImageRun({
                type: data.mime.includes('png') ? 'png' : data.mime.includes('gif') ? 'gif' : 'jpg',
                data: data.buffer,
                transformation: { width: 480, height: 270 },
              }),
            ],
          }),
        );
      }
      continue;
    }
    if (child.tag === 'figure') {
      out.push(...blocksFrom(child, ctx));
      continue;
    }
    out.push(...blocksFrom(child, ctx));
  }
  return out;
}

export function htmlToDocxBuffer(html, { title = '文档' } = {}) {
  const root = parseHtml(html);
  const body = blocksFrom(root, {});
  if (!body.length) body.push(new Paragraph({ text: '' }));
  const doc = new Document({
    creator: 'Office Portal',
    title,
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** docx → HTML：mammoth 保结构，随后补齐编辑器需要的语义标签。 */
export async function docxBufferToHtml(buffer) {
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
        "p[style-name='标题 1'] => h1:fresh",
        "p[style-name='标题 2'] => h2:fresh",
        "p[style-name='标题 3'] => h3:fresh",
      ],
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.read('base64');
        return { src: `data:${image.contentType};base64,${base64}` };
      }),
    },
  );
  const html = decodeEntities(result.value || '')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<table>/g, '<table class="doc-table">');
  return { html: html || '<p></p>', messages: result.messages?.map((m) => m.message) || [] };
}

/** 提取纯文本用于搜索与 AI 摘要，避免把整份 HTML 塞进提示词。 */
export async function docxBufferToText(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

export { textContent };
