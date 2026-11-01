import React from 'react';
import { useSession } from '../lib/session.jsx';
import { navigate } from '../lib/router.js';

const NAV = [
  { path: '/', label: '工作台' },
  { path: '/templates', label: '模板库' },
  { path: '/assets', label: '素材库' },
];

export default function TopBar({ route }) {
  const { user, site, logout, quota } = useSession();

  return (
    <header className="topbar">
      <div className="brand" role="button" tabIndex={0} onClick={() => navigate('/')} onKeyDown={(e) => e.key === 'Enter' && navigate('/')}>
        <span className="brand-mark">O</span>
        <span>{site?.name || '在线办公'}</span>
      </div>
      <nav className="nav">
        {NAV.map((item) => (
          <a
            key={item.path}
            href={`#${item.path}`}
            className={route === item.path ? 'active' : ''}
          >
            {item.label}
          </a>
        ))}
        {user?.role === 'admin' && (
          <a href="#/admin" className={route === '/admin' ? 'active' : ''}>
            管理
          </a>
        )}
      </nav>
      <div className="spacer" />
      {quota && user && (
        <span className="badge" title="今日 AI 额度（对话 / 生图）">
          AI {quota.chat.limit < 0 ? '∞' : `${quota.chat.used}/${quota.chat.limit}`} ·{' '}
          {quota.image.limit < 0 ? '∞' : `${quota.image.used}/${quota.image.limit}`}
        </span>
      )}
      {site?.blogUrl && (
        <a className="btn sm ghost" href={site.blogUrl} target="_blank" rel="noreferrer noopener">
          博客
        </a>
      )}
      {user ? (
        <div className="row" style={{ gap: 8 }}>
          <span className="small muted">{user.displayName}</span>
          <button className="btn sm" onClick={() => logout()}>
            退出
          </button>
        </div>
      ) : (
        <button className="btn sm primary" onClick={() => navigate('/login')}>
          登录 / 注册
        </button>
      )}
    </header>
  );
}
