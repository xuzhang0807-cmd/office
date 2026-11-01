import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import PptxGenJS from 'pptxgenjs';
import { decodeEntities, uid } from '../util.js';

const EMU_PER_INCH = 914400;
const px = (emu) => Math.round((Number(emu) || 0) / EMU_PER_INCH * 96);

const THEMES = {
  midnight: { bg: '0F172A', title: 'F8FAFC', body: 'CBD5E1', accent: '38BDF8' },
  paper: { bg: 'FFFFFF', title: '0F172A', body: '334155', accent: '2563EB' },
  sunset: { bg: '1E1B4B', title: 'FDE68A', body: 'E0E7FF', accent: 'F472B6' },
  forest: { bg: '052E2B', title: 'ECFDF5', body: 'A7F3D0', accent: '34D399' },
};

export function themeOf(name) {
  return THEMES[name] || THEMES.midnight;
}

/* --------------------------- pptx → model --------------------------- */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['p:sp', 'p:pic', 'p:graphicFrame', 'a:p', 'a:r', 'a:tbl', 'p:txBody'].includes(name),
});

const asArray = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

function collectText(txBody) {
  const paragraphs = [];
  for (const body of asArray(txBody)) {
    for (const p of asArray(body['a:p'])) {
      const runs = asArray(p['a:r']).map((r) => String(r['a:t'] ?? ''));
      const text = runs.join('') || String(p['a:t'] ?? '');
      paragraphs.push({ text, level: Number(p['a:pPr']?.['@_lvl'] ?? 0) });
    }
  }
  return paragraphs;
}

function shapeGeometry(sp) {
  const xfrm = sp['p:spPr']?.['a:xfrm'];
  const off = xfrm?.['a:off'] || {};
  const ext = xfrm?.['a:ext'] || {};
  return {
    x: px(off['@_x']),
    y: px(off['@_y']),
    w: px(ext['@_cx']),
    h: px(ext['@_cy']),
  };
}

function fillColorOf(sp) {
  const solid = sp['p:spPr']?.['a:solidFill'];
  const srgb = solid?.['a:srgbClr']?.['@_val'];
  return srgb ? `#${srgb}` : undefined;
}

export async function pptxBufferToModel(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presentationXml) throw new Error('不是有效的 PPTX 文件（缺少 presentation.xml）');
  const presentation = parser.parse(presentationXml)['p:presentation'] || {};
  const sldSz = presentation['p:sldSz'] || {};
  const width = px(sldSz['@_cx'] || 12192000);
  const height = px(sldSz['@_cy'] || 6858000);

  const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  const rels = parser.parse(relsXml || '<Relationships/>')['Relationships']?.['Relationship'] || [];
  const relMap = new Map(asArray(rels).map((rel) => [rel['@_Id'], rel['@_Target']]));

  const slideEntries = [];
  for (const id of asArray(presentation['p:sldIdLst']?.['p:sldId'])) {
    const rid = id['@_r:id'];
    const target = relMap.get(rid);
    if (target) slideEntries.push(target.replace(/^\.\.\//, '').replace(/^\/?ppt\//, ''));
  }
  if (!slideEntries.length) {
    slideEntries.push(
      ...Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
        .map((name) => name.replace(/^ppt\//, '')),
    );
  }

  const slides = [];
  for (const [index, entry] of slideEntries.slice(0, 200).entries()) {
    const xml = await zip.file(`ppt/${entry}`)?.async('string');
    if (!xml) continue;
    const tree = parser.parse(xml)['p:sld'] || {};
    const spTree = tree['p:cSld']?.['p:spTree'] || {};
    const elements = [];
    for (const sp of asArray(spTree['p:sp'])) {
      const geometry = shapeGeometry(sp);
      const paragraphs = collectText(sp['p:txBody']);
      const placeholder = sp['p:nvSpPr']?.['p:nvPr']?.['p:ph']?.['@_type'];
      const fill = fillColorOf(sp);
      if (!paragraphs.length && !fill) continue;
      const text = paragraphs.map((p) => p.text).join('\n');
      const isTitle = placeholder === 'title' || placeholder === 'ctrTitle' || /title/i.test(sp['p:nvSpPr']?.['p:cNvPr']?.['@_name'] || '');
      if (fill && !text) {
        elements.push({ id: uid('el_'), type: 'rect', ...geometry, fill, radius: 0 });
        continue;
      }
      elements.push({
        id: uid('el_'),
        type: 'text',
        ...geometry,
        text,
        role: isTitle ? 'title' : 'body',
        size: isTitle ? Math.max(20, Math.min(54, Math.round((geometry.h || 60) / 1.6))) : 18,
        color: isTitle ? '#F8FAFC' : '#E2E8F0',
        align: 'left',
        bold: Boolean(isTitle),
      });
    }
    for (const frame of asArray(spTree['p:graphicFrame'])) {
      const table = frame['a:graphic']?.['a:graphicData']?.['a:tbl'];
      if (!table) continue;
      const rows = asArray(table['a:tr']).map((tr) =>
        asArray(tr['a:tc']).map((tc) => collectText(tc['p:txBody']).map((p) => p.text).join('\n')),
      );
      const xfrm = frame['p:xfrm'];
      elements.push({
        id: uid('el_'),
        type: 'table',
        x: px(xfrm?.['a:off']?.['@_x']),
        y: px(xfrm?.['a:off']?.['@_y']),
        w: px(xfrm?.['a:ext']?.['@_cx']),
        h: px(xfrm?.['a:ext']?.['@_cy']),
        rows,
      });
    }
    for (const pic of asArray(spTree['p:pic'])) {
      const blip = pic['p:blipFill']?.['a:blip']?.['@_r:embed'];
      if (!blip) continue;
      const geometry = shapeGeometry(pic);
      elements.push({ id: uid('el_'), type: 'image', ...geometry, src: '', relId: blip });
    }
    slides.push({
      id: uid('sl_'),
      index,
      elements,
      background: '#0F172A',
      notes: '',
    });
  }

  if (!slides.length) {
    slides.push({ id: uid('sl_'), index: 0, elements: [], background: '#0F172A', notes: '' });
  }
  return { version: 1, width, height, theme: 'midnight', slides, imported: true };
}

/* --------------------------- model → pptx --------------------------- */

const hex = (color, fallback = 'FFFFFF') => `#${String(color || fallback).replace('#', '').slice(0, 6)}`;

export async function modelToPptxBuffer(model, { title = '演示文稿' } = {}) {
  const pptx = new PptxGenJS();
  const width = model?.width || 1280;
  const height = model?.height || 720;
  pptx.defineLayout({ name: 'OFFICE_16_9', width: width / 96, height: height / 96 });
  pptx.layout = 'OFFICE_16_9';
  pptx.author = 'Office Portal';
  pptx.title = title;

  const slides = Array.isArray(model?.slides) && model.slides.length ? model.slides : [{ elements: [] }];
  for (const slideModel of slides.slice(0, 200)) {
    const slide = pptx.addSlide();
    const bg = slideModel.background || '#0F172A';
    slide.background = { color: hex(bg, '0F172A').replace('#', '') };
    for (const element of slideModel.elements || []) {
      const x = (element.x || 0) / 96;
      const y = (element.y || 0) / 96;
      const w = Math.max((element.w || 200) / 96, 0.2);
      const h = Math.max((element.h || 60) / 96, 0.2);
      if (element.type === 'text') {
        const isTitle = element.role === 'title';
        slide.addText(String(element.text || ''), {
          x,
          y,
          w,
          h,
          fontSize: Math.round((element.size || (isTitle ? 32 : 18)) * 0.75),
          bold: element.bold ?? isTitle,
          color: hex(element.color, isTitle ? 'F8FAFC' : 'E2E8F0').replace('#', ''),
          align: element.align || 'left',
          valign: 'top',
          italic: Boolean(element.italic),
          bullet: element.bullet ? { indent: 12 } : false,
          lineSpacingMultiple: 1.15,
        });
      } else if (element.type === 'rect' || element.type === 'ellipse') {
        slide.addShape(element.type === 'ellipse' ? 'ellipse' : 'rect', {
          x,
          y,
          w,
          h,
          fill: { color: hex(element.fill, '1E293B').replace('#', '') },
          line: { color: hex(element.fill, '1E293B').replace('#', ''), width: 0 },
        });
      } else if (element.type === 'image' && element.src && element.src.startsWith('data:image/')) {
        slide.addImage({ data: element.src, x, y, w, h });
      } else if (element.type === 'table' && Array.isArray(element.rows) && element.rows.length) {
        slide.addTable(
          element.rows.map((row) =>
            (row || []).map((cell) => ({
              text: String(cell ?? ''),
              options: { fontSize: 12, color: 'E2E8F0', fill: { color: '1E293B' } },
            })),
          ),
          { x, y, w, h, border: { type: 'solid', color: '334155', pt: 1 } },
        );
      } else if (element.type === 'chart' && Array.isArray(element.data)) {
        slide.addChart(pptx.ChartType?.bar || 'bar', element.data, { x, y, w, h, showLegend: true });
      }
    }
    if (slideModel.notes) slide.addNotes(decodeEntities(String(slideModel.notes)));
  }
  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(buffer);
}

/** 幻灯片大纲 → 结构化模型，用于 AI 一键成稿。 */
export function outlineToModel(outline, themeName = 'midnight') {
  const theme = themeOf(themeName);
  const width = 1280;
  const height = 720;
  const slides = [];
  const title = String(outline?.title || '未命名演示').slice(0, 80);
  slides.push({
    id: uid('sl_'),
    background: theme.bg,
    notes: '',
    elements: [
      { id: uid('el_'), type: 'rect', x: 0, y: 0, w: width, h: 6, fill: `#${theme.accent}` },
      {
        id: uid('el_'),
        type: 'text',
        x: 96,
        y: 240,
        w: width - 192,
        h: 160,
        text: title,
        role: 'title',
        size: 54,
        color: `#${theme.title}`,
        bold: true,
        align: 'left',
      },
      {
        id: uid('el_'),
        type: 'text',
        x: 96,
        y: 400,
        w: width - 192,
        h: 60,
        text: new Date().toISOString().slice(0, 10),
        role: 'body',
        size: 18,
        color: `#${theme.body}`,
        align: 'left',
      },
    ],
  });
  for (const item of (outline?.slides || []).slice(0, 40)) {
    const bullets = Array.isArray(item.bullets) ? item.bullets.slice(0, 8) : [];
    slides.push({
      id: uid('sl_'),
      background: theme.bg,
      notes: '',
      elements: [
        { id: uid('el_'), type: 'rect', x: 0, y: 0, w: 10, h: height, fill: `#${theme.accent}` },
        {
          id: uid('el_'),
          type: 'text',
          x: 96,
          y: 72,
          w: width - 192,
          h: 96,
          text: String(item.title || '章节').slice(0, 80),
          role: 'title',
          size: 38,
          color: `#${theme.title}`,
          bold: true,
          align: 'left',
        },
        {
          id: uid('el_'),
          type: 'text',
          x: 96,
          y: 200,
          w: width - 192,
          h: 440,
          text: bullets.map((b) => `• ${b}`).join('\n'),
          role: 'body',
          size: 22,
          color: `#${theme.body}`,
          align: 'left',
        },
      ],
    });
  }
  return { version: 1, width, height, theme: themeName, slides };
}

export function blankModel(themeName = 'midnight') {
  return outlineToModel({ title: '新建演示文稿', slides: [] }, themeName);
}
