import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, KIND_META } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { navigate } from '../lib/router.js';

const KIND_FILTERS = [
  { value: '', label: '全部' },
  { value: 'docx', label: '文档' },
  { value: 'xlsx', label: '表格' },
  { value: 'pptx', label: '演示' },
  { value: 'pdf', label: 'PDF' },
];

export default function TemplatesPage() {
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/templates');
      setTemplates(data.templates);
    } catch (error) {
      toast.error(error.message);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      templates.filter((tpl) => {
        if (kind && tpl.kind !== kind) return false;
        if (!query) return true;
        const hay = `${tpl.title} ${tpl.description} ${tpl.tags.join(' ')}`.toLowerCase();
        return hay.includes(query.toLowerCase());
      }),
    [templates, kind, query],
  );

  const useTemplate = async (tpl) => {
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

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>模板库</h1>
        <span className="small muted">全部为可编辑的 docx / xlsx / pptx / pdf 实体文件</span>
        <div className="spacer" />
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="搜索模板…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        {KIND_FILTERS.map((item) => (
          <button
            key={item.value}
            className={`chip ${kind === item.value ? 'active' : ''}`}
            onClick={() => setKind(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="empty">没有匹配的模板。</div>
      ) : (
        <div className="template-grid">
          {filtered.map((tpl) => (
            <div key={tpl.id} className="template-card">
              <div className="head">
                <div
                  className="kind-chip"
                  style={{ width: 28, height: 28, fontSize: 11.5, background: KIND_META[tpl.kind]?.color }}
                >
                  {KIND_META[tpl.kind]?.icon}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{tpl.title}</div>
                  <div className="small muted">
                    {KIND_META[tpl.kind]?.ext} · {tpl.category}
                    {tpl.featured ? ' · 推荐' : ''}
                  </div>
                </div>
              </div>
              <div className="desc">{tpl.description}</div>
              <div className="preview">{tpl.preview}</div>
              <div className="row wrap">
                <button className="btn sm primary" onClick={() => useTemplate(tpl)} disabled={busy}>
                  在线编辑
                </button>
                <a className="btn sm" href={tpl.downloadUrl}>
                  下载
                </a>
                <span className="small muted">已用 {tpl.downloads} 次</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
