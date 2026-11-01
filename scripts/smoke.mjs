import { start } from '../server/src/index.js';

const server = await start({ port: 32111, host: '127.0.0.1' });
const base = 'http://127.0.0.1:32111';
const out = [];

async function call(path, init) {
  const res = await fetch(base + path, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

out.push(['health', await call('/api/health')]);
out.push(['templates', await call('/api/templates')]);
out.push(['bootstrap', await call('/api/meta/bootstrap')]);
out.push(['me', await call('/api/auth/me')]);

console.log(JSON.stringify(out.map(([k, v]) => [k, v.status, typeof v.body === 'object' ? JSON.stringify(v.body).slice(0, 600) : String(v.body).slice(0, 300)]), null, 1));
server.close();
process.exit(0);
