import React, { useCallback, useEffect, useState } from 'react';
import { api, formatBytes } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';

const SIZES = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

export default function AssetsPage() {
  const { user, quota, refresh } = useSession();
  const toast = useToast();
  const [assets, setAssets] = useState([]);
  const [tags, setTags] = useState([]);
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('16:9');
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '24' });
      if (tag) params.set('tag', tag);
      if (query) params.set('q', query);
      if (mine) params.set('mine', '1');
      const data = await api.get(`/api/assets?${params.toString()}`);
      setAssets(data.assets);
      setPages(data.pages);
      setTags(data.tags);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }, [page, tag, query, mine, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (!user) {
      toast.error('上传素材需要先登录');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      files.slice(0, 12).forEach((file) => form.append('file', file));
      const data = await api.upload('/api/assets', form);
      toast.success(`已上传 ${data.assets.length} 张素材`);
      setPage(1);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    setGenBusy(true);
    try {
      const data = await api.post('/api/ai/image', { prompt, size, count: 1 });
      toast.success(`生成完成（${Math.round(data.latencyMs / 1000)}s）`);
      setPrompt('');
      setPage(1);
      await load();
      refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setGenBusy(false);
    }
  };

  const remove = async (asset) => {
    if (!window.confirm(`删除素材「${asset.title}」？`)) return;
    try {
      await api.del(`/api/assets/${asset.id}`);
      setAssets((list) => list.filter((item) => item.id !== asset.id));
    } catch (error) {
      toast.error(error.message);
    }
  };

  const rename = async (asset) => {
    const title = window.prompt('素材名称', asset.title);
    if (!title) return;
    const tagsInput = window.prompt('标签（逗号分隔）', asset.tags.join(','));
    try {
      const data = await api.patch(`/api/assets/${asset.id}`, { title, tags: tagsInput ?? '' });
      setAssets((list) => list.map((item) => (item.id === asset.id ? data.asset : item)));
    } catch (error) {
      toast.error(error.message);
    }
  };

  const copyMarkdown = async (asset) => {
    const text = `![${asset.title}](${window.location.origin}${asset.url})`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制 Markdown 引用');
    } catch {
      toast.error('浏览器拒绝了剪贴板访问');
    }
  };

  const canGenerate = Boolean(user) && quota?.image?.limit !== 0;

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>素材库</h1>
        <span className="small muted">图片随取随用，可直接插入文档、表格与幻灯片</span>
        <div className="spacer" />
        {quota && (
          <span className="badge">
            今日生图 {quota.image.used}
            {quota.image.limit < 0 ? ' / ∞' : ` / ${quota.image.limit}`}
          </span>
        )}
        <label className="btn sm">
          上传图片
          <input type="file" accept="image/*" multiple hidden onChange={upload} />
        </label>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 18 }}>
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 14 }}>AI 生图</strong>
          <span className="small muted">提示词越具体越好；生成结果会自动进入素材库</span>
        </div>
        <div className="row wrap">
          <input
            className="input"
            style={{ flex: 1, minWidth: 240 }}
            placeholder="例如：深色科技感的办公协作插画，扁平风格，蓝紫配色"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canGenerate && !genBusy && generate()}
            disabled={!canGenerate}
          />
          <select className="select" style={{ width: 110 }} value={size} onChange={(e) => setSize(e.target.value)} disabled={!canGenerate}>
            {SIZES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button className="btn primary" onClick={generate} disabled={!canGenerate || genBusy}>
            {genBusy ? '生成中…' : '生成'}
          </button>
        </div>
        {!user && <div className="small muted" style={{ marginTop: 8 }}>登录并获授权后才能调用生图。</div>}
        {user && quota?.image?.limit === 0 && (
          <div className="small muted" style={{ marginTop: 8 }}>
            当前账号未开通 AI 生图，请联系管理员在后台调整权限。
          </div>
        )}
      </div>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ maxWidth: 220 }}
          placeholder="搜索素材…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <button className={`chip ${mine ? 'active' : ''}`} onClick={() => { setMine(!mine); setPage(1); }}>
          只看我的
        </button>
        <button className={`chip ${tag === '' ? 'active' : ''}`} onClick={() => { setTag(''); setPage(1); }}>
          全部标签
        </button>
        {tags.map((item) => (
          <button
            key={item.name}
            className={`chip ${tag === item.name ? 'active' : ''}`}
            onClick={() => {
              setTag(item.name === tag ? '' : item.name);
              setPage(1);
            }}
          >
            {item.name} {item.count}
          </button>
        ))}
        <div className="spacer" />
        <span className="small muted">{busy ? '加载中…' : `第 ${page} / ${pages} 页`}</span>
      </div>

      {assets.length === 0 && !busy ? (
        <div className="empty">素材库还是空的，上传图片或用 AI 生成第一张。</div>
      ) : (
        <div className="asset-grid">
          {assets.map((asset) => (
            <div key={asset.id} className="asset-card">
              <img src={asset.thumbUrl} alt={asset.title} loading="lazy" />
              <div className="cap">
                <div className="t" title={asset.title}>{asset.title}</div>
                <div className="small muted">
                  {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}
                  {formatBytes(asset.size)}
                  {asset.source === 'ai' ? ' · AI' : ''}
                </div>
              </div>
              <div className="acts">
                <button className="btn sm" onClick={() => copyMarkdown(asset)} title="复制 Markdown">
                  MD
                </button>
                {asset.owned && (
                  <>
                    <button className="btn sm" onClick={() => rename(asset)} title="编辑">
                      改
                    </button>
                    <button className="btn sm danger" onClick={() => remove(asset)} title="删除">
                      删
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 16, justifyContent: 'center' }}>
        <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          下一页
        </button>
      </div>
    </div>
  );
}
