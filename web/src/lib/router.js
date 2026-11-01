/** 极简 hash 路由工具，独立成模块以避免 App ↔ 页面之间的循环依赖。 */

export function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, queryString] = raw.split('?');
  const params = new URLSearchParams(queryString || '');
  return { path: path || '/', params };
}

export function navigate(path, params) {
  const search = params ? `?${new URLSearchParams(params).toString()}` : '';
  window.location.hash = `${path}${search}`;
}
