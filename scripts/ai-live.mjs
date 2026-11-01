import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'office-ai-'));
process.env.OFFICE_DATA_DIR = path.join(TMP, 'data');
process.env.OFFICE_DB_PATH = path.join(TMP, 'data', 'ai.db');

const { start } = await import('../server/src/index.js');
const server = await start({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${server.address().port}`;

const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function call(method, url, body) {
  const headers = {};
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const init = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + url, init);
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}

const t0 = Date.now();
const reg = await call('POST', '/api/auth/register', { email: 'ai@example.com', password: 'password123', displayName: 'AI 测试' });
console.log('register', reg.status, reg.json?.data?.user?.role);

console.log('\n--- chat: polish ---');
const t1 = Date.now();
const chat = await call('POST', '/api/ai/chat', { task: 'polish', text: '我们这个方案很好，可以让大家省很多时间，提高效率，减少重复劳动。' });
console.log('status', chat.status, 'elapsed', Date.now() - t1, 'ms');
console.log(chat.json?.data?.content?.slice(0, 400) ?? chat.text.slice(0, 400));
console.log('quota', JSON.stringify(chat.json?.data?.quota));

console.log('\n--- chat: outline (JSON) ---');
const t2 = Date.now();
const outline = await call('POST', '/api/ai/chat', { task: 'outline', text: '给团队做一次关于在线办公工具的内部培训' });
console.log('status', outline.status, 'elapsed', Date.now() - t2, 'ms');
console.log(outline.json?.data?.content?.slice(0, 800) ?? outline.text.slice(0, 400));

console.log('\n--- image ---');
const t3 = Date.now();
const img = await call('POST', '/api/ai/image', { prompt: '扁平风格的团队协作办公场景插画，蓝紫配色，无文字', size: '16:9', count: 1 });
console.log('status', img.status, 'elapsed', Date.now() - t3, 'ms');
console.log(JSON.stringify(img.json?.data?.images ?? img.json ?? img.text).slice(0, 500));
if (img.json?.data?.images?.[0]) {
  const url = base + img.json.data.images[0].url;
  const file = await fetch(url, { headers: { cookie: cookieHeader() } });
  const buf = Buffer.from(await file.arrayBuffer());
  console.log('asset bytes', buf.length, 'magic', buf.slice(0, 4).toString('latin1'), 'status', file.status);
  fs.writeFileSync(path.join(TMP, 'generated.bin'), buf);
}

console.log('\n--- quota after ---');
const status = await call('GET', '/api/ai/status');
console.log(JSON.stringify(status.json?.data?.quota));

console.log('\ntotal', Date.now() - t0, 'ms');
server.close();
process.exit(0);
