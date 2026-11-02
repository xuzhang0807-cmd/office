import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';

/**
 * PDF 里的中文必须嵌入字体，否则 pdf-lib 的 StandardFonts 会直接抛
 * "WinAnsi cannot encode"。这里有两个真实坑：
 *
 * 1) Linux 上的中文字体常是 .ttc 集合（Noto CJK、文泉驿），而 fontkit 对 TTC
 *    的 subset 支持不完整，会报 "createSubset is not a function" → 先抽出单字面。
 * 2) Noto CJK 是 CFF 轮廓（OTTO/CFF），fontkit 的 CFFSubset 在 subset 时会在
 *    异步队列里抛 RangeError，直接打挂进程（不可 catch）。所以 CFF 字体一律
 *    不做 subset：优先挑 TrueType(glyf) 字体，实在没有才整字体嵌入并限制体积。
 *
 * 本模块不依赖门户配置：字体缓存目录由 OFFICE_PDF_FONT_CACHE 决定，
 * 未设置时落到系统临时目录，保证这个服务能单独跑起来。
 */

const CANDIDATES = [
  // TrueType（glyf）优先：subset 稳定、产物小
  process.env.OFFICE_PDF_FONT || '',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/truetype/arphic/uming.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
  '/mnt/c/Windows/Fonts/simhei.ttf',
  '/mnt/c/Windows/Fonts/msyh.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  // CFF（OTTO）兜底：只能整字体嵌入
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
];

/** 完整嵌入的 CFF 字体上限，超过就宁可退化成 ASCII，也不产出 20MB 的 PDF。 */
const MAX_FULL_EMBED_BYTES = 8 * 1024 * 1024;

function cacheDir() {
  const dir = process.env.OFFICE_PDF_FONT_CACHE || path.join(os.tmpdir(), 'office-pdf-fonts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let cached;

function isTtc(buffer) {
  return buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'ttcf';
}

/** 读取 sfnt 表目录，判断轮廓类型：glyf=TrueType，CFF=CFF。 */
export function fontFlavor(buffer) {
  try {
    let dirOffset = 0;
    if (isTtc(buffer)) dirOffset = buffer.readUInt32BE(12);
    if (dirOffset + 12 > buffer.length) return 'unknown';
    const numTables = buffer.readUInt16BE(dirOffset + 4);
    const tags = new Set();
    for (let i = 0; i < Math.min(numTables, 64); i += 1) {
      const base = dirOffset + 12 + i * 16;
      if (base + 4 > buffer.length) break;
      tags.add(buffer.toString('latin1', base, base + 4));
    }
    if (tags.has('glyf') || tags.has('CFF2')) return 'truetype';
    if (tags.has('CFF ')) return 'cff';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 从 TTC 集合里抽取第 index 个字面，输出可被 fontkit 正常处理的独立 sfnt。 */
export function extractSfntFromTtc(buffer, index = 0) {
  if (!isTtc(buffer)) return buffer;
  const numFonts = buffer.readUInt32BE(8);
  if (numFonts < 1) throw new Error('TTC 集合为空');
  const safeIndex = Math.min(index, numFonts - 1);
  const dirOffset = buffer.readUInt32BE(12 + safeIndex * 4);
  const sfntVersion = buffer.readUInt32BE(dirOffset);
  const numTables = buffer.readUInt16BE(dirOffset + 4);

  const records = [];
  for (let i = 0; i < numTables; i += 1) {
    const base = dirOffset + 12 + i * 16;
    records.push({
      tag: buffer.toString('latin1', base, base + 4),
      checkSum: buffer.readUInt32BE(base + 4),
      offset: buffer.readUInt32BE(base + 8),
      length: buffer.readUInt32BE(base + 12),
    });
  }

  const headerSize = 12 + numTables * 16;
  let cursor = headerSize;
  const layout = records.map((record) => {
    const padded = (record.length + 3) & ~3;
    const entry = { ...record, newOffset: cursor, padded };
    cursor += padded;
    return entry;
  });

  const out = Buffer.alloc(cursor);
  out.writeUInt32BE(sfntVersion, 0);
  out.writeUInt16BE(numTables, 4);
  let entrySelector = 0;
  while (2 ** (entrySelector + 1) <= numTables) entrySelector += 1;
  const searchRange = 16 * 2 ** entrySelector;
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(numTables * 16 - searchRange, 10);

  layout.forEach((record, i) => {
    const base = 12 + i * 16;
    out.write(record.tag, base, 4, 'latin1');
    out.writeUInt32BE(record.checkSum >>> 0, base + 4);
    out.writeUInt32BE(record.newOffset, base + 8);
    out.writeUInt32BE(record.length, base + 12);
    buffer.copy(out, record.newOffset, record.offset, record.offset + record.length);
  });
  return out;
}

function prepare(candidate) {
  const stat = fs.statSync(candidate);
  if (!stat.isFile() || stat.size < 1024) return null;
  const buffer = fs.readFileSync(candidate);
  if (!isTtc(buffer)) return { path: candidate, buffer, flavor: fontFlavor(buffer) };
  const sfnt = extractSfntFromTtc(buffer, 0);
  const target = path.join(cacheDir(), `${path.basename(candidate).replace(/\.[^.]+$/, '')}-subset.ttf`);
  fs.writeFileSync(target, sfnt);
  return { path: target, buffer: sfnt, flavor: fontFlavor(sfnt) };
}

/** 探测可用字体：优先 TrueType（可 subset），否则 CFF 兜底。 */
export function resolveFont() {
  if (cached !== undefined) return cached;
  cached = null;
  let cffFallback = null;
  for (const candidate of CANDIDATES) {
    if (!candidate) continue;
    try {
      const prepared = prepare(candidate);
      if (!prepared) continue;
      if (prepared.flavor === 'truetype' || prepared.flavor === 'unknown') {
        cached = prepared;
        break;
      }
      if (!cffFallback) cffFallback = prepared;
    } catch {
      /* 换下一个候选 */
    }
  }
  if (!cached && cffFallback) cached = cffFallback;
  return cached;
}

export function resolveFontPath() {
  return resolveFont()?.path || null;
}

export async function embedCjkFont(doc) {
  const font = resolveFont();
  if (!font) return null;
  const subset = font.flavor === 'truetype' || font.flavor === 'unknown';
  if (!subset && font.buffer.length > MAX_FULL_EMBED_BYTES) {
    // CFF 整字体太大：宁可不嵌中文（调用方会退化为 ASCII），也不炸进程/炸体积
    return null;
  }
  try {
    doc.registerFontkit(fontkit);
    return await doc.embedFont(font.buffer, { subset });
  } catch {
    return null;
  }
}

const ASCII_FALLBACK = /[^\x20-\x7E\u00A0-\u00FF\n]/g;

export function asciiSafe(text) {
  return String(text ?? '').replace(ASCII_FALLBACK, '?');
}

export function encodable(text, font) {
  return font ? String(text ?? '') : asciiSafe(text);
}

export function fontStatus() {
  const font = resolveFont();
  return {
    available: Boolean(font),
    path: font?.path || null,
    flavor: font?.flavor || null,
    configured: Boolean(process.env.OFFICE_PDF_FONT),
  };
}
