import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ensureDirs } from './config.js';
import { HttpError, sha256 } from './util.js';

ensureDirs();

const SAFE_KEY = /^[a-zA-Z0-9._/-]+$/;

function resolveKey(key) {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new HttpError(400, '非法存储键', 'BAD_KEY');
  const full = path.resolve(config.blobDir, key);
  if (!full.startsWith(config.blobDir + path.sep)) throw new HttpError(400, '非法存储键', 'BAD_KEY');
  return full;
}

export function blobPath(key) {
  return resolveKey(key);
}

export function writeBlob(key, buffer) {
  const full = resolveKey(key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, full);
  return { key, size: buffer.length, sha256: sha256(buffer) };
}

export function readBlob(key) {
  const full = resolveKey(key);
  try {
    return fs.readFileSync(full);
  } catch {
    throw new HttpError(404, '文件内容已丢失', 'BLOB_MISSING');
  }
}

export function blobExists(key) {
  try {
    return fs.statSync(resolveKey(key)).isFile();
  } catch {
    return false;
  }
}

export function removeBlob(key) {
  try {
    fs.unlinkSync(resolveKey(key));
  } catch {
    /* 已不存在即视为成功 */
  }
}

/** 内容寻址：相同字节只落一份盘。 */
export function storeContent(buffer, ext) {
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  const key = `sha/${digest.slice(0, 2)}/${digest}${ext ? `.${ext}` : ''}`;
  if (!blobExists(key)) writeBlob(key, buffer);
  return { key, sha256: digest, size: buffer.length };
}

export function storeDocumentBuffer(id, buffer, ext) {
  return writeBlob(`doc/${id}.${ext}`, buffer);
}

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
};

export function mimeForExt(ext = '') {
  return MIME_BY_EXT[String(ext).toLowerCase()] || 'application/octet-stream';
}

/** 从字节头判断图片真实类型，拒绝伪装扩展名的上传。 */
export function sniffImage(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.slice(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buffer.slice(0, 4).toString('latin1') === 'RIFF' && buffer.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buffer.slice(4, 8).toString('latin1') === 'ftyp' && buffer.slice(8, 12).toString('latin1').startsWith('avi')) return 'avif';
  if (buffer.slice(0, 5).toString('latin1') === '<?xml' || buffer.slice(0, 4).toString('latin1') === '<svg') return 'svg';
  return null;
}

/** 解析宽高，用于素材库瀑布流排版；无法识别时返回 null 而不是猜。 */
export function imageSize(buffer, kind) {
  try {
    if (kind === 'png' && buffer.length > 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (kind === 'gif' && buffer.length > 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (kind === 'jpg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
    if (kind === 'webp' && buffer.length > 30) {
      const chunk = buffer.slice(12, 16).toString('latin1');
      if (chunk === 'VP8X') {
        const width = 1 + buffer.readUIntLE(24, 3);
        const height = 1 + buffer.readUIntLE(27, 3);
        return { width, height };
      }
      if (chunk === 'VP8 ') {
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        const bits = buffer.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function storageUsage() {
  let total = 0;
  let files = 0;
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files += 1;
        try {
          total += fs.statSync(full).size;
        } catch {
          /* 并发删除 */
        }
      }
    }
  };
  walk(config.blobDir);
  return { bytes: total, files };
}
