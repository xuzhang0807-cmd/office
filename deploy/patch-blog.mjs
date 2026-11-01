#!/usr/bin/env node
/**
 * 把「在线办公」入口接进博客首页（幂等）。
 *
 * 用法：
 *   node deploy/patch-blog.mjs --blog /root/projects/blog --url https://office.example.com --dry-run
 *   node deploy/patch-blog.mjs --blog /root/projects/blog --url https://office.example.com
 *
 * 只改三处，全部幂等：
 *   1) app/components/homepage/DesignHomepage.tsx —— hero 快捷入口追加「在线办公」卡片
 *   2) app/components/homepage/HomepageContent.tsx —— 顶部导航追加「办公」
 *   3) tests/homepage.test.mjs —— 快捷卡片数量断言 4 → 5
 * 任何一处已存在标记（office-quick-link / OFFICE_URL）就跳过，可安全重复执行。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const blogRoot = path.resolve(get('--blog', '/root/projects/blog'));
const officeUrl = get('--url', 'https://office.example.com').replace(/\/+$/, '');
const dryRun = args.includes('--dry-run');

const MARKER = 'office-quick-link';
const changes = [];

function read(rel) {
  const file = path.join(blogRoot, rel);
  if (!fs.existsSync(file)) throw new Error(`找不到文件：${rel}（--blog 指向的是博客仓库根目录吗？）`);
  return { file, text: fs.readFileSync(file, 'utf8') };
}

function write(file, text, rel) {
  if (dryRun) return;
  fs.writeFileSync(file, text);
  changes.push(rel);
}

/* 1) hero 快捷入口 */
{
  const rel = 'app/components/homepage/DesignHomepage.tsx';
  const { file, text } = read(rel);
  if (text.includes(MARKER)) {
    console.log(`[skip] ${rel} 已接入`);
  } else {
    const anchor = `{ icon: "user", title: tr("购物", "Shop", "Toko"), description: tr("进入商店 ➡️", "Visit shop ➡️", "Kunjungi toko ➡️"), href: shopLinks.store },`;
    if (!text.includes(anchor)) throw new Error(`${rel} 里找不到快捷入口锚点，博客改版后需要人工确认`);
    const card = `${anchor}
    // office-quick-link：在线办公入口，随 NEXT_PUBLIC_OFFICE_URL 配置
    { icon: "articles", title: tr("在线办公", "Office", "Kantor online"), description: tr("文档 · 表格 · 演示 · PDF", "Docs · Sheets · Slides · PDF", "Dokumen · Spreadsheet · Slide · PDF"), href: OFFICE_URL },`;
    const withConst = text.replace(
      'const ASSETS = "/design/home-0-01";',
      `const ASSETS = "/design/home-0-01";
// 在线办公工具站入口（未配置时回退到占位域名，不影响构建）
const OFFICE_URL = (process.env.NEXT_PUBLIC_OFFICE_URL?.trim() || "${officeUrl}").replace(/\\/$/, "");`,
    );
    const patched = withConst.replace(anchor, card);
    write(file, patched, rel);
    console.log(`[patch] ${rel} 增加快捷入口 → ${officeUrl}`);
  }
}

/* 2) 顶部导航 */
{
  const rel = 'app/components/homepage/HomepageContent.tsx';
  const { file, text } = read(rel);
  if (text.includes('OFFICE_URL')) {
    console.log(`[skip] ${rel} 已接入`);
  } else {
    const anchor = `    { label: tr("产品", "Products", "Produk"), href: "/#products" },`;
    if (!text.includes(anchor)) throw new Error(`${rel} 里找不到导航锚点，需要人工确认`);
    const patched = text
      .replace(
        'export function HomepageHeader(',
        `const OFFICE_URL = (process.env.NEXT_PUBLIC_OFFICE_URL?.trim() || "${officeUrl}").replace(/\\/$/, "");

export function HomepageHeader(`,
      )
      .replace(anchor, `${anchor}
    { label: tr("办公", "Office", "Kantor"), href: OFFICE_URL },`);
    write(file, patched, rel);
    console.log(`[patch] ${rel} 增加导航项`);
  }
}

/* 3) 测试断言 */
{
  const rel = 'tests/homepage.test.mjs';
  const file = path.join(blogRoot, rel);
  if (!fs.existsSync(file)) {
    console.log(`[skip] ${rel} 不存在`);
  } else {
    const text = fs.readFileSync(file, 'utf8');
    const target = 'assert.equal((output.match(/class="fh-quick-card /g) || []).length, 4);';
    if (!text.includes(target)) {
      console.log(`[skip] ${rel} 断言已变更或不存在`);
    } else {
      write(file, text.replace(target, target.replace(', 4)', ', 5)')), rel);
      console.log(`[patch] ${rel} 快捷卡片数量 4 → 5`);
    }
  }
}

console.log(dryRun ? `\n[dry-run] 未写入任何文件。` : `\n完成，改动 ${changes.length} 个文件：\n${changes.map((c) => ` - ${c}`).join('\n')}`);
console.log(`\n别忘了在博客 .env 里加：NEXT_PUBLIC_OFFICE_URL=${officeUrl}`);
