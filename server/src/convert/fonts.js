import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { config } from '../config.js';

/**
 * PDF 里的中文必须嵌入字体，否则 pdf-lib 的 StandardFonts 会直接抛
 * "WinAnsi cannot encode"。Linux 上常见的中文字体都是 .ttc 集合（Noto CJK、
 * 文泉驿），而 pdf-lib/fontkit 对 TTC 的 subset 支持不完整，会报
 * "createSubset is not a function"。这里把 TTC 里的第一个字面抽成独立
 * sfnt（TTF/OTF），既解决嵌入问题，也避免把整个 20MB 集合塞进 PDF。
 */

const CANDIDATES = [
  process.env.OFFICE_PDF_FONT || '',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/truetype/arphic/uming.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.otf',
  '/mnt/c/Windows/Fonts/simhei.ttf',
  '/mnt/c/Windows/Fonts/msyh.ttc',
  '/System/Library/Fonts/PingFang.ttc',
];

let cached;

function isTtc(buffer) {
  return buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'ttcf';
}

/** 从 TTC 集合里抽取第 index 个字面，输出可被 fontkit 正常 subset 的独立 sfnt。 */
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
  // searchRange / entrySelector / rangeShift：保持与 table 数一致即可
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

/** 探测可用字体；.ttc 会被抽成单字面并缓存在 data/fonts 下。 */
export function resolveFontPath() {
  if (cached !== undefined) return cached;
  cached = null;
  const cacheDir = path.join(config.dataDir, 'fonts');
  for (const candidate of CANDIDATES) {
    if (!candidate) continue;
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile() || stat.size < 1024) continue;
      const buffer = fs.readFileSync(candidate);
      if (!isTtc(buffer)) {
        cached = candidate;
        break;
      }
      const sfnt = extractSfntFromTtc(buffer, 0);
      fs.mkdirSync(cacheDir, { recursive: true });
      const target = path.join(cacheDir, `${path.basename(candidate).replace(/\.[^.]+$/, '')}-subset.ttf`);
      fs.writeFileSync(target, sfnt);
      cached = target;
      break;
    } catch {
      /* 换下一个候选 */
    }
  }
  return cached;
}

export async function embedCjkFont(doc) {
  const fontPath = resolveFontPath();
  if (!fontPath) return null;
  try {
    doc.registerFontkit(fontkit);
    const bytes = fs.readFileSync(fontPath);
    return await doc.embedFont(bytes, { subset: true });
  } catch {
    try {
      doc.registerFontkit(fontkit);
      return await doc.embedFont(fs.readFileSync(fontPath), { subset: false });
    } catch {
      return null;
    }
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
  const fontPath = resolveFontPath();
  return { available: Boolean(fontPath), path: fontPath || null, configured: Boolean(process.env.OFFICE_PDF_FONT) };
}
