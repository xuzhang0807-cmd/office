import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { evaluateFormula, indexToCol, parseRef, refOf, recalcSheet } from '../lib/formula.js';

const DEFAULT_ROWS = 40;
const DEFAULT_COLS = 14;
const MAX_ROWS = 2000;
const MAX_COLS = 120;

function emptySheet(name = 'Sheet1') {
  return { name, rows: [], merges: [], colWidths: [] };
}

function cellAt(sheet, row, col) {
  const rowData = sheet.rows?.[row];
  return Array.isArray(rowData) ? rowData[col] : undefined;
}

function setCell(sheet, row, col, next) {
  const rows = (sheet.rows || []).map((r) => (Array.isArray(r) ? r.slice() : r));
  while (rows.length <= row) rows.push(null);
  if (!Array.isArray(rows[row])) rows[row] = [];
  const line = rows[row];
  while (line.length <= col) line.push(null);
  line[col] = next;
  return { ...sheet, rows };
}

function formatValue(value, style) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    const fmt = style?.numFmt;
    if (fmt === '0%' || fmt === '0.0%' || fmt === '0.00%') {
      const digits = fmt === '0%' ? 0 : fmt === '0.0%' ? 1 : 2;
      return `${(value * 100).toFixed(digits)}%`;
    }
    if (fmt === '#,##0') return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (fmt === '#,##0.00') return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (fmt === '0.00') return value.toFixed(2);
    if (Number.isInteger(value)) return String(value);
    return String(Math.round(value * 1e6) / 1e6);
  }
  return String(value);
}

function displayValue(sheet, row, col, cache) {
  const cell = cellAt(sheet, row, col);
  if (!cell) return '';
  if (cell.f) {
    try {
      return formatValue(evaluateFormula(cell.f, sheet, cache), cell.s);
    } catch (error) {
      return error.message.startsWith('#') ? error.message : '#ERROR';
    }
  }
  return formatValue(cell.v, cell.s);
}

function cellStyle(cell) {
  const style = {};
  if (!cell?.s) return style;
  const s = cell.s;
  if (s.bold) style.fontWeight = 600;
  if (s.italic) style.fontStyle = 'italic';
  if (s.underline) style.textDecoration = 'underline';
  if (s.size) style.fontSize = `${Math.min(Math.max(Number(s.size), 9), 28)}px`;
  if (s.color) style.color = s.color;
  if (s.fill) style.background = s.fill;
  if (s.align) style.textAlign = s.align;
  if (s.wrap) style.whiteSpace = 'pre-wrap';
  return style;
}

export default function XlsxEditor({ model, onChange, registerSelection, editorRef }) {
  const [doc, setDoc] = useState(() => normalizeModel(model));
  const [active, setActive] = useState(model?.activeSheet || 0);
  const [selection, setSelection] = useState({ row: 0, col: 0 });
  const [draft, setDraft] = useState(null);
  const [formula, setFormula] = useState('');
  const cacheRef = useRef({ values: new Map(), computing: new Set() });
  const lastEmitted = useRef(JSON.stringify(model || {}));
  const inputRef = useRef(null);

  useEffect(() => {
    const incoming = normalizeModel(model);
    const serialized = JSON.stringify(incoming);
    if (serialized !== lastEmitted.current && serialized !== JSON.stringify(doc)) {
      setDoc(incoming);
      lastEmitted.current = serialized;
      cacheRef.current = { values: new Map(), computing: new Set() };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const sheet = doc.sheets[active] || emptySheet();

  const bounds = useMemo(() => {
    let rows = DEFAULT_ROWS;
    let cols = DEFAULT_COLS;
    for (const row of sheet.rows || []) {
      if (!Array.isArray(row)) continue;
      rows = Math.max(rows, row.length ? 1 : 0);
      cols = Math.max(cols, row.length);
    }
    return {
      rows: Math.min(Math.max(rows + 6, DEFAULT_ROWS), MAX_ROWS),
      cols: Math.min(Math.max(cols + 2, DEFAULT_COLS), MAX_COLS),
    };
  }, [sheet.rows]);

  const commit = useCallback(
    (nextDoc) => {
      setDoc(nextDoc);
      cacheRef.current = { values: new Map(), computing: new Set() };
      const serialized = JSON.stringify({ version: 1, sheets: nextDoc.sheets, activeSheet: active });
      lastEmitted.current = serialized;
      onChange?.({ version: 1, sheets: nextDoc.sheets, activeSheet: active });
    },
    [active, onChange],
  );

  const updateSheet = useCallback(
    (updater) => {
      const next = doc.sheets.map((item, index) => (index === active ? updater(item) : item));
      commit({ ...doc, sheets: next });
    },
    [doc, active, commit],
  );

  useEffect(() => {
    const cell = cellAt(sheet, selection.row, selection.col);
    setFormula(cell?.f ? cell.f : String(cell?.v ?? ''));
  }, [selection.row, selection.col, sheet]);

  useImperativeHandle(
    editorRef,
    () => ({
      insertText(text) {
        const target = setCell(sheet, selection.row, selection.col, { v: text });
        commit({ ...doc, sheets: doc.sheets.map((s, i) => (i === active ? target : s)) });
      },
      replaceSelection(text) {
        const cell = cellAt(sheet, selection.row, selection.col);
        const target = setCell(sheet, selection.row, selection.col, { ...(cell || {}), v: text, f: undefined });
        commit({ ...doc, sheets: doc.sheets.map((s, i) => (i === active ? target : s)) });
      },
      setCellFormula(ref, formulaText) {
        const parsed = parseRef(ref);
        if (!parsed) return;
        const cell = cellAt(sheet, parsed.row, parsed.col);
        const value = String(formulaText).startsWith('=')
          ? { ...(cell || {}), f: String(formulaText), v: cell?.v ?? 0 }
          : { ...(cell || {}), v: formulaText, f: undefined };
        const target = setCell(sheet, parsed.row, parsed.col, value);
        commit({ ...doc, sheets: doc.sheets.map((s, i) => (i === active ? target : s)) });
      },
      getText() {
        return (sheet.rows || [])
          .map((row) => (row || []).map((cell) => (cell?.v ?? cell?.f ?? '')).join('\t'))
          .join('\n');
      },
    }),
    [sheet, selection, doc, active, commit],
  );

  useEffect(() => {
    if (!registerSelection) return;
    registerSelection(() => {
      const cell = cellAt(sheet, selection.row, selection.col);
      if (!cell) return '';
      return `${refOf(selection.row, selection.col)}: ${cell.f || cell.v || ''}`;
    });
  }, [registerSelection, sheet, selection]);

  const coerce = (value) => {
    if (value === '' || value === null || value === undefined) return '';
    const text = String(value);
    if (/^-?\d+(\.\d+)?$/.test(text) && !/^0\d/.test(text)) return Number(text);
    if (/^-?\d+(\.\d+)?%$/.test(text)) return Number(text.slice(0, -1)) / 100;
    return text;
  };

  /** 提交当前草稿到单元格；text 为输入框里的原始文本（可能是公式）。 */
  const commitDraft = useCallback(
    (text, { row = selection.row, col = selection.col } = {}) => {
      const existing = cellAt(sheet, row, col) || {};
      const isFormula = typeof text === 'string' && text.startsWith('=');
      const next = isFormula
        ? { ...existing, f: text, v: existing.v ?? 0 }
        : { ...existing, v: coerce(text), f: undefined };
      const empty = !isFormula && (next.v === '' || next.v === undefined) && !next.s;
      const updated = setCell(sheet, row, col, empty ? null : next);
      commit({ ...doc, sheets: doc.sheets.map((s, i) => (i === active ? updated : s)) });
    },
    [sheet, selection, doc, active, commit],
  );

  const move = (dRow, dCol, { commitCurrent = true } = {}) => {
    if (commitCurrent && draft !== null) commitDraft(draft);
    setDraft(null);
    setSelection((prev) => ({
      row: Math.min(Math.max(prev.row + dRow, 0), bounds.rows - 1),
      col: Math.min(Math.max(prev.col + dCol, 0), bounds.cols - 1),
    }));
  };

  const focusCell = (row, col) => {
    setSelection({ row, col });
    setDraft(null);
    requestAnimationFrame(() => {
      const input = document.querySelector(`td.cell[data-ref="${refOf(row, col)}"] input`);
      input?.focus();
    });
  };

  const applyStyle = (patch) => {
    const existing = cellAt(sheet, selection.row, selection.col) || {};
    const next = { ...existing, s: { ...(existing.s || {}), ...patch } };
    const updated = setCell(sheet, selection.row, selection.col, next);
    commit({ ...doc, sheets: doc.sheets.map((s, i) => (i === active ? updated : s)) });
  };

  const addSheet = () => {
    const name = `Sheet${doc.sheets.length + 1}`;
    commit({ ...doc, sheets: [...doc.sheets, emptySheet(name)] });
    setActive(doc.sheets.length);
    setSelection({ row: 0, col: 0 });
  };

  const removeSheet = () => {
    if (doc.sheets.length <= 1) return;
    const next = { ...doc, sheets: doc.sheets.filter((_, i) => i !== active) };
    setActive(Math.max(active - 1, 0));
    commit(next);
  };

  const renameSheet = () => {
    const name = window.prompt('工作表名称', sheet.name);
    if (!name) return;
    updateSheet((s) => ({ ...s, name: name.slice(0, 31) }));
  };

  const selectedRef = refOf(selection.row, selection.col);
  const recalculated = useMemo(() => {
    try {
      return recalcSheet(sheet);
    } catch {
      return sheet;
    }
  }, [sheet]);

  const currentCell = cellAt(sheet, selection.row, selection.col);

  return (
    <div>
      <div className="toolbar" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', background: 'var(--bg-soft)' }}>
        <button className="tool" title="加粗" onClick={() => applyStyle({ bold: true })}><b>B</b></button>
        <button className="tool" title="斜体" onClick={() => applyStyle({ italic: true })}><i>I</i></button>
        <button className="tool" title="底色" onClick={() => applyStyle({ fill: '#FEF3C7' })}>▩</button>
        <button className="tool" title="清除底色" onClick={() => applyStyle({ fill: undefined })}>▢</button>
        <div className="divider-v" />
        <button className="tool" title="左对齐" onClick={() => applyStyle({ align: 'left' })}>⇤</button>
        <button className="tool" title="居中" onClick={() => applyStyle({ align: 'center' })}>⇔</button>
        <button className="tool" title="右对齐" onClick={() => applyStyle({ align: 'right' })}>⇥</button>
        <div className="divider-v" />
        <button className="tool" title="百分比" onClick={() => applyStyle({ numFmt: '0.0%' })}>%</button>
        <button className="tool" title="千分位" onClick={() => applyStyle({ numFmt: '#,##0' })}>1,000</button>
        <button className="tool" title="两位小数" onClick={() => applyStyle({ numFmt: '#,##0.00' })}>0.00</button>
        <div className="spacer" />
        <button className="tool" onClick={addSheet} title="新增工作表">＋表</button>
        <button className="tool" onClick={renameSheet} title="重命名">重命名</button>
        <button className="tool" onClick={removeSheet} disabled={doc.sheets.length <= 1} title="删除工作表">删表</button>
      </div>

      <div className="sheet-bar">
        {doc.sheets.map((s, index) => (
          <button
            key={`${s.name}-${index}`}
            className={`sheet-tab ${index === active ? 'active' : ''}`}
            onClick={() => {
              setActive(index);
              setSelection({ row: 0, col: 0 });
              setDraft(null);
            }}
          >
            {s.name}
          </button>
        ))}
        <div className="spacer" />
        <span className="small muted">Enter 下一行 · Tab 右移 · 支持 =SUM()/IF()/VLOOKUP()</span>
      </div>

      <div className="formula-bar">
        <span className="ref">{selectedRef}</span>
        <span className="muted small">fx</span>
        <input
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitDraft(formula);
              setFormula('');
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              setFormula(currentCell?.f || String(currentCell?.v ?? ''));
            }
          }}
          placeholder={currentCell?.f ? '' : '输入值或公式，如 =SUM(A1:A10)'}
        />
      </div>

      <div className="grid-wrap">
        <div className="grid-scroll">
          <table className="sheet">
            <thead>
              <tr>
                <th className="corner" style={{ width: 44 }} />
                {Array.from({ length: bounds.cols }, (_, col) => (
                  <th key={col} style={{ width: sheet.colWidths?.[col] || 96, minWidth: sheet.colWidths?.[col] || 96 }}>
                    {indexToCol(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: bounds.rows }, (_, row) => (
                <tr key={row}>
                  <td className="rowhead">{row + 1}</td>
                  {Array.from({ length: bounds.cols }, (_, col) => {
                    const cell = cellAt(sheet, row, col);
                    const isSelected = selection.row === row && selection.col === col;
                    const ref = refOf(row, col);
                    const text = draft !== null && isSelected ? draft : cell?.f ? cell.f : String(cell?.v ?? '');
                    return (
                      <td
                        key={col}
                        className={`cell ${isSelected ? 'selected' : ''}`}
                        data-ref={ref}
                        style={cellStyle(cell)}
                        onMouseDown={(event) => {
                          if (isSelected) return;
                          if (draft !== null) commitDraft(draft);
                          setDraft(null);
                          setSelection({ row, col });
                          event.preventDefault();
                          requestAnimationFrame(() => {
                            document.querySelector(`td.cell[data-ref="${ref}"] input`)?.focus();
                          });
                        }}
                      >
                        {isSelected ? (
                          <input
                            ref={inputRef}
                            autoFocus
                            value={text}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => {
                              if (draft !== null) commitDraft(draft);
                              setDraft(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitDraft(text, { row, col });
                                setDraft(null);
                                setSelection({ row: Math.min(row + 1, bounds.rows - 1), col });
                              } else if (e.key === 'Tab') {
                                e.preventDefault();
                                commitDraft(text, { row, col });
                                setDraft(null);
                                setSelection({ row, col: Math.min(col + 1, bounds.cols - 1) });
                              } else if (e.key === 'Escape') {
                                setDraft(null);
                              } else if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                commitDraft(text, { row, col });
                                setDraft(null);
                                setSelection({ row: Math.min(row + 1, bounds.rows - 1), col });
                              } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                commitDraft(text, { row, col });
                                setDraft(null);
                                setSelection({ row: Math.max(row - 1, 0), col });
                              } else if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                commitDraft(text, { row, col });
                                setDraft(null);
                                setSelection({ row, col: Math.min(col + 1, bounds.cols - 1) });
                              } else if (e.key === 'ArrowLeft' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                commitDraft(text, { row, col });
                                setDraft(null);
                                setSelection({ row, col: Math.max(col - 1, 0) });
                              }
                            }}
                          />
                        ) : (
                          displayValue(recalculated, row, col, cacheRef.current)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function normalizeModel(model) {
  if (!model || !Array.isArray(model.sheets) || !model.sheets.length) {
    return { version: 1, sheets: [emptySheet()], activeSheet: 0 };
  }
  return {
    version: 1,
    activeSheet: model.activeSheet || 0,
    sheets: model.sheets.map((sheet) => ({
      name: sheet.name || 'Sheet',
      rows: Array.isArray(sheet.rows) ? sheet.rows : [],
      merges: Array.isArray(sheet.merges) ? sheet.merges : [],
      colWidths: Array.isArray(sheet.colWidths) ? sheet.colWidths : [],
      frozen: sheet.frozen || null,
    })),
  };
}

export { normalizeModel };
