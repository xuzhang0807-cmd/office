/**
 * 轻量表格公式引擎。
 * 目标：让浏览器里的表格能即时算出 SUM/AVERAGE/IF/VLOOKUP 等常用公式，
 * 导出 xlsx 时把结果一并写进 <v>，这样 Excel/WPS 打开就能直接看到数值。
 * 不支持数组公式、外部引用与宏。
 */

const TOKEN =
  /\s*(?:(\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|"((?:[^"]|"")*)"|(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)|([A-Z][A-Z0-9.]*)\(|(<>|<=|>=|[-+*/^&<>=])|(,)|(\()|(\))|(%))/y;

/** 裸标识符（TRUE / FALSE 等），放在主正则之后单独兜底匹配。 */
const IDENT = /\s*([A-Za-z_][A-Za-z0-9_.]*)/y;

export function colToIndex(letters) {
  let n = 0;
  for (const ch of letters.replace(/\$/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indexToCol(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function refOf(row, col) {
  return `${indexToCol(col)}${row + 1}`;
}

export function parseRef(text) {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(String(text).toUpperCase());
  if (!match) return null;
  return { row: Number(match[2]) - 1, col: colToIndex(match[1]) };
}

function tokenize(source) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    TOKEN.lastIndex = index;
    const match = TOKEN.exec(source);
    if (!match) {
      // 裸标识符：TRUE/FALSE/NULL 等字面量
      IDENT.lastIndex = index;
      const ident = IDENT.exec(source);
      if (!ident) throw new Error(`无法解析：${source.slice(index, index + 12)}`);
      index = IDENT.lastIndex;
      tokens.push({ type: 'ident', value: ident[1].toUpperCase() });
      continue;
    }
    index = TOKEN.lastIndex;
    if (match[1] !== undefined) tokens.push({ type: 'num', value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ type: 'str', value: match[2].replace(/""/g, '"') });
    else if (match[3] !== undefined) tokens.push({ type: 'ref', value: match[3].toUpperCase() });
    else if (match[4] !== undefined) tokens.push({ type: 'fn', value: match[4].toUpperCase() });
    else if (match[5] !== undefined) tokens.push({ type: 'op', value: match[5] });
    else if (match[6] !== undefined) tokens.push({ type: 'comma' });
    else if (match[7] !== undefined) tokens.push({ type: 'lparen' });
    else if (match[8] !== undefined) tokens.push({ type: 'rparen' });
    else if (match[9] !== undefined) tokens.push({ type: 'percent' });
  }
  return tokens;
}

/** TRUE / FALSE 是字面量而不是函数名，单独识别，避免被当成 #NAME?。 */
const LITERALS = { TRUE: true, FALSE: false, NULL: '' };

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function flatten(args) {
  const out = [];
  for (const arg of args) {
    if (Array.isArray(arg)) out.push(...flatten(arg));
    else out.push(arg);
  }
  return out;
}

function numeric(args) {
  return flatten(args).map(toNumber).filter((n) => Number.isFinite(n));
}

const FUNCTIONS = {
  SUM: (args) => numeric(args).reduce((a, b) => a + b, 0),
  AVERAGE: (args) => {
    const nums = numeric(args);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  },
  MIN: (args) => {
    const nums = numeric(args);
    return nums.length ? Math.min(...nums) : 0;
  },
  MAX: (args) => {
    const nums = numeric(args);
    return nums.length ? Math.max(...nums) : 0;
  },
  COUNT: (args) => numeric(args).length,
  COUNTA: (args) => flatten(args).filter((v) => v !== '' && v !== null && v !== undefined).length,
  COUNTIF: (args) => {
    const [range, criteria] = args;
    const values = flatten([range]);
    const test = matcher(criteria);
    return values.filter((v) => test(v)).length;
  },
  SUMIF: (args) => {
    const [range, criteria, sumRange] = args;
    const values = flatten([range]);
    const sums = sumRange ? flatten([sumRange]) : values;
    const test = matcher(criteria);
    return values.reduce((acc, value, index) => (test(value) ? acc + toNumber(sums[index]) : acc), 0);
  },
  AVERAGEIF: (args) => {
    const [range, criteria, avgRange] = args;
    const values = flatten([range]);
    const avgs = avgRange ? flatten([avgRange]) : values;
    const test = matcher(criteria);
    const picked = values.map((v, i) => (test(v) ? toNumber(avgs[i]) : null)).filter((v) => v !== null);
    return picked.length ? picked.reduce((a, b) => a + b, 0) / picked.length : 0;
  },
  IF: (args) => (truthy(args[0]) ? args[1] ?? true : args[2] ?? false),
  IFS: (args) => {
    for (let i = 0; i + 1 < args.length; i += 2) {
      if (truthy(args[i])) return args[i + 1];
    }
    return '';
  },
  AND: (args) => flatten(args).every(truthy),
  OR: (args) => flatten(args).some(truthy),
  NOT: (args) => !truthy(args[0]),
  ROUND: (args) => {
    const digits = toNumber(args[1] ?? 0);
    const factor = 10 ** digits;
    return Math.round(toNumber(args[0]) * factor) / factor;
  },
  ROUNDUP: (args) => {
    const digits = toNumber(args[1] ?? 0);
    const factor = 10 ** digits;
    return Math.ceil(toNumber(args[0]) * factor) / factor;
  },
  ROUNDDOWN: (args) => {
    const digits = toNumber(args[1] ?? 0);
    const factor = 10 ** digits;
    return Math.floor(toNumber(args[0]) * factor) / factor;
  },
  ABS: (args) => Math.abs(toNumber(args[0])),
  SQRT: (args) => Math.sqrt(Math.max(toNumber(args[0]), 0)),
  POWER: (args) => toNumber(args[0]) ** toNumber(args[1]),
  MOD: (args) => toNumber(args[0]) % toNumber(args[1]),
  INT: (args) => Math.floor(toNumber(args[0])),
  CEILING: (args) => Math.ceil(toNumber(args[0])),
  FLOOR: (args) => Math.floor(toNumber(args[0])),
  PI: () => Math.PI,
  EXP: (args) => Math.exp(toNumber(args[0])),
  LN: (args) => Math.log(Math.max(toNumber(args[0]), 1e-12)),
  LOG: (args) => Math.log(toNumber(args[0])) / Math.log(toNumber(args[1] ?? 10)),
  LEN: (args) => toText(args[0]).length,
  LEFT: (args) => toText(args[0]).slice(0, Math.max(toNumber(args[1] ?? 1), 0)),
  RIGHT: (args) => {
    const n = Math.max(toNumber(args[1] ?? 1), 0);
    const text = toText(args[0]);
    return n === 0 ? '' : text.slice(-n);
  },
  MID: (args) => {
    const start = Math.max(toNumber(args[1] ?? 1), 1) - 1;
    const len = Math.max(toNumber(args[2] ?? 1), 0);
    return toText(args[0]).slice(start, start + len);
  },
  UPPER: (args) => toText(args[0]).toUpperCase(),
  LOWER: (args) => toText(args[0]).toLowerCase(),
  TRIM: (args) => toText(args[0]).trim(),
  CONCAT: (args) => flatten(args).map(toText).join(''),
  CONCATENATE: (args) => flatten(args).map(toText).join(''),
  TEXTJOIN: (args) => {
    const [delimiter, ignoreEmpty, ...rest] = args;
    const values = flatten(rest).map(toText);
    return (ignoreEmpty ? values.filter(Boolean) : values).join(toText(delimiter));
  },
  TEXT: (args) => {
    const value = args[0];
    const fmt = toText(args[1] || '');
    if (fmt.includes('%')) return `${(toNumber(value) * 100).toFixed(fmt.includes('.00') ? 2 : 0)}%`;
    if (fmt.includes('0.00')) return toNumber(value).toFixed(2);
    return toText(value);
  },
  VALUE: (args) => toNumber(args[0]),
  TODAY: () => new Date().toISOString().slice(0, 10),
  NOW: () => new Date().toISOString().slice(0, 19).replace('T', ' '),
  YEAR: (args) => new Date(args[0]).getFullYear(),
  MONTH: (args) => new Date(args[0]).getMonth() + 1,
  DAY: (args) => new Date(args[0]).getDate(),
  VLOOKUP: (args) => {
    const [needle, tableArg, colIndex, approximate] = args;
    const table = Array.isArray(tableArg) ? tableArg : [];
    const rows = Array.isArray(table[0]) ? table : [table];
    const target = toNumber(colIndex) - 1;
    if (approximate) {
      let best = null;
      for (const row of rows) {
        if (toNumber(row[0]) <= toNumber(needle)) best = row;
      }
      return best ? best[target] ?? '' : '';
    }
    for (const row of rows) {
      if (toText(row[0]).toLowerCase() === toText(needle).toLowerCase()) return row[target] ?? '';
    }
    return '#N/A';
  },
  HLOOKUP: (args) => {
    const [needle, tableArg, rowIndex] = args;
    const table = Array.isArray(tableArg) ? tableArg : [];
    const header = table[0] || [];
    const index = header.findIndex((v) => toText(v).toLowerCase() === toText(needle).toLowerCase());
    if (index < 0) return '#N/A';
    const row = table[toNumber(rowIndex) - 1] || [];
    return row[index] ?? '';
  },
  INDEX: (args) => {
    const [range, rowIndex, colIndex] = args;
    const rows = Array.isArray(range[0]) ? range : [range];
    const r = toNumber(rowIndex) - 1;
    const c = colIndex === undefined ? 0 : toNumber(colIndex) - 1;
    return rows[r]?.[c] ?? '';
  },
  MATCH: (args) => {
    const [needle, range] = args;
    const values = flatten([range]);
    return values.findIndex((v) => toText(v).toLowerCase() === toText(needle).toLowerCase()) + 1 || '#N/A';
  },
  ISBLANK: (args) => args[0] === '' || args[0] === null || args[0] === undefined,
  ISNUMBER: (args) => typeof args[0] === 'number',
  ISTEXT: (args) => typeof args[0] === 'string',
  IFERROR: (args) => {
    const value = args[0];
    return typeof value === 'string' && value.startsWith('#') ? args[1] ?? '' : value;
  },
};

function matcher(criteria) {
  if (typeof criteria === 'number') return (value) => toNumber(value) === criteria;
  const text = toText(criteria);
  const op = /^(<=|>=|<>|=|<|>)(.*)$/.exec(text);
  if (op) {
    const [, symbol, rest] = op;
    const needle = rest.trim();
    const numericNeedle = Number(needle);
    const isNum = needle !== '' && Number.isFinite(numericNeedle);
    return (value) => {
      const left = isNum ? toNumber(value) : toText(value);
      const right = isNum ? numericNeedle : needle;
      switch (symbol) {
        case '=': return left === right;
        case '<>': return left !== right;
        case '<': return left < right;
        case '>': return left > right;
        case '<=': return left <= right;
        case '>=': return left >= right;
        default: return false;
      }
    };
  }
  return (value) => toText(value).toLowerCase() === text.toLowerCase();
}

function truthy(value) {
  if (typeof value === 'string') return value !== '' && value !== 'FALSE' && value !== '0';
  return Boolean(value);
}

export function cellValue(sheet, row, col, cache) {
  const rowData = sheet.rows?.[row];
  if (!Array.isArray(rowData)) return '';
  const cell = rowData[col];
  if (!cell) return '';
  if (cell.f) {
    const key = `${row}:${col}`;
    if (cache.computing.has(key)) throw new Error('#CIRCULAR');
    if (cache.values.has(key)) return cache.values.get(key);
    cache.computing.add(key);
    let value;
    try {
      value = evaluateFormula(cell.f, sheet, cache);
    } catch (error) {
      value = error.message.startsWith('#') ? error.message : '#ERROR';
    }
    cache.computing.delete(key);
    cache.values.set(key, value);
    return value;
  }
  return cell.v ?? '';
}

function rangeValues(sheet, from, to, cache) {
  const start = parseRef(from);
  const end = parseRef(to);
  if (!start || !end) return [];
  const out = [];
  for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r += 1) {
    const row = [];
    for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c += 1) {
      row.push(cellValue(sheet, r, c, cache));
    }
    out.push(row);
  }
  return out;
}

export function evaluateFormula(formula, sheet, cache = { values: new Map(), computing: new Set() }) {
  const source = String(formula || '').replace(/^=/, '');
  if (!source.trim()) return '';
  const tokens = tokenize(source);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpression() {
    let left = parseTerm();
    while (peek() && peek().type === 'op' && ['+', '-', '&'].includes(peek().value)) {
      const op = next().value;
      const right = parseTerm();
      if (op === '+') left = toNumber(left) + toNumber(right);
      else if (op === '-') left = toNumber(left) - toNumber(right);
      else left = toText(left) + toText(right);
    }
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    while (peek() && peek().type === 'op' && ['*', '/', '%'].includes(peek().value)) {
      const op = next().value;
      const right = parseUnary();
      if (op === '*') left = toNumber(left) * toNumber(right);
      else if (op === '/') {
        const divisor = toNumber(right);
        left = divisor === 0 ? '#DIV/0!' : toNumber(left) / divisor;
      } else left = toNumber(left) % toNumber(right);
    }
    return left;
  }

  function parseUnary() {
    if (peek()?.type === 'op' && peek().value === '-') {
      next();
      return -toNumber(parseUnary());
    }
    if (peek()?.type === 'op' && peek().value === '+') {
      next();
      return toNumber(parseUnary());
    }
    return parseComparison();
  }

  function parseComparison() {
    let left = parsePower();
    while (peek()?.type === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().value)) {
      const op = next().value;
      const right = parsePower();
      const a = typeof left === 'number' || typeof right === 'number' ? toNumber(left) : toText(left);
      const b = typeof left === 'number' || typeof right === 'number' ? toNumber(right) : toText(right);
      switch (op) {
        case '=': left = a === b; break;
        case '<>': left = a !== b; break;
        case '<': left = a < b; break;
        case '>': left = a > b; break;
        case '<=': left = a <= b; break;
        case '>=': left = a >= b; break;
        default: break;
      }
    }
    return left;
  }

  function parsePower() {
    const base = parsePrimary();
    if (peek()?.type === 'op' && peek().value === '^') {
      next();
      return toNumber(base) ** toNumber(parsePower());
    }
    return base;
  }

  function parsePrimary() {
    const token = next();
    if (!token) throw new Error('#ERROR');
    if (token.type === 'num') return token.value;
    if (token.type === 'str') return token.value;
    if (token.type === 'percent') return 0.01;
    if (token.type === 'lparen') {
      const value = parseExpression();
      if (peek()?.type === 'rparen') next();
      return value;
    }
    if (token.type === 'ref') {
      if (token.value.includes(':')) {
        const [from, to] = token.value.split(':');
        return rangeValues(sheet, from, to, cache);
      }
      const ref = parseRef(token.value);
      if (!ref) throw new Error('#REF!');
      return cellValue(sheet, ref.row, ref.col, cache);
    }
    if (token.type === 'ident') {
      if (token.value in LITERALS) return LITERALS[token.value];
      throw new Error('#NAME?');
    }
    if (token.type === 'fn') {
      const args = [];
      if (peek()?.type !== 'rparen') {
        for (;;) {
          args.push(parseExpression());
          if (peek()?.type === 'comma') {
            next();
            continue;
          }
          break;
        }
      }
      if (peek()?.type === 'rparen') next();
      const fn = FUNCTIONS[token.value];
      if (!fn) throw new Error('#NAME?');
      return fn(args);
    }
    throw new Error('#ERROR');
  }

  let result;
  try {
    result = parseExpression();
  } catch (error) {
    // 以 # 开头的错误码直接作为单元格值返回，其余是解析失败
    if (String(error.message).startsWith('#')) return error.message;
    return '#ERROR';
  }
  if (pos < tokens.length) return '#ERROR';
  return result;
}

/** 整表重算：返回新 sheet（保留原单元格样式），供导出与渲染共用。 */
export function recalcSheet(sheet) {
  const cache = { values: new Map(), computing: new Set() };
  const rows = (sheet.rows || []).map((row) => (Array.isArray(row) ? row.slice() : row));
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (cell?.f) {
        const value = cellValue(sheet, r, c, cache);
        row[c] = { ...cell, v: value };
      }
    }
  }
  return { ...sheet, rows };
}
