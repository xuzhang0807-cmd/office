import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { recalcSheet } from '../lib/formula.js';

const THEMES = [
  { id: 'midnight', label: '深空', bg: '#0F172A', title: '#F8FAFC', body: '#CBD5E1', accent: '#38BDF8' },
  { id: 'paper', label: '纸张', bg: '#FFFFFF', title: '#0F172A', body: '#334155', accent: '#2563EB' },
  { id: 'sunset', label: '日落', bg: '#1E1B4B', title: '#FDE68A', body: '#E0E7FF', accent: '#F472B6' },
  { id: 'forest', label: '森林', bg: '#052E2B', title: '#ECFDF5', body: '#A7F3D0', accent: '#34D399' },
];

const uid = () => `el_${Math.random().toString(36).slice(2, 10)}`;

function blankSlide(theme) {
  return {
    id: `sl_${Math.random().toString(36).slice(2, 10)}`,
    background: theme.bg,
    notes: '',
    elements: [
      {
        id: uid(),
        type: 'text',
        x: 96,
        y: 96,
        w: 1088,
        h: 120,
        text: '点击编辑标题',
        role: 'title',
        size: 44,
        color: theme.title,
        bold: true,
        align: 'left',
      },
      {
        id: uid(),
        type: 'text',
        x: 96,
        y: 260,
        w: 1088,
        h: 340,
        text: '点击编辑正文\n• 第一条要点\n• 第二条要点',
        role: 'body',
        size: 22,
        color: theme.body,
        align: 'left',
      },
    ],
  };
}

function normalize(model) {
  const width = model?.width || 1280;
  const height = model?.height || 720;
  const slides = Array.isArray(model?.slides) && model.slides.length ? model.slides : [blankSlide(THEMES[0])];
  return {
    version: 1,
    width,
    height,
    theme: model?.theme || 'midnight',
    slides: slides.map((slide) => ({
      id: slide.id || `sl_${Math.random().toString(36).slice(2, 10)}`,
      background: slide.background || '#0F172A',
      notes: slide.notes || '',
      elements: (slide.elements || []).map((el) => ({ ...el, id: el.id || uid() })),
    })),
  };
}

export default function PptxEditor({ model, onChange, registerSelection, editorRef }) {
  const [deck, setDeck] = useState(() => normalize(model));
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState(null);
  const lastEmitted = useRef(JSON.stringify(model || {}));
  const stageRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const incoming = normalize(model);
    const serialized = JSON.stringify(incoming);
    if (serialized !== lastEmitted.current && serialized !== JSON.stringify(deck)) {
      setDeck(incoming);
      lastEmitted.current = serialized;
      setActive(0);
      setSelected(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  useEffect(() => {
    const update = () => {
      const available = (stageRef.current?.clientWidth || 900) - 48;
      setScale(Math.min(Math.max(available / (deck.width || 1280), 0.35), 1.4));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [deck.width]);

  const commit = useCallback(
    (next) => {
      setDeck(next);
      const serialized = JSON.stringify(next);
      lastEmitted.current = serialized;
      onChange?.(next);
    },
    [onChange],
  );

  const slide = deck.slides[active] || deck.slides[0];

  const patchSlide = (patch) => {
    const slides = deck.slides.map((item, index) => (index === active ? { ...item, ...patch } : item));
    commit({ ...deck, slides });
  };

  const patchElement = (id, patch) => {
    const slides = deck.slides.map((item, index) =>
      index === active
        ? { ...item, elements: item.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)) }
        : item,
    );
    commit({ ...deck, slides });
  };

  const addElement = (type) => {
    const theme = THEMES.find((t) => t.id === deck.theme) || THEMES[0];
    const base = { id: uid(), x: 120, y: 160, w: 480, h: 220 };
    let element;
    if (type === 'text') {
      element = { ...base, type: 'text', text: '新文本', role: 'body', size: 24, color: theme.body, align: 'left' };
    } else if (type === 'rect') {
      element = { ...base, type: 'rect', fill: theme.accent, radius: 12 };
    } else if (type === 'table') {
      element = { ...base, type: 'table', rows: [['表头 1', '表头 2'], ['', '']] };
    } else {
      element = { ...base, type: 'image', src: '' };
    }
    patchSlide({ elements: [...slide.elements, element] });
    setSelected(element.id);
  };

  const removeElement = () => {
    if (!selected) return;
    patchSlide({ elements: slide.elements.filter((el) => el.id !== selected) });
    setSelected(null);
  };

  const moveElement = (dx, dy) => {
    const el = slide.elements.find((item) => item.id === selected);
    if (!el) return;
    patchElement(el.id, { x: Math.max(el.x + dx, -40), y: Math.max(el.y + dy, -40) });
  };

  const resizeElement = (dw, dh) => {
    const el = slide.elements.find((item) => item.id === selected);
    if (!el) return;
    patchElement(el.id, { w: Math.max(el.w + dw, 60), h: Math.max(el.h + dh, 30) });
  };

  const addSlide = () => {
    const theme = THEMES.find((t) => t.id === deck.theme) || THEMES[0];
    const next = [...deck.slides, blankSlide(theme)];
    commit({ ...deck, slides: next });
    setActive(next.length - 1);
    setSelected(null);
  };

  const duplicateSlide = () => {
    const clone = { ...slide, id: `sl_${Math.random().toString(36).slice(2, 10)}`, elements: slide.elements.map((el) => ({ ...el, id: uid() })) };
    const next = [...deck.slides];
    next.splice(active + 1, 0, clone);
    commit({ ...deck, slides: next });
    setActive(active + 1);
  };

  const deleteSlide = () => {
    if (deck.slides.length <= 1) return;
    const next = deck.slides.filter((_, index) => index !== active);
    commit({ ...deck, slides: next });
    setActive(Math.max(active - 1, 0));
    setSelected(null);
  };

  const moveSlide = (delta) => {
    const target = active + delta;
    if (target < 0 || target >= deck.slides.length) return;
    const next = [...deck.slides];
    const [item] = next.splice(active, 1);
    next.splice(target, 0, item);
    commit({ ...deck, slides: next });
    setActive(target);
  };

  const applyTheme = (themeId) => {
    const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
    const slides = deck.slides.map((item) => ({
      ...item,
      background: theme.bg,
      elements: item.elements.map((el) => {
        if (el.type !== 'text') return el;
        return { ...el, color: el.role === 'title' ? theme.title : theme.body };
      }),
    }));
    commit({ ...deck, theme: theme.id, slides });
  };

  useImperativeHandle(
    editorRef,
    () => ({
      insertText(text) {
        if (selected) {
          const el = slide.elements.find((item) => item.id === selected);
          if (el?.type === 'text') {
            patchElement(selected, { text });
            return;
          }
        }
        const theme = THEMES.find((t) => t.id === deck.theme) || THEMES[0];
        patchSlide({
          elements: [
            ...slide.elements,
            { id: uid(), type: 'text', x: 120, y: 200, w: 900, h: 300, text, role: 'body', size: 22, color: theme.body, align: 'left' },
          ],
        });
      },
      replaceSelection(text) {
        this.insertText(text);
      },
      insertImage(src) {
        patchSlide({
          elements: [...slide.elements, { id: uid(), type: 'image', src, x: 120, y: 140, w: 560, h: 315 }],
        });
      },
      applyOutline(outline) {
        const theme = THEMES.find((t) => t.id === deck.theme) || THEMES[0];
        const slides = [{ ...blankSlide(theme), elements: [{ id: uid(), type: 'text', x: 96, y: 240, w: 1088, h: 180, text: outline.title || '未命名', role: 'title', size: 54, color: theme.title, bold: true, align: 'left' }] }];
        for (const item of outline.slides || []) {
          slides.push({
            id: `sl_${Math.random().toString(36).slice(2, 10)}`,
            background: theme.bg,
            notes: '',
            elements: [
              { id: uid(), type: 'text', x: 96, y: 72, w: 1088, h: 96, text: item.title || '章节', role: 'title', size: 38, color: theme.title, bold: true, align: 'left' },
              { id: uid(), type: 'text', x: 96, y: 200, w: 1088, h: 440, text: (item.bullets || []).map((b) => `• ${b}`).join('\n'), role: 'body', size: 22, color: theme.body, align: 'left' },
            ],
          });
        }
        const next = { ...deck, slides };
        commit(next);
        setActive(0);
      },
      getText() {
        return slide.elements
          .filter((el) => el.type === 'text')
          .map((el) => el.text)
          .join('\n');
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, slide, deck, active],
  );

  useEffect(() => {
    if (!registerSelection) return;
    registerSelection(() => {
      if (selected) {
        const el = slide.elements.find((item) => item.id === selected);
        if (el?.type === 'text') return el.text;
      }
      return slide.elements.filter((el) => el.type === 'text').map((el) => el.text).join('\n');
    });
  }, [registerSelection, selected, slide]);

  const theme = THEMES.find((t) => t.id === deck.theme) || THEMES[0];

  return (
    <div style={{ display: 'flex', minHeight: 0, flex: 1 }}>
      <div className="slide-strip">
        {deck.slides.map((item, index) => (
          <div
            key={item.id}
            className={`slide-thumb ${index === active ? 'active' : ''}`}
            onClick={() => {
              setActive(index);
              setSelected(null);
            }}
          >
            <span className="no">{index + 1}</span>
            <div
              style={{
                width: '100%',
                aspectRatio: `${deck.width} / ${deck.height}`,
                background: item.background,
                position: 'relative',
                transform: `scale(1)`,
                overflow: 'hidden',
              }}
            >
              {item.elements.slice(0, 12).map((el) => (
                <div
                  key={el.id}
                  style={{
                    position: 'absolute',
                    left: `${(el.x / deck.width) * 100}%`,
                    top: `${(el.y / deck.height) * 100}%`,
                    width: `${(el.w / deck.width) * 100}%`,
                    height: `${(el.h / deck.height) * 100}%`,
                    background: el.type === 'rect' ? el.fill : el.type === 'image' && el.src ? `url(${el.src}) center/cover` : 'transparent',
                    color: el.color,
                    fontSize: `${Math.max((el.size || 20) / 12, 4)}px`,
                    fontWeight: el.bold ? 700 : 400,
                    overflow: 'hidden',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.15,
                  }}
                >
                  {el.type === 'text' ? el.text : ''}
                </div>
              ))}
            </div>
          </div>
        ))}
        <button className="btn sm" onClick={addSlide}>＋ 新页</button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="toolbar" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', background: 'var(--bg-soft)' }}>
          <button className="tool" onClick={() => addElement('text')} title="文本框">T</button>
          <button className="tool" onClick={() => addElement('rect')} title="色块">▭</button>
          <button className="tool" onClick={() => addElement('table')} title="表格">▦</button>
          <div className="divider-v" />
          <button className="tool" onClick={() => moveElement(0, -10)} disabled={!selected}>↑</button>
          <button className="tool" onClick={() => moveElement(0, 10)} disabled={!selected}>↓</button>
          <button className="tool" onClick={() => moveElement(-10, 0)} disabled={!selected}>←</button>
          <button className="tool" onClick={() => moveElement(10, 0)} disabled={!selected}>→</button>
          <button className="tool" onClick={() => resizeElement(20, 0)} disabled={!selected}>宽+</button>
          <button className="tool" onClick={() => resizeElement(-20, 0)} disabled={!selected}>宽−</button>
          <button className="tool" onClick={() => resizeElement(0, 20)} disabled={!selected}>高+</button>
          <button className="tool" onClick={() => resizeElement(0, -20)} disabled={!selected}>高−</button>
          <button className="tool" onClick={removeElement} disabled={!selected}>删元素</button>
          <div className="divider-v" />
          <select className="select" style={{ width: 100, height: 30, padding: '0 8px' }} value={deck.theme} onChange={(e) => applyTheme(e.target.value)}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <div className="spacer" />
          <button className="tool" onClick={() => moveSlide(-1)} disabled={active === 0}>页↑</button>
          <button className="tool" onClick={() => moveSlide(1)} disabled={active === deck.slides.length - 1}>页↓</button>
          <button className="tool" onClick={duplicateSlide}>复制页</button>
          <button className="tool" onClick={deleteSlide} disabled={deck.slides.length <= 1}>删页</button>
        </div>

        <div className="slide-stage" ref={stageRef} onClick={() => setSelected(null)}>
          <div
            className="slide-canvas"
            style={{
              width: deck.width * scale,
              height: deck.height * scale,
              background: slide.background,
            }}
          >
            <div style={{ width: deck.width, height: deck.height, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
              {slide.elements.map((el) => (
                <div
                  key={el.id}
                  className={`slide-el ${selected === el.id ? 'selected' : ''}`}
                  style={{
                    left: el.x,
                    top: el.y,
                    width: el.w,
                    height: el.h,
                    background: el.type === 'rect' ? el.fill : undefined,
                    borderRadius: el.radius ? `${el.radius}px` : undefined,
                    cursor: 'move',
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelected(el.id);
                  }}
                >
                  {el.type === 'text' && (
                    <div
                      className="txt"
                      contentEditable
                      suppressContentEditableWarning
                      style={{
                        color: el.color,
                        fontSize: el.size,
                        fontWeight: el.bold ? 700 : 400,
                        textAlign: el.align || 'left',
                        fontStyle: el.italic ? 'italic' : 'normal',
                      }}
                      onBlur={(event) => patchElement(el.id, { text: event.currentTarget.innerText })}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {el.text}
                    </div>
                  )}
                  {el.type === 'image' && el.src && (
                    <img src={el.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
                  )}
                  {el.type === 'image' && !el.src && (
                    <div style={{ display: 'grid', placeItems: 'center', height: '100%', background: '#1e293b', color: '#94a3b8', fontSize: 14 }}>
                      从素材库插入图片
                    </div>
                  )}
                  {el.type === 'table' && (
                    <table style={{ width: '100%', height: '100%', borderCollapse: 'collapse', color: theme.body, fontSize: 14 }}>
                      <tbody>
                        {(el.rows || []).map((row, r) => (
                          <tr key={r}>
                            {row.map((cellText, c) => (
                              <td key={c} style={{ border: '1px solid #334155', padding: '4px 8px' }}>{cellText}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: '8px 12px', background: 'var(--bg-soft)' }}>
          <div className="row">
            <span className="small muted">第 {active + 1} / {deck.slides.length} 页</span>
            <div className="spacer" />
            <input
              className="input"
              style={{ maxWidth: 520 }}
              placeholder="演讲备注（可选）"
              value={slide.notes || ''}
              onChange={(e) => patchSlide({ notes: e.target.value })}
            />
          </div>
          {selected && (
            <div className="row wrap" style={{ marginTop: 8 }}>
              <span className="small muted">选中元素</span>
              <label className="small muted">字号
                <input
                  className="input"
                  type="number"
                  style={{ width: 72, marginLeft: 6 }}
                  value={slide.elements.find((el) => el.id === selected)?.size || 20}
                  onChange={(e) => patchElement(selected, { size: Number(e.target.value) || 20 })}
                />
              </label>
              <label className="small muted">颜色
                <input
                  type="color"
                  style={{ width: 40, marginLeft: 6, background: 'transparent', border: 'none' }}
                  value={slide.elements.find((el) => el.id === selected)?.color || '#ffffff'}
                  onChange={(e) => patchElement(selected, { color: e.target.value })}
                />
              </label>
              <button
                className="btn sm"
                onClick={() => {
                  const el = slide.elements.find((item) => item.id === selected);
                  patchElement(selected, { bold: !el?.bold });
                }}
              >
                加粗
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { THEMES, normalize as normalizeDeck };
