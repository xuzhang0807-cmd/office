/**
 * DOCX 能力的全部操作。
 *
 * 只做一件事：HTML 模型 ⇄ .docx 字节，外加纯文本提取。
 * 不碰数据库、不碰会话、不碰配额——那些是门户的事。
 *
 * 这个文件不启动服务，方便测试直接 import。
 */

import { HttpError, slugify } from '@office/shared/util';
import { decodeBuffer, encodeBuffer } from '@office/shared/service';
import { docxBufferToHtml, docxBufferToText, htmlToDocxBuffer } from './convert/docx.js';

/** 上传的字节先验 ZIP 签名：坏文件应当是 400，而不是让 JSZip 抛到 500。 */
function requireDocx(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new HttpError(400, '不是有效的 docx 文件（缺少 ZIP 签名）', 'BAD_DOCX');
  }
  return buffer;
}

/** 解析类错误一律归为 400：用户传了坏文件，不是服务端故障。 */
async function parseOr400(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, `docx 解析失败：${error.message}`, 'BAD_DOCX');
  }
}

export const ops = {
  /** HTML → .docx（导出） */
  export: {
    meta: { input: 'html,title?', output: 'buffer(base64),ext' },
    async handler({ html = '', title = '文档' }) {
      if (typeof html !== 'string') throw new HttpError(400, 'html 必须是字符串', 'BAD_HTML');
      const buffer = await htmlToDocxBuffer(html, { title: String(title).slice(0, 200) });
      return encodeBuffer(buffer, 'docx');
    },
  },

  /** .docx → HTML（导入） */
  import: {
    meta: { input: 'buffer(base64)', output: 'html,messages' },
    async handler({ buffer, filename = '' }) {
      const data = requireDocx(decodeBuffer(buffer));
      const result = await parseOr400(() => docxBufferToHtml(data));
      return { html: result.html, messages: result.messages, name: slugify(filename || 'document', 'document') };
    },
  },

  /** .docx → 纯文本 */
  text: {
    meta: { input: 'buffer(base64)', output: 'text' },
    async handler({ buffer }) {
      const data = requireDocx(decodeBuffer(buffer));
      return { text: await parseOr400(() => docxBufferToText(data)) };
    },
  },
};

export default ops;
