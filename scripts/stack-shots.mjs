import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:32110';
const OUT = '/root/projects/office/.shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot', name);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.quick-card');
await shot('r1-home');

// 注册
await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
await page.click('text=去注册');
await page.fill('#displayName', '模块化验收');
await page.fill('#email', `mod-${Date.now()}@example.com`);
await page.fill('#password', 'password123');
await page.click('button[type=submit]');
await page.waitForSelector('.quick-card');

// DOCX 编辑 + 导出 PDF（跨服务链路）
await page.click('.quick-card:has-text("DOCX")');
await page.waitForSelector('.doc-page .ProseMirror');
await page.click('.doc-page .ProseMirror');
await page.keyboard.type('模块化架构验收');
await page.keyboard.press('Enter');
await page.keyboard.type('门户通过 HTTP 调用 docx / pdf 两个独立服务完成这次导出。');
await page.waitForTimeout(400);
await shot('r2-docx');

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.click('button:has-text("导出 PDF")'),
]);
const target = path.join('/tmp', download.suggestedFilename());
await download.saveAs(target);
const buf = fs.readFileSync(target);
console.log('pdf export:', buf.length, 'bytes, magic', buf.slice(0, 5).toString('latin1'));

// XLSX
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('.quick-card:has-text("XLSX")');
await page.waitForSelector('table.sheet');
const cell = (r, c) => `table.sheet tbody tr:nth-child(${r}) td.cell:nth-child(${c + 1})`;
for (const [r, c, v] of [[1, 1, '收入'], [1, 2, '1000'], [2, 1, '成本'], [2, 2, '400'], [3, 1, '毛利'], [3, 2, '=B1-B2']]) {
  await page.click(cell(r, c));
  await page.keyboard.type(v);
  await page.keyboard.press('Enter');
}
await page.waitForTimeout(400);
console.log('A3 value:', (await page.textContent(cell(3, 2))).trim());
await shot('r3-xlsx');

// PDF
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('.quick-card:has-text("PDF")');
await page.waitForSelector('.pdf-page-wrap canvas', { timeout: 25000 });
await page.waitForTimeout(500);
await shot('r4-pdf');

// 后台（含服务状态）
await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('r5-admin');

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
