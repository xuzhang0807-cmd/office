import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'office-ui-'));
process.env.OFFICE_DATA_DIR = path.join(TMP, 'data');
process.env.OFFICE_DB_PATH = path.join(TMP, 'data', 'ui.db');

const { start } = await import('../../server/src/index.js');
const { chromium } = await import('playwright');

let server;
let base;
let browser;
let context;
let page;

async function apiLogin(request, email, password) {
  const res = await request.post(`${base}/api/auth/login`, { data: { email, password } });
  assert.equal(res.status(), 200, await res.text());
}

before(async () => {
  server = await start({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.__errors = errors;
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('浏览器端到端', () => {
  it('首页加载并展示四件套入口', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector('.quick-card');
    const cards = await page.$$eval('.quick-card .k', (nodes) => nodes.map((n) => n.textContent.trim()));
    assert.deepEqual(cards.sort(), ['DOCX', 'PDF', 'PPTX', 'XLSX']);
    assert.deepEqual(page.__errors, []);
  });

  it('注册 → 新建 DOCX → 编辑 → 自动保存', async () => {
    await page.goto(`${base}/#/login`, { waitUntil: 'networkidle' });
    await page.click('text=去注册');
    await page.fill('#displayName', 'UI 测试');
    await page.fill('#email', `ui-${Date.now()}@example.com`);
    await page.fill('#password', 'password123');
    await page.click('button[type=submit]');
    await page.waitForSelector('.quick-card');

    await page.click('.quick-card:has-text("DOCX")');
    await page.waitForSelector('.doc-page .ProseMirror');
    await page.click('.doc-page .ProseMirror');
    await page.keyboard.type('端到端测试标题');
    await page.waitForTimeout(2200);
    const badge = await page.textContent('.editor-top .badge');
    assert.match(badge, /已保存|保存中/);

    // 刷新后内容仍在（验证落库）
    const url = page.url();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.doc-page .ProseMirror');
    const html = await page.innerHTML('.doc-page .ProseMirror');
    assert.match(html, /端到端测试标题/);
    assert.equal(page.url(), url);
  });

  it('XLSX：输入数字与公式即时计算', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.click('.quick-card:has-text("XLSX")');
    await page.waitForSelector('table.sheet');
    const cell = (r, c) => `table.sheet tbody tr:nth-child(${r}) td.cell:nth-child(${c + 1})`;

    await page.click(cell(1, 1));
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');
    await page.click(cell(2, 1));
    await page.keyboard.type('32');
    await page.keyboard.press('Enter');
    await page.click(cell(3, 1));
    await page.keyboard.type('=A1+A2');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const value = (await page.textContent(cell(3, 1))).trim();
    assert.equal(value, '42');
  });

  it('PPTX：新增页并编辑标题', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.click('.quick-card:has-text("PPTX")');
    await page.waitForSelector('.slide-thumb');
    const before = await page.$$eval('.slide-thumb', (n) => n.length);
    await page.click('button:has-text("＋ 新页")');
    await page.waitForTimeout(200);
    const afterCount = await page.$$eval('.slide-thumb', (n) => n.length);
    assert.equal(afterCount, before + 1);

    await page.click('.slide-el .txt');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('E2E 幻灯片');
    await page.click('.slide-stage');
    await page.waitForTimeout(400);
    const texts = await page.$$eval('.slide-el .txt', (nodes) => nodes.map((n) => n.textContent));
    assert.ok(texts.some((t) => t.includes('E2E 幻灯片')), JSON.stringify(texts));
  });

  it('PDF：渲染页面并旋转', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.click('.quick-card:has-text("PDF")');
    await page.waitForSelector('.pdf-page-wrap canvas', { timeout: 20000 });
    const pages = await page.$$eval('.pdf-page-wrap', (n) => n.length);
    assert.equal(pages, 1);
    await page.fill('input[placeholder="1-3,5"]', '1');
    await page.click('button:has-text("旋转")');
    await page.waitForTimeout(1200);
    const label = await page.textContent('.editor-top .badge');
    assert.ok(label.length > 0);
  });

  it('素材库页面可访问且无脚本错误', async () => {
    await page.goto(`${base}/#/assets`, { waitUntil: 'networkidle' });
    await page.waitForSelector('h1:has-text("素材库")');
    const fatal = page.__errors.filter((e) => !/favicon|404/i.test(e));
    assert.deepEqual(fatal, []);
  });

  it('导出按钮触发下载', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.click('.doc-item:first-child');
    await page.waitForSelector('.editor-top');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('button:has-text("导出")'),
    ]);
    const name = download.suggestedFilename();
    assert.match(name, /\.(docx|xlsx|pptx|pdf)$/);
    const target = path.join(TMP, name);
    await download.saveAs(target);
    const stat = fs.statSync(target);
    assert.ok(stat.size > 500, `导出文件过小：${stat.size}`);
    const head = fs.readFileSync(target).slice(0, 5).toString('latin1');
    assert.ok(head.startsWith('PK') || head.startsWith('%PDF-'), `文件头异常：${head}`);
  });

  it('DOCX 可直接导出 PDF（浏览器内触发真实下载）', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.click('.doc-item:first-child');
    await page.waitForSelector('.editor-top');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 25000 }),
      page.click('button:has-text("导出 PDF")'),
    ]);
    const target = path.join(TMP, download.suggestedFilename());
    await download.saveAs(target);
    const buffer = fs.readFileSync(target);
    assert.equal(buffer.slice(0, 5).toString('latin1'), '%PDF-');
    assert.ok(buffer.length > 1000, `PDF 过小：${buffer.length}`);
    assert.match(download.suggestedFilename(), /\.pdf$/);
  });
});
