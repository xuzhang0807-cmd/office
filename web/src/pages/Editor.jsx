import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, KIND_META } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { navigate } from '../lib/router.js';
import DocxEditor from '../editors/DocxEditor.jsx';
import XlsxEditor from '../editors/XlsxEditor.jsx';
import PptxEditor from '../editors/PptxEditor.jsx';
import PdfEditor from '../editors/PdfEditor.jsx';
import { AiPanel, AssetPanel } from '../components/AiPanel.jsx';
import { recalcSheet } from '../lib/formula.js';

const AUTOSAVE_MS = 1500;

/** 导出 PDF 前把公式结果写进模型，避免 pdf 里出现空白公式格。 */
function recalcModel(model) {
  if (!model || !Array.isArray(model.sheets)) return model;
  return { ...model, sheets: model.sheets.map((sheet) => recalcSheet(sheet)) };
}

export default function EditorPage({ id }) {
  const toast = useToast();
  const { user, site } = useSession();
  const [doc, setDoc] = useState(null);
  const [model, setModel] = useState(null);
  const [status, setStatus] = useState('loading');
  const [tab, setTab] = useState('ai');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [sideOpen, setSideOpen] = useState(true);
  const editorRef = useRef(null);
  const selectionRef = useRef(() => '');
  const pendingRef = useRef(null);
  const timerRef = useRef(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.get(`/api/documents/${id}`);
        if (!alive) return;
        setDoc(data.document);
        setTitle(data.document.title);
        setModel(data.model);
        setStatus('ready');
      } catch (err) {
        if (!alive) return;
        setError(err.message);
        setStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const flush = useCallback(async () => {
    if (!pendingRef.current) return;
    const payload = pendingRef.current;
    pendingRef.current = null;
    setSaving(true);
    try {
      const data = await api.put(`/api/documents/${id}`, { model: payload.model, title: payload.title });
      setLastSaved(data.savedAt);
      dirtyRef.current = false;
    } catch (err) {
      pendingRef.current = payload;
      toast.error(`保存失败：${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [id, toast]);

  const scheduleSave = useCallback(
    (nextModel, nextTitle) => {
      pendingRef.current = { model: nextModel, title: nextTitle };
      dirtyRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        flush();
      }, AUTOSAVE_MS);
    },
    [flush],
  );

  useEffect(() => {
    const beforeUnload = (event) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onModelChange = useCallback(
    (next) => {
      setModel(next);
      scheduleSave(next, title);
    },
    [scheduleSave, title],
  );

  const saveNow = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!pendingRef.current && model) pendingRef.current = { model, title };
    await flush();
    toast.success('已保存');
  };

  const renameDoc = async () => {
    const next = window.prompt('文档名称', title);
    if (!next || next === title) return;
    setTitle(next);
    try {
      await api.post(`/api/documents/${id}/rename`, { title: next });
      setDoc((d) => ({ ...d, title: next }));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const exportFile = async (format) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pendingRef.current) await flush();
    try {
      // 导出前先把模型里的公式重算一遍，PDF 才能拿到数值而不是空白
      const payload = format === 'pdf' && doc?.kind === 'xlsx' ? recalcModel(model) : model;
      await api.download(`/api/documents/${id}/export`, { format, model: payload, filename: title }, `${title}.${format}`);
      toast.success('导出已开始');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const insertFromAi = (text) => {
    editorRef.current?.insertText?.(text);
    toast.success('已插入到文档');
  };

  const insertImage = (asset) => {
    if (doc?.kind === 'docx') {
      editorRef.current?.insertImage?.(window.location.origin + asset.url, asset.title);
    } else if (doc?.kind === 'pptx') {
      editorRef.current?.insertImage?.(window.location.origin + asset.url);
    } else {
      toast.info('该文件类型暂不支持插入图片');
      return;
    }
    toast.success('已插入素材');
  };

  const applyOutline = (outline) => {
    if (doc?.kind === 'pptx') {
      editorRef.current?.applyOutline?.(outline);
    }
  };

  const registerSelection = useCallback((fn) => {
    selectionRef.current = fn;
  }, []);

  const getSelection = useCallback(() => selectionRef.current?.() || '', []);

  const kinds = useMemo(() => (doc ? KIND_META[doc.kind] : null), [doc]);

  if (status === 'loading') {
    return <div className="auth-wrap"><div className="muted">正在打开文档…</div></div>;
  }

  if (status === 'error') {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h3 style={{ marginTop: 0 }}>无法打开</h3>
          <p className="muted small">{error}</p>
          <button className="btn primary block" onClick={() => navigate('/')}>回到工作台</button>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-shell">
      <div className="editor-top">
        <button className="btn sm ghost" onClick={() => navigate('/')}>← 返回</button>
        <div className="kind-chip" style={{ width: 26, height: 26, fontSize: 11, background: kinds?.color }}>{kinds?.icon}</div>
        <button className="btn sm ghost" onClick={renameDoc} title="点击重命名">
          <strong>{title}</strong>
        </button>
        <span className="badge">
          {saving ? '保存中…' : lastSaved ? `已保存 ${new Date(lastSaved).toLocaleTimeString()}` : '未修改'}
        </span>
        <div className="spacer" />
        <button className="btn sm" onClick={saveNow}>保存</button>
        <button className="btn sm primary" onClick={() => exportFile(doc.kind)}>
          导出 {KIND_META[doc.kind]?.ext}
        </button>
        {doc.kind === 'docx' && (
          <button className="btn sm" onClick={() => exportFile('txt')}>导出 TXT</button>
        )}
        {doc.kind === 'xlsx' && (
          <button className="btn sm" onClick={() => exportFile('csv')}>导出 CSV</button>
        )}
        {doc.kind !== 'pdf' && (
          <button className="btn sm" onClick={() => exportFile('pdf')} title="按当前内容排版成 PDF">
            导出 PDF
          </button>
        )}
        {doc.kind === 'pdf' && (
          <a className="btn sm" href={`/api/documents/${id}/raw`} target="_blank" rel="noreferrer">原始 PDF</a>
        )}
        <button className="btn sm ghost" onClick={() => setSideOpen((v) => !v)}>
          {sideOpen ? '收起侧栏' : '展开侧栏'}
        </button>
      </div>

      <div className="editor-body">
        <div className="editor-main">
          {doc.kind === 'docx' && (
            <DocxEditor model={model} onChange={onModelChange} registerSelection={registerSelection} editorRef={editorRef} />
          )}
          {doc.kind === 'xlsx' && (
            <XlsxEditor model={model} onChange={onModelChange} registerSelection={registerSelection} editorRef={editorRef} />
          )}
          {doc.kind === 'pptx' && (
            <PptxEditor model={model} onChange={onModelChange} registerSelection={registerSelection} editorRef={editorRef} />
          )}
          {doc.kind === 'pdf' && (
            <PdfEditor doc={doc} model={model} onChange={onModelChange} registerSelection={registerSelection} editorRef={editorRef} />
          )}
        </div>

        {sideOpen && (
          <aside className="editor-side">
            <div className="side-tabs">
              <button className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}>AI 助手</button>
              <button className={tab === 'assets' ? 'active' : ''} onClick={() => setTab('assets')}>素材</button>
              <button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>信息</button>
            </div>
            <div className="side-panel">
              {tab === 'ai' && (
                <AiPanel
                  kind={doc.kind}
                  getSelection={getSelection}
                  onInsert={doc.kind === 'pdf' ? undefined : insertFromAi}
                  onOutline={applyOutline}
                />
              )}
              {tab === 'assets' && <AssetPanel onPick={insertImage} />}
              {tab === 'info' && (
                <div className="stack small">
                  <div><span className="muted">类型：</span>{KIND_META[doc.kind]?.label}</div>
                  <div><span className="muted">创建：</span>{new Date(doc.createdAt).toLocaleString()}</div>
                  <div><span className="muted">更新：</span>{new Date(doc.updatedAt).toLocaleString()}</div>
                  <div><span className="muted">来源：</span>{doc.source}</div>
                  <div><span className="muted">站点：</span>{site?.name}</div>
                  <div className="muted" style={{ marginTop: 8 }}>
                    {user ? '文档已归属你的账号。' : '游客文档存在浏览器 Cookie 里，清理后会丢失，建议登录。'}
                  </div>
                  <button className="btn sm" onClick={() => exportFile(doc.kind)}>下载副本</button>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
