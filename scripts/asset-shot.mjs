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

// 注册新账号
await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
await page.click('text=去注册');
await page.fill('#displayName', '素材验收');
await page.fill('#email', `asset-${Date.now()}@example.com`);
await page.fill('#password', 'password123');
await page.click('button[type=submit]');
await page.waitForSelector('.quick-card');

// 素材库 → 用内置模型生成一张图（走完整 AI 链路并入库）
await page.goto(`${BASE}/#/assets`, { waitUntil: 'networkidle' });
await page.waitForSelector('h1:has-text("素材库")');
await page.fill('input[placeholder^="例如：深色科技感的办公协作插画"]', '扁平风格的团队协作办公场景插画，蓝紫配色，无文字');
await page.click('button:has-text("生成")');
console.log('生成中…（真实调用 muse2api，约 40-60s）');
await page.waitForSelector('.asset-card img', { timeout: 180000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '13-assets-ai-generated.png') });
console.log('shot 13-assets-ai-generated');

// 素材插进 DOCX
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('.quick-card:has-text("DOCX")');
await page.waitForSelector('.doc-page .ProseMirror');
await page.click('text=素材');
await page.waitForSelector('.side-panel .asset-card', { timeout: 30000 });
await page.click('.side-panel .asset-card');
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(OUT, '14-docx-with-asset.png') });
const imgs = await page.$$eval('.doc-page .ProseMirror img', (n) => n.map((i) => i.src.slice(0, 40)));
console.log('docx images:', imgs);

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
