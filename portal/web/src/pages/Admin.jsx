import React, { useCallback, useEffect, useState } from 'react';
import { api, formatBytes } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { navigate } from '../lib/router.js';

export default function AdminPage() {
  const { isAdmin, user } = useSession();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const overview = await api.get('/api/admin/overview');
      setData(overview);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h3 style={{ marginTop: 0 }}>需要管理员权限</h3>
          <p className="muted small">当前账号：{user?.email || '未登录'}。首个注册账号自动成为管理员。</p>
          <button className="btn primary block" onClick={() => navigate('/login')}>去登录</button>
        </div>
      </div>
    );
  }

  const updateUser = async (target, patch) => {
    try {
      await api.patch(`/api/admin/users/${target.id}`, patch);
      toast.success('已更新');
      load();
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>管理后台</h1>
        <div className="spacer" />
        <button className="btn sm" onClick={load} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
      </div>

      {data && (
        <>
          <div className="quick-grid" style={{ marginBottom: 20 }}>
            <div className="card" style={{ padding: 14 }}>
              <div className="small muted">用户</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.stats.users}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="small muted">文档</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.stats.documents}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="small muted">素材</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.stats.assets}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="small muted">AI 调用 / 今日</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.stats.aiCalls} / {data.stats.aiToday}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="small muted">存储</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{formatBytes(data.storage.bytes)}</div>
            </div>
          </div>

          <div className="section-title"><h2>能力服务</h2><div className="line" /></div>
          <div className="card" style={{ padding: 14, marginBottom: 20 }}>
            <div className="small muted" style={{ marginBottom: 10 }}>
              每个能力都是独立进程/容器，可以单独重启或换实现；门户只通过 HTTP 调用。
            </div>
            <div className="quick-grid" style={{ gap: 10 }}>
              {(data.services || []).map((service) => (
                <div
                  key={service.name}
                  className="card"
                  style={{ padding: 12, borderColor: service.up ? '#164e3c' : '#4a2230' }}
                >
                  <div className="row">
                    <strong style={{ fontSize: 14 }}>{service.name.toUpperCase()}</strong>
                    <div className="spacer" />
                    <span className={`badge ${service.up ? 'ok' : 'danger'}`}>{service.up ? '在线' : '离线'}</span>
                  </div>
                  <div className="small muted" style={{ marginTop: 6, wordBreak: 'break-all' }}>
                    {service.url}
                  </div>
                  <div className="small muted">
                    {service.up ? `v${service.version}` : service.error || '不可达'}
                  </div>
                </div>
              ))}
              {!data.services?.length && <div className="muted small">尚未获取服务状态</div>}
            </div>
          </div>

          <div className="section-title"><h2>模型服务</h2><div className="line" /></div>
          <div className="card" style={{ padding: 14, marginBottom: 20 }}>
            <div className="row wrap">
              <span className={`badge ${data.models.healthy ? 'ok' : 'danger'}`}>{data.models.healthy ? '在线' : '不可达'}</span>
              <span className="small muted">muse2api：{data.config.museBase}</span>
              <span className="badge">{data.config.hasKey ? '密钥已配置' : '缺少密钥'}</span>
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              {data.models.models.map((m) => `${m.id}（${m.kind}）`).join(' · ')}
            </div>
          </div>

          <div className="section-title"><h2>用户与配额</h2><div className="line" /></div>
          <div className="card" style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: 10 }}>邮箱</th>
                  <th style={{ padding: 10 }}>昵称</th>
                  <th style={{ padding: 10 }}>角色</th>
                  <th style={{ padding: 10 }}>文档</th>
                  <th style={{ padding: 10 }}>状态</th>
                  <th style={{ padding: 10 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: 10 }}>{u.email}</td>
                    <td style={{ padding: 10 }}>{u.display_name}</td>
                    <td style={{ padding: 10 }}>{u.role}</td>
                    <td style={{ padding: 10 }}>{u.documents}</td>
                    <td style={{ padding: 10 }}>{u.disabled ? '停用' : '正常'}</td>
                    <td style={{ padding: 10 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn sm" onClick={() => updateUser(u, { role: u.role === 'admin' ? 'member' : 'admin' })}>
                          {u.role === 'admin' ? '降为成员' : '设为管理员'}
                        </button>
                        <button className="btn sm danger" onClick={() => updateUser(u, { disabled: !u.disabled })}>
                          {u.disabled ? '启用' : '停用'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="section-title"><h2>AI 用量</h2><div className="line" /></div>
          <div className="card" style={{ padding: 14, marginBottom: 20 }}>
            {data.usage.byDay.length === 0 && <div className="muted small">暂无调用记录</div>}
            {data.usage.byDay.map((row) => (
              <div key={`${row.day}-${row.kind}`} className="row small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ width: 100 }}>{row.day}</span>
                <span className="badge">{row.kind}</span>
                <span className="muted">{row.calls} 次 · {row.units} 单位 · 失败 {row.errors}</span>
              </div>
            ))}
          </div>

          <div className="section-title"><h2>最近操作</h2><div className="line" /></div>
          <div className="card" style={{ padding: 14 }}>
            {data.audit.map((row) => (
              <div key={row.id} className="small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="muted">{new Date(row.created_at).toLocaleString()}</span>{' '}
                <span className="badge">{row.action}</span> {row.email || '匿名'} {row.detail}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
