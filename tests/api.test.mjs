import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startStack } from './helpers/stack.mjs';

/**
 * 门户集成测试（模块化后）。
 *
 * 与重构前的区别：不再 import start()，而是起整套服务；
 * 断言里多了「能力服务健康状态」与「跨服务导出」。
 */

let stack;
let base;

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
  stack = await startStack({ env: { OFFICE_MUSE_KEY: 'test-key' } });
  base = stack.base;
});

after(async () => {
  await stack.close();
});

describe('模块化：服务拓扑', () => {
  it('四个能力服务都健康', async () => {
    const res = await client().get('/api/meta/services?fresh=1');
    assert.equal(res.status, 200);
    const services = res.body.data.services;
    assert.equal(services.length, 4);
    for (const service of services) {
      assert.equal(service.up, true, `${service.name} 不健康：${service.error}`);
      assert.match(service.version, /^\d+\.\d+\.\d+$/);
    }
    assert.deepEqual(services.map((s) => s.name).sort(), ['docx', 'pdf', 'pptx', 'xlsx']);
  });

  it('bootstrap 里带服务状态', async () => {
    const res = await client().get('/api/meta/bootstrap');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data.services));
    assert.equal(res.body.data.services.length, 4);
  });

  it('模板通过能力服务生成（12 套）', async () => {
    const res = await client().get('/api/templates');
    assert.equal(res.body.data.templates.length, 12);
    const kinds = res.body.data.templates.reduce((acc, t) => {
      acc[t.kind] = (acc[t.kind] || 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(kinds, { docx: 4, xlsx: 3, pptx: 3, pdf: 2 });
  });
});

describe('模块化：基础与鉴权', () => {
  it('健康检查带版本号', async () => {
    const res = await client().get('/api/health');
    assert.equal(res.status, 200);
    assert.match(res.body.data.version, /^\d+\.\d+\.\d+$/);
  });

  it('首个注册用户是管理员，第二个是成员', async () => {
    const c = client();
    const reg = await c.post('/api/auth/register', { email: 'owner@example.com', password: 'password123', displayName: '站长' });
    assert.equal(reg.status, 201, reg.text);
    assert.equal(reg.body.data.user.role, 'admin');

    const second = client();
    const reg2 = await second.post('/api/auth/register', { email: 'guest@example.com', password: 'password123' });
    assert.equal(reg2.body.data.user.role, 'member');

    const bad = await client().post('/api/auth/login', { email: 'owner@example.com', password: 'wrong' });
    assert.equal(bad.status, 401);
  });

  it('游客文档按 Cookie 隔离', async () => {
    const a = client();
    const b = client();
    const created = await a.post('/api/documents', { kind: 'docx', title: '游客文档' });
    assert.equal(created.status, 201, created.text);
    const listB = await b.get('/api/documents');
    assert.equal(listB.body.data.documents.length, 0);
    const peek = await b.get(`/api/documents/${created.body.data.document.id}`);
    assert.equal(peek.status, 403);
  });
});

describe('模块化：跨服务导出', () => {
  let c;

  before(async () => {
    c = client();
    await c.post('/api/auth/login', { email: 'owner@example.com', password: 'password123' });
  });

  it('DOCX：保存 → 导出 docx（经 docx 服务）', async () => {
    const created = await c.post('/api/documents', { kind: 'docx', title: '合同草稿' });
    assert.equal(created.status, 201, created.text);
    const id = created.body.data.document.id;
    const model = { version: 1, html: '<h1>测试标题</h1><p><strong>加粗</strong></p><ul><li>要点一</li></ul>' };
    await c.put(`/api/documents/${id}`, { model, title: '合同草稿 v2' });

    const loaded = await c.get(`/api/documents/${id}`);
    assert.match(loaded.body.data.model.html, /测试标题/);
    assert.equal(loaded.body.data.document.title, '合同草稿 v2');

    const res = await c.raw(`/api/documents/${id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'docx', model }),
    });
    assert.equal(res.status, 200);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK');
    assert.ok(buffer.length > 3000);

    const form = new FormData();
    form.append('file', new Blob([buffer]), 'roundtrip.docx');
    const reimport = await c.upload('/api/documents/import', form);
    assert.equal(reimport.status, 201, JSON.stringify(reimport.body));
    const back = await c.get(`/api/documents/${reimport.body.data.document.id}`);
    assert.match(back.body.data.model.html, /测试标题/);
  });

  it('DOCX → PDF（经 pdf 服务的 fromHtml）', async () => {
    const created = await c.post('/api/documents', { kind: 'docx', title: '转 PDF' });
    const id = created.body.data.document.id;
    const model = { version: 1, html: '<h1>标题</h1><p>正文</p><table><tr><th>A</th></tr><tr><td>1</td></tr></table>' };
    const res = await c.raw(`/api/documents/${id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'pdf', model }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.equal(buffer.slice(0, 5).toString('latin1'), '%PDF-');
  });

  it('XLSX：往返保留公式，可导出 csv/pdf', async () => {
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

    const xlsx = await c.raw(`/api/documents/${id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'xlsx', model }),
    });
    assert.equal(xlsx.status, 200);
    const buffer = Buffer.from(await xlsx.arrayBuffer());
    assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK');

    const form = new FormData();
    form.append('file', new Blob([buffer]), 'budget.xlsx');
    const reimport = await c.upload('/api/documents/import', form);
    const back = await c.get(`/api/documents/${reimport.body.data.document.id}`);
    assert.equal(back.body.data.model.sheets[0].rows[1][0].v, '收入');
    assert.match(back.body.data.model.sheets[0].rows[3][1].f, /B2-B3/);

    const csv = await c.raw(`/api/documents/${id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'csv', model }),
    });
    assert.match(await csv.text(), /收入,1000/);

    const pdf = await c.raw(`/api/documents/${id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'pdf', model }),
    });
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).slice(0, 5).toString('latin1'), '%PDF-');
  });

  it('PPTX：往返保留页数，可导出 pdf', async () => {
    const created = await c.post('/api/documents', { kind: 'pptx', title: '汇报' });
    const id = created.body.data.document.id;
    const model = {
      version: 1,
      width: 1280,
      height: 720,
      theme: 'midnight',
      slides: [
        { id: 'sl_1', background: '#0F172A', elements: [{ id: 'el_1', type: 'text', x: 80, y: 80, w: 900, h: 120, text: '季度汇报', role: 'title', size: 44, color: '#F8FAFC', bold: true }] },
        { id: 'sl_2', background: '#0F172A', elements: [{ id: 'el_3', type: 'text', x: 80, y: 80, w: 900, h: 120, text: '第二页', role: 'title', size: 40, color: '#F8FAFC', bold: true }] },
      ],
    };
    await c.put(`/api/documents/${id}`, { model });

    const pptx = await c.raw(`/api/documents/${id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'pptx', model }),
    });
    assert.equal(pptx.status, 200);
    const buffer = Buffer.from(await pptx.arrayBuffer());
    assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK');

    const form = new FormData();
    form.append('file', new Blob([buffer]), 'deck.pptx');
    const reimport = await c.upload('/api/documents/import', form);
    assert.equal(reimport.status, 201, JSON.stringify(reimport.body));
    const back = await c.get(`/api/documents/${reimport.body.data.document.id}`);
    assert.equal(back.body.data.model.slides.length, 2);

    const pdf = await c.raw(`/api/documents/${id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'pdf', model }),
    });
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).slice(0, 5).toString('latin1'), '%PDF-');
  });

  it('PDF：新建 / 页操作 / 文字层（全部经 pdf 服务）', async () => {
    const created = await c.post('/api/documents', { kind: 'pdf', title: '中文标题测试' });
    assert.equal(created.status, 201, created.text);
    const id = created.body.data.document.id;

    const info = await c.get(`/api/documents/${id}`);
    assert.equal(info.body.data.model.info.pageCount, 1);

    const rotated = await c.post(`/api/documents/${id}/pdf-ops`, { ops: { rotate: { pages: '1', angle: 90 } } });
    assert.equal(rotated.status, 200, rotated.text);
    assert.equal(rotated.body.data.info.pages[0].rotation, 90);

    const marked = await c.post(`/api/documents/${id}/pdf-ops`, { ops: { watermark: { text: '内部资料', opacity: 0.2 } } });
    assert.equal(marked.status, 200, marked.text);

    const text = await c.get(`/api/documents/${id}/text`);
    assert.equal(text.status, 200);
    assert.match(text.body.data.text, /中文标题测试/);

    const del = await c.post(`/api/documents/${id}/pdf-ops`, { ops: { delete: '1' } });
    assert.equal(del.status, 400, '不允许删完所有页');
  });

  it('四件套都能提取文本', async () => {
    const docx = await c.post('/api/documents', { kind: 'docx', title: '文本' });
    await c.put(`/api/documents/${docx.body.data.document.id}`, { model: { version: 1, html: '<h1>标题甲</h1>' } });
    const docxText = await c.get(`/api/documents/${docx.body.data.document.id}/text`);
    assert.match(docxText.body.data.text, /标题甲/);

    const pptx = await c.post('/api/documents', { kind: 'pptx', title: '演示' });
    await c.put(`/api/documents/${pptx.body.data.document.id}`, { model: { version: 1, slides: [{ elements: [{ type: 'text', text: '封面标题' }] }] } });
    const pptxText = await c.get(`/api/documents/${pptx.body.data.document.id}/text`);
    assert.match(pptxText.body.data.text, /封面标题/);
  });

  it('文档可重命名、复制、删除', async () => {
    const created = await c.post('/api/documents', { kind: 'docx', title: '原始' });
    const id = created.body.data.document.id;
    const renamed = await c.post(`/api/documents/${id}/rename`, { title: '改名后' });
    assert.equal(renamed.body.data.document.title, '改名后');
    const dup = await c.post(`/api/documents/${id}/duplicate`);
    assert.equal(dup.status, 201);
    assert.match(dup.body.data.document.title, /副本/);
    await c.del(`/api/documents/${id}`);
    const gone = await c.get(`/api/documents/${id}`);
    assert.equal(gone.status, 404);
  });
});

describe('模块化：素材与模板', () => {
  let c;

  before(async () => {
    c = client();
    await c.post('/api/auth/login', { email: 'owner@example.com', password: 'password123' });
  });

  it('模板文件可下载且是合法 zip', async () => {
    const list = await c.get('/api/templates?kind=docx');
    const tpl = list.body.data.templates[0];
    const file = await c.raw(`/api/templates/${tpl.slug}/file`);
    assert.equal(file.status, 200);
    assert.equal(Buffer.from(await file.arrayBuffer()).slice(0, 2).toString('latin1'), 'PK');
  });

  it('用模板新建文档会带上模板内容', async () => {
    const tpl = (await c.get('/api/templates?kind=xlsx')).body.data.templates[0];
    const created = await c.post('/api/documents', { kind: 'xlsx', title: tpl.title, template: tpl.slug });
    assert.equal(created.status, 201, created.text);
    const loaded = await c.get(`/api/documents/${created.body.data.document.id}`);
    assert.ok(loaded.body.data.model.sheets[0].rows.length > 3);
  });

  it('素材上传、检索、改名、删除', async () => {
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
    assert.deepEqual(asset.tags, ['测试', '图标']);

    const file = await c.raw(`/api/assets/${asset.id}/file`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');

    const renamed = await c.patch(`/api/assets/${asset.id}`, { title: '改名素材', tags: '新标签' });
    assert.equal(renamed.body.data.asset.title, '改名素材');

    const other = client();
    const forbidden = await other.get(`/api/assets/${asset.id}/file`);
    assert.equal(forbidden.status, 403);

    await c.del(`/api/assets/${asset.id}`);
  });

  it('拒绝非图片上传', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('not an image')]), 'x.png');
    const up = await c.upload('/api/assets', form);
    assert.equal(up.status, 400);
  });
});

describe('模块化：AI 网关与权限', () => {
  it('游客无 AI 权限', async () => {
    const res = await client().post('/api/ai/chat', { task: 'polish', text: '测试' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'AI_NOT_ENABLED');
  });

  it('成员有配额，上游不可达时返回结构化错误', async () => {
    const c = client();
    await c.post('/api/auth/login', { email: 'guest@example.com', password: 'password123' });
    const res = await c.post('/api/ai/chat', { task: 'polish', text: '测试文本' });
    assert.ok([502, 503, 504].includes(res.status), `unexpected ${res.status}`);
    assert.ok(['AI_UPSTREAM_ERROR', 'AI_UNREACHABLE', 'AI_TIMEOUT', 'AI_NOT_CONFIGURED'].includes(res.body.error.code));
  });

  it('管理员额度无限', async () => {
    const c = client();
    await c.post('/api/auth/login', { email: 'owner@example.com', password: 'password123' });
    const status = await c.get('/api/ai/status');
    assert.equal(status.body.data.quota.chat.limit, -1);
    assert.equal(status.body.data.quota.image.limit, -1);
  });

  it('普通成员访问后台被拒', async () => {
    const member = client();
    await member.post('/api/auth/login', { email: 'guest@example.com', password: 'password123' });
    assert.equal((await member.get('/api/admin/overview')).status, 403);
  });
});

describe('模块化：降级行为', () => {
  it('能力服务不可达时导出返回 502/504，不是 500', async () => {
    // 用一个指向空端口的门户实例，模拟「pdf 服务下线」
    const dead = await startStack({ env: { OFFICE_MUSE_KEY: 'test-key', OFFICE_PDF_URL: 'http://127.0.0.1:1' }, basePort: 32500 });
    try {
      const c = (() => {
        const jar = new Map();
        const store = (res) => {
          for (const cookie of res.headers.getSetCookie?.() || []) {
            const [pair] = cookie.split(';');
            const i = pair.indexOf('=');
            jar.set(pair.slice(0, i), pair.slice(i + 1));
          }
        };
        const headers = () => {
          const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
          return cookie ? { cookie } : {};
        };
        return {
          post: async (url, body) => {
            const res = await fetch(dead.base + url, {
              method: 'POST',
              headers: { ...headers(), 'content-type': 'application/json' },
              body: JSON.stringify(body ?? {}),
            });
            store(res);
            return { status: res.status, body: await res.json() };
          },
          raw: async (url, init) => {
            const res = await fetch(dead.base + url, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
            store(res);
            return res;
          },
        };
      })();

      const created = await c.post('/api/documents', { kind: 'docx', title: '降级测试' });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const id = created.body.data.document.id;
      const res = await c.raw(`/api/documents/${id}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'pdf', model: { version: 1, html: '<p>x</p>' } }),
      });
      assert.ok([502, 504].includes(res.status), `期望 502/504，实际 ${res.status}`);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.ok(['SERVICE_UNAVAILABLE', 'SERVICE_TIMEOUT'].includes(body.error.code));
    } finally {
      await dead.close();
    }
  });
});
