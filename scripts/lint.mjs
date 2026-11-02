#!/usr/bin/env node
/**
 * 轻量自检：没有引入 ESLint 全家桶，只做能真正挡住问题的静态检查。
 * 1) 所有模块的 .js 与各模块 test/*.mjs 能被解析（node --check）
 * 2) 前端源码里不允许出现 console.log / debugger
 * 3) 不允许把密钥写进前端（m2a_ 前缀）
 * 4) 模块边界：能力服务不许 import portal，portal 不许 import 能力服务的实现
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const problems = [];

const SKIP = new Set(['node_modules', 'dist', 'data', '.git', '.shots', '.tmp', 'web']);
const MODULES = ['shared', 'docx', 'xlsx', 'pptx', 'pdf', 'portal'];

function walk(dir, filter, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name) && dir === root) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

const moduleFiles = [];
for (const mod of MODULES) {
  const dir = path.join(root, mod, 'src');
  if (fs.existsSync(dir)) moduleFiles.push(...walk(dir, (f) => f.endsWith('.js')));
}
const scriptFiles = walk(path.join(root, 'scripts'), (f) => f.endsWith('.mjs'));

/* 测试跟着模块走：docx/test/*.mjs 与 tests/ 下的集成测试也要能解析 */
const moduleTestFiles = [];
for (const mod of ['docx', 'xlsx', 'pptx', 'pdf']) {
  const dir = path.join(root, mod, 'test');
  if (fs.existsSync(dir)) moduleTestFiles.push(...walk(dir, (f) => f.endsWith('.mjs')));
}
const integrationTestFiles = walk(path.join(root, 'tests'), (f) => f.endsWith('.mjs'));

for (const file of [...moduleFiles, ...scriptFiles, ...moduleTestFiles, ...integrationTestFiles]) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    problems.push(`语法错误：${path.relative(root, file)}\n${error.stderr?.toString() || error.message}`);
  }
}

/* 模块边界：源码里出现的跨模块相对路径都视为越界 */
const BOUNDARY_RULES = [
  { from: ['docx', 'xlsx', 'pptx', 'pdf'], forbid: /from\s+['"][^'"]*\/portal\//, why: '能力服务不得依赖门户' },
  { from: ['portal'], forbid: /from\s+['"][^'"]*\/(docx|xlsx|pptx|pdf)\/src\//, why: '门户不得直接 import 能力服务实现（必须走 HTTP）' },
  { from: ['docx', 'xlsx', 'pptx', 'pdf'], forbid: /from\s+['"][^'"]*\/(docx|xlsx|pptx|pdf)\/src\//, why: '能力服务之间不得互相 import' },
];

for (const mod of MODULES) {
  const dirs = [path.join(root, mod, 'src'), path.join(root, mod, 'test')].filter((d) => fs.existsSync(d));
  for (const dir of dirs) {
    for (const file of walk(dir, (f) => f.endsWith('.js') || f.endsWith('.mjs'))) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(root, file);
      for (const rule of BOUNDARY_RULES) {
        if (!rule.from.includes(mod)) continue;
        // 排除自身模块路径
        const stripped = text.replace(new RegExp(`[^'"]*\\/${mod}\\/src\\/`, 'g'), '');
        if (rule.forbid.test(stripped)) problems.push(`模块边界违规（${rule.why}）：${rel}`);
      }
    }
  }
}

const webFiles = walk(path.join(root, 'portal', 'web', 'src'), (f) => /\.(js|jsx)$/.test(f));
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
console.log(
  `lint 通过：${moduleFiles.length} 个模块文件，${moduleTestFiles.length} 个模块测试，` +
    `${scriptFiles.length} 个脚本，${integrationTestFiles.length} 个集成测试，` +
    `${webFiles.length} 个前端文件；模块边界无越界`,
);
