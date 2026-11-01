#!/usr/bin/env node
/**
 * 轻量自检：没有引入 ESLint 全家桶，只做能真正挡住问题的静态检查。
 * 1) 所有 server/*.js 能被解析（node --check）
 * 2) 前端源码里不允许出现 console.log / debugger
 * 3) 不允许把密钥写进前端（m2a_ 前缀）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const problems = [];

function walk(dir, filter, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'data') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

const serverFiles = walk(path.join(root, 'server'), (f) => f.endsWith('.js'));
for (const file of serverFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    problems.push(`语法错误：${path.relative(root, file)}\n${error.stderr?.toString() || error.message}`);
  }
}

const webFiles = walk(path.join(root, 'web', 'src'), (f) => /\.(js|jsx)$/.test(f));
for (const file of webFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  if (/\bdebugger\b/.test(text)) problems.push(`残留 debugger：${rel}`);
  if (/console\.log\(/.test(text)) problems.push(`前端残留 console.log：${rel}`);
  if (/m2a_[A-Za-z0-9]{8,}/.test(text)) problems.push(`前端出现疑似密钥：${rel}`);
}

if (problems.length) {
  console.error(`lint 失败（${problems.length}）：`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`lint 通过：server ${serverFiles.length} 个文件，web ${webFiles.length} 个文件`);
