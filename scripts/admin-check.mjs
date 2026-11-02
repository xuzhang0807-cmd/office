import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:32110';
const OUT = '/root/projects/office/.shots';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();

// 直接用浏览器上下文注册 + 登录，让 Cookie 进 ctx
await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
await page.click('text=去注册');
await page.fill('#displayName', '服务验收');
await page.fill('#email', `svc2-${Date.now()}@example.com`);
await page.fill('#password', 'password123');
await page.click('button[type=submit]');
await page.waitForSelector('.quick-card');

// 提升为 admin：直接改容器内的 SQLite
const { execSync } = await import('node:child_process');
execSync(`docker exec office-portal node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/data/office.db');
db.prepare(\\"UPDATE users SET role='admin' WHERE email LIKE 'svc2-%'\\").run();
console.log('promoted');
"`, { stdio: 'inherit' });

await page.reload({ waitUntil: 'networkidle' });
await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
const services = await page.$$eval('.quick-grid .card', (nodes) =>
  nodes.map((n) => n.textContent.replace(/\s+/g, ' ').trim()).slice(0, 6),
);
console.log('service cards:', JSON.stringify(services, null, 1));
await page.screenshot({ path: path.join(OUT, 'r6-admin-services.png') });
await browser.close();
