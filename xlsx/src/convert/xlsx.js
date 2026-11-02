import ExcelJS from 'exceljs';

const MAX_ROWS = 5000;
const MAX_COLS = 200;

function colLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function cellRef(row, col) {
  return `${colLetter(col)}${row + 1}`;
}

export function parseRef(ref) {
  const match = /^([A-Z]+)(\d+)$/.exec(String(ref).toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, col: col - 1 };
}

function styleOf(cell) {
  const style = {};
  const font = cell.font || {};
  if (font.bold) style.bold = true;
  if (font.italic) style.italic = true;
  if (font.underline) style.underline = true;
  if (font.size) style.size = font.size;
  if (font.color?.argb) style.color = `#${String(font.color.argb).slice(-6)}`;
  if (font.name) style.font = font.name;
  const fill = cell.fill;
  if (fill?.type === 'pattern' && fill.fgColor?.argb) {
    style.fill = `#${String(fill.fgColor.argb).slice(-6)}`;
  }
  const align = cell.alignment || {};
  if (align.horizontal) style.align = align.horizontal;
  if (align.vertical) style.valign = align.vertical;
  if (align.wrapText) style.wrap = true;
  if (cell.border?.top?.style || cell.border?.bottom?.style) {
    style.border = Boolean(cell.border.top?.style || cell.border.bottom?.style || cell.border.left?.style || cell.border.right?.style);
  }
  const numFmt = cell.numFmt;
  if (numFmt && numFmt !== 'General') style.numFmt = numFmt;
  return Object.keys(style).length ? style : null;
}

function valueOf(cell) {
  const raw = cell.value;
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'object') {
    if ('formula' in raw || 'sharedFormula' in raw) {
      return { f: `=${raw.formula || raw.sharedFormula}`, v: raw.result ?? '' };
    }
    if (raw.richText) return { v: raw.richText.map((part) => part.text).join('') };
    if (raw.text) return { v: raw.text };
    if (raw.hyperlink) return { v: raw.text || raw.hyperlink, link: raw.hyperlink };
    if (raw instanceof Date) return { v: raw.toISOString().slice(0, 10) };
    return { v: String(raw) };
  }
  if (raw instanceof Date) return { v: raw.toISOString().slice(0, 10) };
  return { v: raw };
}

export async function xlsxBufferToModel(buffer, { maxRows = MAX_ROWS } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = [];
  wb.eachSheet((sheet) => {
    if (sheets.length >= 20) return;
    const rowCount = Math.min(sheet.rowCount || 0, maxRows);
    const colCount = Math.min(Math.max(sheet.columnCount || 0, 1), MAX_COLS);
    const rows = [];
    for (let r = 1; r <= rowCount; r += 1) {
      const row = sheet.getRow(r);
      const cells = [];
      let lastFilled = -1;
      for (let c = 1; c <= colCount; c += 1) {
        const cell = row.getCell(c);
        const value = valueOf(cell);
        if (!value) {
          cells.push(null);
          continue;
        }
        const style = styleOf(cell);
        cells.push(style ? { ...value, s: style } : value);
        lastFilled = c - 1;
      }
      while (cells.length && cells[cells.length - 1] === null) cells.pop();
      rows.push(cells.length ? cells : null);
      if (lastFilled < 0) rows[rows.length - 1] = null;
    }
    while (rows.length && rows[rows.length - 1] === null) rows.pop();
    const merges = [];
    try {
      for (const range of sheet.model?.merges || []) merges.push(range);
    } catch {
      /* 某些文件没有 merges 元数据 */
    }
    const colWidths = [];
    for (let c = 1; c <= colCount; c += 1) {
      const width = sheet.getColumn(c).width;
      colWidths.push(width ? Math.round(width * 7 + 5) : 96);
    }
    sheets.push({
      name: sheet.name,
      rows,
      merges,
      colWidths,
      frozen: sheet.views?.[0]?.state === 'frozen' ? { ySplit: sheet.views[0].ySplit || 0, xSplit: sheet.views[0].xSplit || 0 } : null,
    });
  });
  if (!sheets.length) sheets.push({ name: 'Sheet1', rows: [], merges: [], colWidths: [] });
  return { version: 1, sheets, activeSheet: 0 };
}

function applyStyle(cell, style) {
  if (!style) return;
  if (style.bold || style.italic || style.underline || style.size || style.color || style.font) {
    cell.font = {
      bold: Boolean(style.bold),
      italic: Boolean(style.italic),
      underline: Boolean(style.underline),
      size: style.size || 11,
      name: style.font || 'Calibri',
      color: style.color ? { argb: `FF${style.color.replace('#', '').toUpperCase()}` } : undefined,
    };
  }
  if (style.fill) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.fill.replace('#', '').toUpperCase()}` } };
  }
  if (style.align || style.valign || style.wrap) {
    cell.alignment = { horizontal: style.align, vertical: style.valign || 'middle', wrapText: Boolean(style.wrap) };
  }
  if (style.border) {
    const border = { style: 'thin', color: { argb: 'FFCBD5E1' } };
    cell.border = { top: border, left: border, bottom: border, right: border };
  }
  if (style.numFmt) cell.numFmt = style.numFmt;
}

export async function modelToXlsxBuffer(model) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Office Portal';
  wb.created = new Date();
  const sheets = Array.isArray(model?.sheets) && model.sheets.length ? model.sheets : [{ name: 'Sheet1', rows: [] }];
  for (const sheetModel of sheets.slice(0, 20)) {
    const sheet = wb.addWorksheet(String(sheetModel.name || 'Sheet').slice(0, 31) || 'Sheet');
    const rows = Array.isArray(sheetModel.rows) ? sheetModel.rows.slice(0, MAX_ROWS) : [];
    rows.forEach((row, r) => {
      if (!Array.isArray(row)) return;
      row.slice(0, MAX_COLS).forEach((cell, c) => {
        if (!cell) return;
        const target = sheet.getCell(r + 1, c + 1);
        if (cell.f) {
          target.value = { formula: String(cell.f).replace(/^=/, ''), result: cell.v === '' ? undefined : cell.v };
        } else if (cell.v !== undefined && cell.v !== null && cell.v !== '') {
          const numeric = typeof cell.v === 'number' ? cell.v : Number(cell.v);
          target.value = typeof cell.v === 'number' || (cell.v !== '' && Number.isFinite(numeric) && !/^0\d/.test(String(cell.v)))
            ? numeric
            : cell.v;
        }
        applyStyle(target, cell.s);
      });
    });
    if (Array.isArray(sheetModel.colWidths)) {
      sheetModel.colWidths.slice(0, MAX_COLS).forEach((width, index) => {
        if (Number.isFinite(width) && width > 0) sheet.getColumn(index + 1).width = Math.min(width / 7, 60);
      });
    }
    for (const range of sheetModel.merges || []) {
      try {
        sheet.mergeCells(range);
      } catch {
        /* 非法区间忽略 */
      }
    }
    if (sheetModel.frozen?.ySplit) {
      sheet.views = [{ state: 'frozen', ySplit: Number(sheetModel.frozen.ySplit) || 1 }];
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 把工作表压成 CSV 文本，供 AI 分析或导出使用。 */
export function modelToCsv(model, sheetIndex = 0) {
  const sheet = model?.sheets?.[sheetIndex];
  if (!sheet) return '';
  const escape = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return (sheet.rows || [])
    .map((row) => (row || []).map((cell) => escape(cell?.v ?? '')).join(','))
    .join('\n');
}

/** 估算工作表里真正有内容的区域，供前端初始渲染范围使用。 */
export function modelBounds(model, sheetIndex = 0) {
  const sheet = model?.sheets?.[sheetIndex];
  let rows = 0;
  let cols = 0;
  for (const row of sheet?.rows || []) {
    if (!Array.isArray(row)) continue;
    const filled = row.reduce((acc, cell, index) => (cell ? index + 1 : acc), 0);
    if (filled) {
      rows += 1;
      cols = Math.max(cols, filled);
    }
  }
  return { rows: Math.max(rows, 30), cols: Math.max(cols, 12) };
}
