import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OFFICE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'office-stack-'));

const { spawn } = await import('node:child_process');
const ROOT = '/root/projects/office';

const services = [
  ['docx', 32201],
  ['xlsx', 32202],
  ['pptx', 32203],
  ['pdf', 32204],
];

const kids = [];
for (const [name, port] of services) {
  const env = { ...process.env, [`OFFICE_${name.toUpperCase()}_PORT`]: String(port) };
  const child = spawn(process.execPath, [`${ROOT}/${name}/src/index.js`], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}!] ${d}`));
  kids.push(child);
}

const portal = spawn(process.execPath, [`${ROOT}/portal/src/index.js`], {
  cwd: ROOT,
  env: { ...process.env, OFFICE_PORT: '32199' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
portal.stdout.on('data', (d) => process.stdout.write(`[portal] ${d}`));
portal.stderr.on('data', (d) => process.stderr.write(`[portal!] ${d}`));
kids.push(portal);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4000);

async function get(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

console.log('\n=== health ===');
for (const [name, port] of services) {
  const r = await get(`http://127.0.0.1:${port}/health`);
  console.log(name, r.status, JSON.stringify(r.body).slice(0, 120));
}
const h = await get('http://127.0.0.1:32199/api/health');
console.log('portal', h.status, JSON.stringify(h.body));

console.log('\n=== capabilities ===');
for (const [name, port] of services) {
  const r = await get(`http://127.0.0.1:${port}/capabilities`);
  const ops = (r.body?.data?.ops || []).map((o) => o.op);
  console.log(name, r.status, ops.join(','));
}

console.log('\n=== rpc: docx export ===');
const docxOut = await get('http://127.0.0.1:32201/rpc', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ op: 'export', args: { html: '<h1>标题</h1><p>正文</p>', title: '测试' } }),
});
console.log(docxOut.status, 'bytes', docxOut.body?.data?.bytes, 'mime', docxOut.body?.data?.mime);

console.log('\n=== rpc: pdf fromHtml ===');
const pdfOut = await get('http://127.0.0.1:32204/rpc', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ op: 'fromHtml', args: { html: '<h1>转 PDF</h1><p>中文</p>', title: 'x' } }),
});
console.log(pdfOut.status, 'bytes', pdfOut.body?.data?.bytes);

console.log('\n=== portal services status ===');
const st = await get('http://127.0.0.1:32199/api/meta/services');
console.log(st.status, JSON.stringify(st.body?.data?.services));

for (const k of kids) k.kill('SIGTERM');
await sleep(500);
process.exit(0);
