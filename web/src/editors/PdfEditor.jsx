import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { api } from '../lib/api.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PAGE_OPS = [
  { id: 'rotate', label: '旋转 90°' },
  { id: 'delete', label: '删除页' },
  { id: 'extract', label: '提取页' },
];

export default function PdfEditor({ doc, model, onChange, registerSelection, editorRef }) {
  const [info, setInfo] = useState(model?.info || null);
  const [pdf, setPdf] = useState(null);
  const [zoom, setZoom] = useState(1.1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pageRange, setPageRange] = useState('1');
  const [watermark, setWatermark] = useState('内部资料');
  const [opacity, setOpacity] = useState(0.16);
  const [version, setVersion] = useState(0);
  const containerRef = useRef(null);
  const renderedRef = useRef(new Set());

  const load = useCallback(async () => {
    try {
      setError('');
      // 加 ?v= 破坏浏览器缓存：页操作后同一个 URL 会返回新的字节
      const task = pdfjs.getDocument({ url: `/api/documents/${doc.id}/raw?v=${version}`, withCredentials: true });
      const instance = await task.promise;
      setPdf(instance);
      renderedRef.current = new Set();
    } catch (err) {
      setError(err?.message || 'PDF 加载失败');
    }
  }, [doc.id, version]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!pdf || !containerRef.current) return;
    let cancelled = false;
    const render = async () => {
      const host = containerRef.current;
      if (!host) return;
      host.innerHTML = '';
      for (let index = 1; index <= pdf.numPages; index += 1) {
        if (cancelled) return;
        const page = await pdf.getPage(index);
        const viewport = page.getViewport({ scale: zoom });
        const wrap = document.createElement('div');
        wrap.className = 'pdf-page-wrap';
        wrap.dataset.page = String(index);
        const canvas = document.createElement('canvas');
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        wrap.appendChild(canvas);
        const label = document.createElement('div');
        label.className = 'pdf-page-no';
        label.textContent = `${index} / ${pdf.numPages}`;
        wrap.appendChild(label);
        host.appendChild(wrap);
        const context = canvas.getContext('2d');
        context.scale(ratio, ratio);
        await page.render({ canvasContext: context, viewport, canvas }).promise;
      }
    };
    render();
    return () => {
      cancelled = true;
    };
  }, [pdf, zoom]);

  useEffect(() => {
    if (!registerSelection) return;
    registerSelection(() => {
      const text = window.getSelection()?.toString() || '';
      return text.trim();
    });
  }, [registerSelection]);

  const runOp = async (ops, label) => {
    setBusy(true);
    try {
      const data = await api.post(`/api/documents/${doc.id}/pdf-ops`, { ops });
      setInfo(data.info);
      setVersion((v) => v + 1);
      onChange?.(data.info);
      if (label) window.setTimeout(() => {}, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useImperativeHandle(
    editorRef,
    () => ({
      insertText() {},
      replaceSelection() {},
      rotate() {
        runOp({ rotate: { pages: pageRange, angle: 90 } });
      },
      removePages() {
        runOp({ delete: pageRange });
      },
      extractPages() {
        runOp({ extract: pageRange });
      },
      watermark() {
        runOp({ watermark: { text: watermark, opacity: Number(opacity) || 0.16 } });
      },
      getText() {
        return `PDF ${info?.pageCount || 0} 页`;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageRange, watermark, opacity, info],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div className="toolbar" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', background: 'var(--bg-soft)' }}>
        <span className="small muted">缩放</span>
        <button className="tool" onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}>−</button>
        <span className="small" style={{ minWidth: 46, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="tool" onClick={() => setZoom((z) => Math.min(z + 0.15, 3))}>＋</button>
        <div className="divider-v" />
        <span className="small muted">页范围</span>
        <input className="input" style={{ width: 120 }} value={pageRange} onChange={(e) => setPageRange(e.target.value)} placeholder="1-3,5" />
        <button className="tool" onClick={() => runOp({ rotate: { pages: pageRange, angle: 90 } })} disabled={busy}>旋转</button>
        <button className="tool" onClick={() => runOp({ delete: pageRange })} disabled={busy}>删除</button>
        <button className="tool" onClick={() => runOp({ extract: pageRange })} disabled={busy}>提取</button>
        <div className="divider-v" />
        <input className="input" style={{ width: 140 }} value={watermark} onChange={(e) => setWatermark(e.target.value)} placeholder="水印文字" />
        <input
          className="input"
          type="number"
          step="0.02"
          min="0.02"
          max="0.9"
          style={{ width: 76 }}
          value={opacity}
          onChange={(e) => setOpacity(e.target.value)}
        />
        <button className="tool" onClick={() => runOp({ watermark: { text: watermark, opacity: Number(opacity) || 0.16 } })} disabled={busy}>
          加水印
        </button>
        <div className="spacer" />
        <span className="small muted">{info ? `${info.pageCount} 页 · ${info.width}×${info.height}` : ''}</span>
      </div>

      {error && <div className="badge danger" style={{ margin: 12 }}>{error}</div>}
      <div className="pdf-stage" ref={containerRef} style={{ minHeight: 200 }}>
        {!pdf && !error && <div className="muted">正在渲染 PDF…</div>}
      </div>
    </div>
  );
}
