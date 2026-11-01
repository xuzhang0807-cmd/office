import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from './lib/session.jsx';
import HomePage from './pages/Home.jsx';
import LoginPage from './pages/Login.jsx';
import AssetsPage from './pages/Assets.jsx';
import TemplatesPage from './pages/Templates.jsx';
import AdminPage from './pages/Admin.jsx';
import EditorPage from './pages/Editor.jsx';
import TopBar from './components/TopBar.jsx';

/** 极简 hash 路由：不引第三方 router，部署到任意子路径都能用。 */
function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, queryString] = raw.split('?');
  const params = new URLSearchParams(queryString || '');
  return { path: path || '/', params };
}

export function navigate(path, params) {
  const search = params ? `?${new URLSearchParams(params).toString()}` : '';
  window.location.hash = `${path}${search}`;
}

export default function App() {
  const [route, setRoute] = useState(parseHash);
  const { loading } = useSession();

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) window.location.hash = '/';
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const page = useMemo(() => {
    const [, head, id] = route.path.split('/');
    if (head === 'editor' && id) return <EditorPage id={id} />;
    if (head === 'login') return <LoginPage />;
    if (head === 'assets') return <AssetsPage />;
    if (head === 'templates') return <TemplatesPage />;
    if (head === 'admin') return <AdminPage />;
    return <HomePage />;
  }, [route.path]);

  if (loading) {
    return (
      <div className="auth-wrap">
        <div className="muted">正在加载工作台…</div>
      </div>
    );
  }

  const isEditor = route.path.startsWith('/editor/');

  return (
    <div className="shell">
      {!isEditor && <TopBar route={route.path} />}
      <div className={isEditor ? '' : 'main'}>{page}</div>
    </div>
  );
}
