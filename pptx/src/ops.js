/**
 * PPTX 能力的全部操作。
 *
 * 幻灯片模型 ⇄ .pptx 字节，外加「大纲 → 整套幻灯片」的结构化生成。
 * AI 不在这里：门户负责调用模型，本服务只把结构化大纲排成幻灯片。
 */

import { HttpError } from '@office/shared/util';
import { decodeBuffer, encodeBuffer } from '@office/shared/service';
import { blankModel, modelToPptxBuffer, outlineToModel, pptxBufferToModel } from './convert/pptx.js';

/** 先验 ZIP 签名：坏文件应当是 400，而不是让解析器抛到 500。 */
function requirePptx(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new HttpError(400, '不是有效的 pptx 文件（缺少 ZIP 签名）', 'BAD_PPTX');
  }
  return buffer;
}

async function parseOr400(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, `pptx 解析失败：${error.message}`, 'BAD_PPTX');
  }
}

export const ops = {
  /** 幻灯片模型 → .pptx */
  export: {
    meta: { input: 'model,title?', output: 'buffer(base64),ext' },
    async handler({ model, title = '演示文稿' }) {
      if (!model || typeof model !== 'object') throw new HttpError(400, '缺少 model', 'NO_MODEL');
      const buffer = await modelToPptxBuffer(model, { title: String(title).slice(0, 200) });
      return encodeBuffer(buffer, 'pptx');
    },
  },

  /** .pptx → 幻灯片模型 */
  import: {
    meta: { input: 'buffer(base64)', output: 'model' },
    async handler({ buffer }) {
      const data = requirePptx(decodeBuffer(buffer));
      return { model: await parseOr400(() => pptxBufferToModel(data)) };
    },
  },

  /** 结构化大纲 → 幻灯片模型（供 AI 一键成稿使用） */
  outline: {
    meta: { input: 'outline,theme?', output: 'model' },
    async handler({ outline, theme = 'midnight' }) {
      if (!outline || !Array.isArray(outline.slides)) throw new HttpError(400, 'outline.slides 缺失', 'BAD_OUTLINE');
      return { model: outlineToModel(outline, String(theme)) };
    },
  },

  /** 空白演示文稿模型 */
  blank: {
    meta: { input: 'theme?', output: 'model' },
    async handler({ theme = 'midnight' }) {
      return { model: blankModel(String(theme)) };
    },
  },

  /** 幻灯片模型 → 纯文本（逐页） */
  text: {
    meta: { input: 'model', output: 'text,pageCount' },
    async handler({ model }) {
      if (!model || !Array.isArray(model.slides)) throw new HttpError(400, '缺少 model.slides', 'NO_MODEL');
      const text = model.slides
        .map((slide, index) =>
          [`第 ${index + 1} 页`, ...(slide.elements || []).filter((el) => el.type === 'text').map((el) => el.text)]
            .filter(Boolean)
            .join('\n'),
        )
        .join('\n\n');
      return { text, pageCount: model.slides.length };
    },
  },
};

export default ops;
