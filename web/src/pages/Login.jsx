import React, { useState } from 'react';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { navigate } from '../App.jsx';

export default function LoginPage() {
  const { login, register, user, site } = useSession();
  const toast = useToast();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h2 style={{ marginTop: 0 }}>已登录</h2>
          <p className="muted small">
            当前账号：{user.displayName}（{user.email}）
          </p>
          <button className="btn primary block" onClick={() => navigate('/')}>
            回到工作台
          </button>
        </div>
      </div>
    );
  }

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
        toast.success('登录成功');
      } else {
        await register(form);
        toast.success('注册成功，已自动登录');
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 6 }}>
          <span className="brand-mark">O</span>
          <span>{site?.name || '在线办公'}</span>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          {mode === 'login' ? '登录后文档保存到账号，可申请 AI 额度。' : '注册即用；站点第一个注册账号自动成为管理员。'}
        </p>
        {error && <div className="badge danger" style={{ marginBottom: 12 }}>{error}</div>}
        {mode === 'register' && (
          <div className="field">
            <label htmlFor="displayName">昵称</label>
            <input
              id="displayName"
              className="input"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="怎么称呼你"
              autoComplete="nickname"
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">邮箱</label>
          <input
            id="email"
            className="input"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@example.com"
            autoComplete="username"
          />
        </div>
        <div className="field">
          <label htmlFor="password">密码</label>
          <input
            id="password"
            className="input"
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="至少 8 位"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </div>
        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
        <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
          <span className="small muted">{mode === 'login' ? '还没有账号？' : '已有账号？'}</span>
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
          >
            {mode === 'login' ? '去注册' : '去登录'}
          </button>
        </div>
        <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
          <button type="button" className="btn sm ghost" onClick={() => navigate('/')}>
            以游客身份继续
          </button>
        </div>
      </form>
    </div>
  );
}
