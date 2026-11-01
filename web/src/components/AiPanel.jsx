import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';

const TASKS = [
  { id: 'polish', label: '润色' },
  { id: 'summarize', label: '摘要' },
  { id: 'expand', label: '扩写' },
  { id: 'translate', label: '翻译' },
  { id: 'formula', label: '公式' },
  { id: 'analyze', label: '分析' },
];

export function AiPanel({ kind, getSelection, onInsert, onOutline }) {
  const { user, quota, refresh } = useSession();
  const toast = useToast();
  const [task, setTask] = useState(kind === 'xlsx' ? 'formula' : 'polish');
  const [text, setText] = useState('');
  const [extra, setExtra] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState('');
  const [pages, setPages] = useState(8);
  const [outlineBusy, setOutlineBusy] = useState(false);

  useEffect(() => {
    setTask(kind === 'xlsx' ? 'formula' : 'polish');
  }, [kind]);

  const enabled = Boolean(user) && quota?.chat?.limit !== 0;

  const pullSelection = useCallback(() => {
    try {
      const value = getSelection?.();
      if (value) {
        setText(value);
        return;
      }
      toast.info('没有选中内容，请先在文档里选择一段文字');
    } catch (error) {
      toast.error(error.message);
    }
  }, [getSelection, toast]);

  const run = async () => {
    if (!text.trim()) {
      toast.error('请先填入或选中内容');
      return;
    }
    setBusy(true);
    setOutput('');
    try {
      const data = await api.post('/api/ai/chat', { task, text, extra });
      setOutput(data.content);
      refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const runOutline = async () => {
    if (!topic.trim()) {
      toast.error('请填写演示主题');
      return;
    }
    setOutlineBusy(true);
    try {
      const data = await api.post('/api/ai/outline', { topic, pages });
      refresh();
      if (onOutline) {
        onOutline(data.outline);
        toast.success(`已生成 ${data.outline.slides.length + 1} 页幻灯片${data.repaired ? '（已修复格式）' : ''}`);
      } else {
        setOutput(JSON.stringify(data.outline, null, 2));
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setOutlineBusy(false);
    }
  };

  return (
    <div>
      {kind === 'pptx' && (
        <div className="ai-block">
          <div className="row">
            <strong style={{ fontSize: 13.5 }}>AI 生成整套幻灯片</strong>
          </div>
          <textarea
            className="textarea"
            style={{ minHeight: 80 }}
            placeholder="主题，例如：给团队做一次在线办公工具培训"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <div className="row">
            <span className="small muted">页数</span>
            <input
              className="input"
              type="number"
              min="3"
              max="20"
              style={{ width: 80 }}
              value={pages}
              onChange={(e) => setPages(Number(e.target.value) || 8)}
            />
            <div className="spacer" />
            <button className="btn sm primary" onClick={runOutline} disabled={!enabled || outlineBusy}>
              {outlineBusy ? '生成中…' : '生成大纲并应用'}
            </button>
          </div>
          {!user && <div className="small muted">登录并获授权后可用。</div>}
        </div>
      )}

      <div className="ai-block">
        <div className="row">
          <strong style={{ fontSize: 13.5 }}>文本处理</strong>
          <div className="spacer" />
          {quota && (
            <span className="small muted">
              {quota.chat.used}
              {quota.chat.limit < 0 ? '/∞' : `/${quota.chat.limit}`}
            </span>
          )}
        </div>
        <div className="ai-chips">
          {TASKS.map((item) => (
            <button key={item.id} className={`chip ${task === item.id ? 'active' : ''}`} onClick={() => setTask(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn sm" onClick={pullSelection} disabled={!getSelection}>
            取选中内容
          </button>
          <span className="small muted">{text.length} 字</span>
        </div>
        <textarea
          className="textarea"
          style={{ minHeight: 110 }}
          placeholder="把要处理的内容粘进来，或点「取选中内容」"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input className="input" placeholder="补充要求（可选）" value={extra} onChange={(e) => setExtra(e.target.value)} />
        <button className="btn primary block" onClick={run} disabled={!enabled || busy}>
          {busy ? '处理中…' : `执行${TASKS.find((t) => t.id === task)?.label || ''}`}
        </button>
        {!user && <div className="small muted">登录并获授权后可用 AI。</div>}
        {user && quota?.chat?.limit === 0 && <div className="small muted">当前账号未开通 AI，请联系管理员。</div>}
      </div>

      {output && (
        <div className="ai-block">
          <div className="row">
            <strong style={{ fontSize: 13 }}>结果</strong>
            <div className="spacer" />
            <button
              className="btn sm ghost"
              onClick={() => navigator.clipboard.writeText(output).then(() => toast.success('已复制'))}
            >
              复制
            </button>
            {onInsert && (
              <button className="btn sm primary" onClick={() => onInsert(output)}>
                插入
              </button>
            )}
          </div>
          <div className="ai-out">{output}</div>
        </div>
      )}
    </div>
  );
}

export function AssetPanel({ onPick, kind = 'image' }) {
  const { user, quota } = useSession();
  const toast = useToast();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/assets?limit=36');
      setAssets(data.assets.filter((asset) => !kind || asset.kind === kind));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [kind, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    if (!prompt.trim()) {
      toast.error('请填写生图提示词');
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/ai/image', { prompt, size: '16:9', count: 1 });
      setPrompt('');
      await load();
      toast.success('已生成并加入素材库');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const canGenerate = Boolean(user) && quota?.image?.limit !== 0;

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13.5 }}>素材库</strong>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={load} disabled={loading}>
          刷新
        </button>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input
          className="input"
          placeholder="AI 生图提示词"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canGenerate && generate()}
          disabled={!canGenerate}
        />
        <button className="btn sm" onClick={generate} disabled={!canGenerate || loading}>
          生成
        </button>
      </div>
      {assets.length === 0 && !loading && <div className="empty">暂无素材</div>}
      <div className="asset-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
        {assets.map((asset) => (
          <button
            key={asset.id}
            className="asset-card"
            style={{ padding: 0, cursor: 'pointer', textAlign: 'left' }}
            onClick={() => onPick?.(asset)}
            title={asset.title}
          >
            <img src={asset.thumbUrl} alt={asset.title} loading="lazy" />
            <div className="cap">
              <div className="t">{asset.title}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
