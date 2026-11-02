#!/usr/bin/env node
/**
 * 裁剪根 package.json 的 workspaces，只保留镜像真正需要的模块。
 *
 * 为什么需要：根 package.json 声明 6 个 workspace，但每个镜像只 copy 其中
 * 一两个的 package.json；npm ci 会因为找不到其余目录直接失败。
 * 这里把 workspaces 改写成调用方给的白名单，devDependencies 也去掉
 * （镜像里不跑测试）。
 *
 * 用法：node tools/prune-workspaces.mjs "shared,docx"
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('用法：node tools/prune-workspaces.mjs "shared,docx"');
  process.exit(1);
}

const file = path.join(process.cwd(), 'package.json');
const root = JSON.parse(fs.readFileSync(file, 'utf8'));
root.workspaces = target.split(',').map((s) => s.trim()).filter(Boolean);
delete root.devDependencies;
fs.writeFileSync(file, `${JSON.stringify(root, null, 2)}\n`);
console.log(`[prune] workspaces = ${root.workspaces.join(', ')}`);
