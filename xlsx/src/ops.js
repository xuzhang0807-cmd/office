/**
 * XLSX 能力的全部操作。
 *
 * 模型（工作表数组）⇄ .xlsx 字节，外加 CSV 导出与范围估算。
 * 公式求值不在这里：那属于浏览器端的编辑器，服务端只存与转。
 */

import { HttpError } from '@office/shared/util';
import { decodeBuffer, encodeBuffer } from '@office/shared/service';
import { modelBounds, modelToCsv, modelToXlsxBuffer, xlsxBufferToModel } from './convert/xlsx.js';

/** 先验 ZIP 签名：坏文件应当是 400，而不是让 ExcelJS 抛到 500。 */
function requireXlsx(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new HttpError(400, '不是有效的 xlsx 文件（缺少 ZIP 签名）', 'BAD_XLSX');
  }
  return buffer;
}

async function parseOr400(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, `xlsx 解析失败：${error.message}`, 'BAD_XLSX');
  }
}

export const ops = {
  /** 工作表模型 → .xlsx */
  export: {
    meta: { input: 'model,title?', output: 'buffer(base64),ext' },
    async handler({ model, title = '表格' }) {
      if (!model || typeof model !== 'object') throw new HttpError(400, '缺少 model', 'NO_MODEL');
      const buffer = await modelToXlsxBuffer(model);
      return { ...encodeBuffer(buffer, 'xlsx'), title: String(title).slice(0, 200) };
    },
  },

  /** .xlsx → 工作表模型 */
  import: {
    meta: { input: 'buffer(base64)', output: 'model' },
    async handler({ buffer, maxRows }) {
      const data = requireXlsx(decodeBuffer(buffer));
      const model = await parseOr400(() => xlsxBufferToModel(data, { maxRows: Number(maxRows) || undefined }));
      return { model };
    },
  },

  /** 工作表模型 → CSV 文本 */
  csv: {
    meta: { input: 'model,sheetIndex?', output: 'csv' },
    async handler({ model, sheetIndex = 0 }) {
      if (!model || typeof model !== 'object') throw new HttpError(400, '缺少 model', 'NO_MODEL');
      return { csv: modelToCsv(model, Number(sheetIndex) || 0) };
    },
  },

  /** 估算有内容区域，前端据此决定初始渲染范围 */
  bounds: {
    meta: { input: 'model,sheetIndex?', output: 'rows,cols' },
    async handler({ model, sheetIndex = 0 }) {
      if (!model || typeof model !== 'object') throw new HttpError(400, '缺少 model', 'NO_MODEL');
      return { bounds: modelBounds(model, Number(sheetIndex) || 0) };
    },
  },
};

export default ops;
