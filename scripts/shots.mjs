import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:32110';
const OUT = process.env.OUT || '/root/projects/office/.shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log('shot', name);
};

// 首页（游客）
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.quick-card');
await shot('01-home-guest');

// 登录页
await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
await shot('02-login');

// 注册
await page.click('text=去注册');
await page.fill('#displayName', '视觉验收');
await page.fill('#email', `shot-${Date.now()}@example.com`);
await page.fill('#password', 'password123');
await page.click('button[type=submit]');
await page.waitForSelector('.quick-card');
await shot('03-home-user');

// 模板库
await page.goto(`${BASE}/#/templates`, { waitUntil: 'networkidle' });
await page.waitForSelector('.template-card');
await shot('04-templates');

// DOCX
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('.quick-card:has-text("DOCX")');
await page.waitForSelector('.doc-page .ProseMirror');
await page.click('.doc-page .ProseMirror');
await page.keyboard.type('2026 年度工作总结');
await page.keyboard.press('Enter');
await page.keyboard.type('本年度围绕平台稳定性与交付效率两条主线推进，核心指标均有改善。');
await page.keyboard.press('Enter');
await page.keyboard.type('一、平台稳定性');
await page.waitForTimeout(600);
await shot('05-docx');

// XLSX
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('.quick-card:has-text("XLSX")');
await page.waitForSelector('table.sheet');
const cell = (r, c) => `table.sheet tbody tr:nth-child(${r}) td.cell:nth-child(${c + 1})`;
for (const [r, v] of [[1, '项目'], [2, '收入'], [3, '成本']]) {
  await page.click(cell(r, 1));
  await page.keyboard.type(v);
  await page.keyboard.press('Enter');
}
for (const [r, v] of [[1, '金额'], [2, '128000'], [3, '76000']]) {
  await page.click(cell(r, 2));
  await page.keyboard.type(v);
  await page.keyboard.press('Enter');
}
await page.click(cell(4, 1));
await page.keyboard.type('毛利');
await page.keyboard.press('Enter');
await page.click(cell(4, 2));
await page.keyboard.type('=B2-B3');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await shot('06-xlsx');

// PPTX
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('.quick-card:has-text("PPTX")');
await page.waitForSelector('.slide-thumb');
await page.click('.slide-el .txt');
await page.keyboard.press('Control+A');
await page.keyboard.type('在线办公平台 · 季度汇报');
await page.click('.slide-stage');
await page.waitForTimeout(300);
await shot('07-pptx');

// PDF
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('.quick-card:has-text("PDF")');
await page.waitForSelector('.pdf-page-wrap canvas', { timeout: 25000 });
await page.waitForTimeout(600);
await shot('08-pdf');

// 素材库
await page.goto(`${BASE}/#/assets`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await shot('09-assets');

// 管理后台
await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await shot('10-admin');

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
