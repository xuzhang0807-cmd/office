# docx 能力服务

Word 文档的转换服务。**只管 HTML ⇄ .docx**，不碰数据库、会话、密钥、配额。

| | |
| --- | --- |
| 端口 | `32201`（`OFFICE_DOCX_PORT`） |
| 依赖 | `docx` 9.15、`mammoth` 1.13、`@office/shared` |
| 入口 | `src/index.js` |
| 操作表 | `src/ops.js` |
| 转换实现 | `src/convert/docx.js` |
| 测试 | `test/docx.test.mjs` |

## 单独跑

```bash
node docx/src/index.js          # :32201
npm --workspace @office/docx test
docker compose up -d --build docx
```

## 操作

| op | 入参 | 出参 | 说明 |
| --- | --- | --- | --- |
| `export` | `html`, `title?` | `buffer`(base64) `ext` `mime` `bytes` | HTML → .docx |
| `import` | `buffer`(base64), `filename?` | `html` `messages` `name` | .docx → HTML |
| `text` | `buffer`(base64) | `text` | .docx → 纯文本（供 AI 分析） |

```bash
curl -s localhost:32201/rpc -H 'content-type: application/json' \
  -d '{"op":"export","args":{"html":"<h1>标题</h1><p>正文</p>","title":"测试"}}' | head -c 200
```

## 错误语义

| 场景 | 状态码 | `code` |
| --- | --- | --- |
| `html` 不是字符串 | 400 | `BAD_HTML` |
| 缺 `buffer` | 400 | `MISSING_BUFFER` |
| base64 非法 | 400 | `MISSING_BUFFER` |
| 无 ZIP 签名 / 解析失败 | 400 | `BAD_DOCX` |
| 未知操作 | 400 | `UNKNOWN_OP` |

用户传了坏文件一律 400，绝不用 500 表达。

## 改这个模块时

- 换实现只改 `src/convert/docx.js`，`ops.js` 的签名别动（门户按 op 名调用）
- 加操作：`ops.js` 加条目 → `portal/src/capability.js` 加方法 → 门户路由调用 → `test/` 补用例
- 导出模板、样式映射都在 `convert/docx.js` 顶部常量里，改样式不用碰服务层
- 不 import `portal/`，不 import 其它能力服务（`npm run lint` 会拦）
