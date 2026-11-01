import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'office-test-'));
process.env.OFFICE_DATA_DIR = path.join(TMP, 'data');
process.env.OFFICE_DB_PATH = path.join(TMP, 'data', 'test.db');
process.env.OFFICE_PORT = '0';
process.env.OFFICE_MUSE_KEY = 'test-key';

const { start } = await import('../server/src/index.js');

let server;
let base;

/** 带 Cookie 罐的极简客户端，模拟浏览器会话。 */
function client() {
  const jar = new Map();
  const store = (res) => {
    for (const cookie of res.headers.getSetCookie?.() || []) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  };
  const headers = () => {
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    return cookie ? { cookie } : {};
  };
  const request = async (method, url, body, extraHeaders = {}) => {
    const init = { method, headers: { ...headers(), ...extraHeaders } };
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(base + url, init);
    store(res);
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  return {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body ?? {}),
    put: (url, body) => request('PUT', url, body ?? {}),
    patch: (url, body) => request('PATCH', url, body ?? {}),
    del: (url) => request('DELETE', url),
    upload: async (url, formData) => {
      const res = await fetch(base + url, { method: 'POST', headers: headers(), body: formData });
      store(res);
      return { status: res.status, body: await res.json() };
    },
    raw: async (url, init = {}) => {
      const res = await fetch(base + url, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
      store(res);
      return res;
    },
  };
}

before(async () => {
  server = await start({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('基础与鉴权', () => {
  it('健康检查可用', async () => {
    const c = client();
    const res = await c.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'up');
  });

  it('首个注册用户成为管理员，并可登录/登出', async () => {
    const c = client();
    const reg = await c.post('/api/auth/register', { email: 'owner@example.com', password: 'password123', displayName: '站长' });
    assert.equal(reg.status, 201, reg.text);
    assert.equal(reg.body.data.user.role, 'admin');

    const me = await c.get('/api/auth/me');
    assert.equal(me.body.data.user.email, 'owner@example.com');

    const second = client();
    const reg2 = await second.post('/api/auth/register', { email: 'guest@example.com', password: 'password123' });
    assert.equal(reg2.body.data.user.role, 'member');

    const dup = await client().post('/api/auth/register', { email: 'owner@example.com', password: 'password123' });
    assert.equal(dup.status, 409);

    const bad = await client().post('/api/auth/login', { email: 'owner@example.com', password: 'wrong-pass' });
    assert.equal(bad.status, 401);

    const login = await client().post('/api/auth/login', { email: 'owner@example.com', password: 'password123' });
    assert.equal(login.status, 200);

    await c.post('/api/auth/logout');
    const afterLogout = await c.get('/api/auth/me');
    assert.equal(afterLogout.body.data.user, null);
  });

  it('游客拿到 guestKey，文档按游客隔离', async () => {
    const a = client();
    const b = client();
    const meA = await a.get('/api/auth/me');
    const meB = await b.get('/api/auth/me');
    assert.ok(meA.body.data.guestKey);
    assert.notEqual(meA.body.data.guestKey, meB.body.data.guestKey);

    const created = await a.post('/api/documents', { kind: 'docx', title: '游客文档' });
    assert.equal(created.status, 201);
    const listB = await b.get('/api/documents');
    assert.equal(listB.body.data.documents.length, 0);

    const peek = await b.get(`/api/documents/${created.body.data.document.id}`);
    assert.equal(peek.status, 403);
  });
});

describe('文档 CRUD 与四件套导出', () => {
  let c;
  let token;

  before(async () => {
    c = client();
    const res = await c.post('/api/auth/login', { email: 'owner@example.com', password: 'password123' });
    assert.equal(res.status, 200);
  });

  it('DOCX：新建 → 保存 → 导出为真实 docx', async () => {
    const created = await c.post('/api/documents', { kind: 'docx', title: '合同草稿' });
    assert.equal(created.status, 201, created.text);
    const id = created.body.data.document.id;

    const model = { version: 1, html: '<h1>测试标题</h1><p><strong>加粗</strong>与<em>斜体</em></p><ul><li>要点一</li></ul>' };
    const saved = await c.put(`/api/documents/${id}`, { model, title: '合同草稿 v2' });
    assert.equal(saved.status, 200);

    const loaded = await c.get(`/api/documents/${id}`);
    assert.equal(loaded.body.data.document.title, '合同草稿 v2');
    assert.match(loaded.body.data.model.html, /测试标题/);

    const exported = await c.raw(`/api/documents/${id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'docx', model }),
    });
    assert.equal(exported.status, 200);
    const buffer = Buffer.from(await exported.arrayBuffer());
    assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK');
    assert.ok(buffer.length > 3000);

    // 再把导出的 docx 导回来，验证往返不丢结构
    const form = new FormData();
    form.append('file', new Blob([buffer]), 'roundtrip.docx');
    const reimport = await c.upload('/api/documents/import', form);
    assert.equal(reimport.status, 201, JSON.stringify(reimport.body));
    const back = await c.get(`/api/documents/${reimport.body.data.document.id}`);
    assert.match(back.body.data.model.html, /测试标题/);
    assert.match(back.body.data.model.html, /加粗/);
  });

  it('XLSX：保存公式模型并导出，重新导入保留公式', async () => {
    const created = await c.post('/api/documents', { kind: 'xlsx', title: '预算' });
    const id = created.body.data.document.id;
    const model = {
      version: 1,
      sheets: [
        {
          name: '预算',
          rows: [
            [{ v: '项目' }, { v: '金额' }],
            [{ v: '收入' }, { v: 1000 }],
            [{ v: '成本' }, { v: 400 }],
            [{ v: '毛利' }, { f: '=B2-B3', v: 600 }],
          ],
        },
      ],
    };
    await c.put(`/api/documents/${id}`, { model });
    const exported = await c.raw(`/api/documents/${id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'xlsx', model }),
    });
    assert.equal(exported.status, 200);
    const buffer = Buffer.from(await exported.arrayBuffer());
    assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK');

    const form = new FormData();
    form.append('file', new Blob([buffer]), 'budget.xlsx');
    const reimport = await c.upload('/api/documents/import', form);
    assert.equal(reimport.status, 201);
    const back = await c.get(`/api/documents/${reimport.body.data.document.id}`);
    const rows = back.body.data.model.sheets[0].rows;
    assert.equal(rows[1][0].v, '收入');
    assert.equal(Number(rows[1][1].v), 1000);
    assert.equal(rows[3][1].f, '=B2-B3');
  });

  it('PPTX：保存幻灯片模型并导出，重新导入保留页数', async () => {
    const created = await c.post('/api/documents', { kind: 'pptx', title: '汇报' });
    const id = created.body.data.document.id;
    const model = {
      version: 1,
      width: 1280,
      height: 720,
      theme: 'midnight',
      slides: [
        {
          id: 'sl_1',
          background: '#0F172A',
          elements: [
            { id: 'el_1', type: 'text', x: 80, y: 80, w: 900, h: 120, text: '季度汇报', role: 'title', size: 44, color: '#F8FAFC', bold: true },
            { id: 'el_2', type: 'text', x: 80, y: 240, w: 900, h: 300, text: '• 增长 20%', role: 'body', size: 22, color: '#CBD5E1' },
          ],
        },
        {
          id: 'sl_2',
          background: '#0F172A',
          elements: [
            { id: 'el_3', type: 'text', x: 80, y: 80, w: 900, h: 120, text: '第二页', role: 'title', size: 40, color: '#F8FAFC', bold: true },
          ],
        },
      ],
    };
    await c.put(`/api/documents/${id}`, { model });
    const exported = await c.raw(`/api/documents/${id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'pptx', model }),
    });
    assert.equal(exported.status, 200);
    const buffer = Buffer.from(await exported.arrayBuffer());
    assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK');

    const form = new FormData();
    form.append('file', new Blob([buffer]), 'deck.pptx');
    const reimport = await c.upload('/api/documents/import', form);
    assert.equal(reimport.status, 201, JSON.stringify(reimport.body));
    const back = await c.get(`/api/documents/${reimport.body.data.document.id}`);
    assert.equal(back.body.data.model.slides.length, 2);
    const texts = back.body.data.model.slides.flatMap((s) => s.elements.filter((e) => e.type === 'text').map((e) => e.text));
    assert.ok(texts.some((t) => t.includes('季度汇报')), JSON.stringify(texts));
  });

  it('PDF：新建、页操作（旋转/删除/水印）与元信息', async () => {
    const created = await c.post('/api/documents', { kind: 'pdf', title: '合同签署页' });
    assert.equal(created.status, 201);
    const id = created.body.data.document.id;

    const info = await c.get(`/api/documents/${id}`);
    assert.equal(info.body.data.model.info.pageCount, 1);

    const rotated = await c.post(`/api/documents/${id}/pdf-ops`, { ops: { rotate: { pages: '1', angle: 90 } } });
    assert.equal(rotated.status, 200, rotated.text);
    assert.equal(rotated.body.data.info.pages[0].rotation, 90);

    const marked = await c.post(`/api/documents/${id}/pdf-ops`, { ops: { watermark: { text: '内部资料', opacity: 0.2 } } });
    assert.equal(marked.status, 200, marked.text);

    const raw = await c.raw(`/api/documents/${id}/raw`);
    assert.equal(raw.status, 200);
    const buffer = Buffer.from(await raw.arrayBuffer());
    assert.equal(buffer.slice(0, 5).toString('latin1'), '%PDF-');

    const del = await c.post(`/api/documents/${id}/pdf-ops`, { ops: { delete: '1' } });
    assert.equal(del.status, 400, '不允许删完所有页');
  });

  it('文档可重命名、复制、删除', async () => {
    const created = await c.post('/api/documents', { kind: 'docx', title: '原始' });
    const id = created.body.data.document.id;
    const renamed = await c.post(`/api/documents/${id}/rename`, { title: '改名后' });
    assert.equal(renamed.body.data.document.title, '改名后');
    const dup = await c.post(`/api/documents/${id}/duplicate`);
    assert.equal(dup.status, 201);
    assert.match(dup.body.data.document.title, /副本/);
    const removed = await c.del(`/api/documents/${id}`);
    assert.equal(removed.status, 200);
    const gone = await c.get(`/api/documents/${id}`);
    assert.equal(gone.status, 404);
  });

  it('拒绝非白名单类型与超大 JSON', async () => {
    const bad = await c.post('/api/documents', { kind: 'exe' });
    assert.equal(bad.status, 400);
  });
});

describe('模板与素材库', () => {
  let c;

  before(async () => {
    c = client();
    await c.post('/api/auth/login', { email: 'owner@example.com', password: 'password123' });
  });

  it('内置模板已生成并可按类型过滤', async () => {
    const all = await c.get('/api/templates');
    assert.ok(all.body.data.templates.length >= 10);
    const docx = await c.get('/api/templates?kind=docx');
    assert.ok(docx.body.data.templates.every((t) => t.kind === 'docx'));
    const one = docx.body.data.templates[0];
    const file = await c.raw(`/api/templates/${one.slug}/file`);
    assert.equal(file.status, 200);
    const buffer = Buffer.from(await file.arrayBuffer());
    assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK');
  });

  it('用模板新建文档会带上模板内容', async () => {
    const tpl = (await c.get('/api/templates?kind=xlsx')).body.data.templates[0];
    const created = await c.post('/api/documents', { kind: 'xlsx', title: tpl.title, template: tpl.slug });
    assert.equal(created.status, 201, created.text);
    const loaded = await c.get(`/api/documents/${created.body.data.document.id}`);
    assert.ok(loaded.body.data.model.sheets[0].rows.length > 3);
  });

  it('上传素材、列出、改名、删除', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBIAAAB0gAgH8sO0WAAAAAElFTkSuQmCC',
      'base64',
    );
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
    form.append('tags', '测试,图标');
    const up = await c.upload('/api/assets', form);
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const asset = up.body.data.assets[0];
    assert.equal(asset.kind, 'image');
    assert.deepEqual(asset.tags, ['测试', '图标']);

    const list = await c.get('/api/assets');
    assert.ok(list.body.data.assets.some((a) => a.id === asset.id));

    const file = await c.raw(`/api/assets/${asset.id}/file`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');

    const renamed = await c.patch(`/api/assets/${asset.id}`, { title: '改名素材', tags: '新标签' });
    assert.equal(renamed.body.data.asset.title, '改名素材');

    const other = client();
    const forbidden = await other.get(`/api/assets/${asset.id}/file`);
    assert.equal(forbidden.status, 403);

    const removed = await c.del(`/api/assets/${asset.id}`);
    assert.equal(removed.status, 200);
  });

  it('素材标签按作用域统计，不泄露他人标签', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBIAAAB0gAgH8sO0WAAAAAElFTkSuQmCC',
      'base64',
    );
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'tag.png');
    form.append('tags', '私有标签');
    const up = await c.upload('/api/assets', form);
    assert.equal(up.status, 201);

    const mine = await c.get('/api/assets');
    assert.ok(mine.body.data.tags.some((t) => t.name === '私有标签'));

    const stranger = client();
    await stranger.post('/api/auth/register', { email: `tag-${Date.now()}@example.com`, password: 'password123' });
    const other = await stranger.get('/api/assets');
    assert.ok(!other.body.data.tags.some((t) => t.name === '私有标签'), '他人标签不应出现在列表里');
  });

  it('拒绝非图片上传', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('not an image')]), 'x.png');
    const up = await c.upload('/api/assets', form);
    assert.equal(up.status, 400);
  });
});

describe('AI 网关', () => {
  it('游客没有 AI 权限', async () => {
    const c = client();
    const res = await c.post('/api/ai/chat', { task: 'polish', text: '测试' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'AI_NOT_ENABLED');
  });

  it('成员有配额，上游不可达时返回结构化错误而非 500', async () => {
    const c = client();
    await c.post('/api/auth/login', { email: 'guest@example.com', password: 'password123' });
    const res = await c.post('/api/ai/chat', { task: 'polish', text: '测试文本' });
    assert.ok([502, 503, 504].includes(res.status), `unexpected ${res.status} ${res.text}`);
    assert.ok(['AI_UPSTREAM_ERROR', 'AI_UNREACHABLE', 'AI_TIMEOUT', 'AI_NOT_CONFIGURED'].includes(res.body.error.code));
  });

  it('管理员额度为无限', async () => {
    const c = client();
    await c.post('/api/auth/login', { email: 'owner@example.com', password: 'password123' });
    const status = await c.get('/api/ai/status');
    assert.equal(status.body.data.quota.chat.limit, -1);
    assert.equal(status.body.data.quota.image.limit, -1);
    assert.ok(Array.isArray(status.body.data.models));
  });
});

describe('管理接口', () => {
  it('普通成员访问后台被拒，管理员可以看总览', async () => {
    const member = client();
    await member.post('/api/auth/login', { email: 'guest@example.com', password: 'password123' });
    const denied = await member.get('/api/admin/overview');
    assert.equal(denied.status, 403);

    const admin = client();
    await admin.post('/api/auth/login', { email: 'owner@example.com', password: 'password123' });
    const overview = await admin.get('/api/admin/overview');
    assert.equal(overview.status, 200);
    assert.ok(overview.body.data.users.length >= 2);
    assert.ok(overview.body.data.stats.templates > 0);
  });

  it('可以调整成员角色并停用', async () => {
    const admin = client();
    await admin.post('/api/auth/login', { email: 'owner@example.com', password: 'password123' });
    const users = (await admin.get('/api/admin/overview')).body.data.users;
    const target = users.find((u) => u.email === 'guest@example.com');
    const promoted = await admin.patch(`/api/admin/users/${target.id}`, { role: 'admin' });
    assert.equal(promoted.body.data.user.role, 'admin');
    await admin.patch(`/api/admin/users/${target.id}`, { role: 'member' });
  });
});

describe('安全边界', () => {
  it('存储键穿越被拒绝', async () => {
    const c = client();
    await c.post('/api/auth/login', { email: 'owner@example.com', password: 'password123' });
    const res = await c.get('/api/templates/..%2F..%2Fetc%2Fpasswd/file');
    assert.ok([400, 404].includes(res.status));
  });

  it('未知接口返回 JSON 错误', async () => {
    const res = await fetch(`${base}/api/not-exist`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.ok, false);
  });
});
