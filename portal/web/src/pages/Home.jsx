import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatBytes, formatTime, KIND_META } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { navigate } from '../lib/router.js';

const KINDS = ['docx', 'xlsx', 'pptx', 'pdf'];

export default function HomePage() {
  const { user, models, stats, refresh } = useSession();
  const toast = useToast();
  const [documents, setDocuments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [docData, tplData] = await Promise.all([api.get('/api/documents'), api.get('/api/templates?limit=6')]);
      setDocuments(docData.documents);
      setTemplates(tplData.templates.slice(0, 6));
    } catch (error) {
      toast.error(error.message);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const createDoc = async (kind) => {
    setBusy(true);
    try {
      const data = await api.post('/api/documents', { kind });
      navigate(`/editor/${data.document.id}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const createFromTemplate = async (tpl) => {
    setBusy(true);
    try {
      const data = await api.post('/api/documents', { kind: tpl.kind, title: tpl.title, template: tpl.slug });
      navigate(`/editor/${data.document.id}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name.replace(/\.[^.]+$/, ''));
      const data = await api.upload('/api/documents/import', form);
      toast.success(`已导入《${data.document.title}》`);
      refresh();
      navigate(`/editor/${data.document.id}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const removeDoc = async (doc) => {
    if (!window.confirm(`删除《${doc.title}》？`)) return;
    try {
      await api.del(`/api/documents/${doc.id}`);
      setDocuments((list) => list.filter((item) => item.id !== doc.id));
      toast.success('已删除');
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="stack" style={{ gap: 0 }}>
      <section className="hero">
        <div className="card hero-card">
          <h1>四件套在线编辑，素材与 AI 一起用</h1>
          <p className="lead">
            直接打开 Word、Excel、PPT、PDF，素材库随时取图，内置模型可润色、出大纲、生成配图。
            {!user && ' 游客也能编辑与下载，登录后文件会保存到账号里。'}
          </p>
          <div className="quick-grid">
            {KINDS.map((kind) => (
              <button key={kind} className="quick-card" onClick={() => createDoc(kind)} disabled={busy}>
                <div className="k" style={{ color: KIND_META[kind].color }}>
                  {KIND_META[kind].ext}
                </div>
                <div className="t">新建{KIND_META[kind].label}</div>
                <div className="d">
                  {kind === 'docx' && '排版写作 · 导入导出 DOCX'}
                  {kind === 'xlsx' && '公式表格 · 导入导出 XLSX'}
                  {kind === 'pptx' && '幻灯片 · 导入导出 PPTX'}
                  {kind === 'pdf' && '查看处理 · 合并拆分水印'}
                </div>
              </button>
            ))}
          </div>
          <div className="row wrap" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}>
              导入本地文件
            </button>
            <button className="btn" onClick={() => navigate('/templates')}>
              浏览模板库
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".docx,.xlsx,.pptx,.pdf"
              style={{ display: 'none' }}
              onChange={onUpload}
            />
            {busy && <span className="small muted">处理中…</span>}
          </div>
        </div>

        <div className="card hero-card">
          <div className="row">
            <h2 style={{ margin: 0, fontSize: 16 }}>内置能力</h2>
            <div className="spacer" />
            <span className={`badge ${models?.healthy ? 'ok' : 'warn'}`}>
              {models?.healthy ? '模型在线' : '模型未连通'}
            </span>
          </div>
          <div className="stack" style={{ marginTop: 14, gap: 10 }}>
            {(models?.models || []).map((model) => (
              <div key={model.id} className="row" style={{ alignItems: 'flex-start' }}>
                <span className="badge">{model.kind === 'image' ? '生图' : '文本'}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{model.label}</div>
                  <div className="small muted">{model.note}</div>
                </div>
              </div>
            ))}
            {!models?.models?.length && <div className="muted small">尚未获取模型列表。</div>}
            <div className="small muted">
              素材库 {stats?.assets ?? 0} 张 · 模板 {stats?.templates ?? 0} 套 · 我的文档 {documents.length} 份
            </div>
            {!user && (
              <div className="badge warn" style={{ justifySelf: 'start' }}>
                AI 能力需要登录并由管理员授权
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="section-title">
        <h2>最近文档</h2>
        <div className="line" />
        <span className="small muted">{user ? '已同步到你的账号' : '游客模式：换设备或清 Cookie 后会丢失'}</span>
      </div>
      {documents.length === 0 ? (
        <div className="empty">还没有文档，点上面的卡片新建一份。</div>
      ) : (
        <div className="doc-list">
          {documents.map((doc) => (
            <div key={doc.id} className="doc-item" onClick={() => navigate(`/editor/${doc.id}`)} role="button" tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/editor/${doc.id}`)}>
              <div className="kind-chip" style={{ background: KIND_META[doc.kind]?.color || '#334155' }}>
                {KIND_META[doc.kind]?.icon || '?'}
              </div>
              <div className="meta" style={{ flex: 1 }}>
                <div className="name">{doc.title}</div>
                <div className="sub">
                  {KIND_META[doc.kind]?.ext} · {formatBytes(doc.size)} · 更新于 {formatTime(doc.updatedAt)}
                </div>
              </div>
              <button
                className="btn sm danger"
                onClick={(e) => {
                  e.stopPropagation();
                  removeDoc(doc);
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">
        <h2>模板速用</h2>
        <div className="line" />
        <button className="btn sm" onClick={() => navigate('/templates')}>
          全部模板
        </button>
      </div>
      <div className="template-grid">
        {templates.map((tpl) => (
          <div key={tpl.id} className="template-card">
            <div className="head">
              <div className="kind-chip" style={{ width: 26, height: 26, fontSize: 11, background: KIND_META[tpl.kind]?.color }}>
                {KIND_META[tpl.kind]?.icon}
              </div>
              <strong style={{ fontSize: 13.5 }}>{tpl.title}</strong>
            </div>
            <div className="preview">{tpl.preview}</div>
            <div className="row">
              <button className="btn sm primary" onClick={() => createFromTemplate(tpl)} disabled={busy}>
                用它新建
              </button>
              <a className="btn sm ghost" href={tpl.downloadUrl}>
                下载
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
