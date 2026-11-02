# pptx 能力服务

PowerPoint 演示文稿的转换服务。**只管幻灯片模型 ⇄ .pptx**，外加「结构化大纲 → 整套幻灯片」。

AI 不在这里——门户负责调模型，本服务只把结构化大纲排成幻灯片。

| | |
| --- | --- |
| 端口 | `32203`（`OFFICE_PPTX_PORT`） |
| 依赖 | `pptxgenjs` 4.0、`jszip` 3.10、`fast-xml-parser` 5.11、`@office/shared` |
| 入口 | `src/index.js` |
| 操作表 | `src/ops.js` |
| 转换实现 | `src/convert/pptx.js` |
| 测试 | `test/pptx.test.mjs` |

## 单独跑

```bash
node pptx/src/index.js          # :32203
npm --workspace @office/pptx test
docker compose up -d --build pptx
```

## 操作

| op | 入参 | 出参 | 说明 |
| --- | --- | --- | --- |
| `export` | `model`, `title?` | `buffer`(base64) `ext` `mime` `bytes` | 模型 → .pptx |
| `import` | `buffer`(base64) | `model` | .pptx → 模型 |
| `outline` | `outline{title,slides[]}`, `theme?` | `model` | 结构化大纲 → 幻灯片模型 |
| `blank` | `theme?` | `model` | 空白演示（含封面） |
| `text` | `model` | `text` `pageCount` | 逐页文本（供 AI 分析） |

模型形状：

```js
{
  width: 1280, height: 720,
  slides: [ { background: '#0B1220', elements: [
    { type: 'text', x, y, w, h, text, role: 'title', size, color, bold },
    { type: 'rect' | 'table' | 'image', ... }
  ] } ]
}
```

`theme` 取 `midnight` / `light` / `forest`（见 `convert/pptx.js` 的主题表）。

```bash
curl -s localhost:32203/rpc -H 'content-type: application/json' \
  -d '{"op":"blank","args":{"theme":"light"}}' | head -c 200
```

## 错误语义

| 场景 | 状态码 | `code` |
| --- | --- | --- |
| 缺 `model` | 400 | `NO_MODEL` |
| `outline.slides` 不是数组 | 400 | `BAD_OUTLINE` |
| 缺 `buffer` / base64 非法 | 400 | `MISSING_BUFFER` |
| 无 ZIP 签名 / 解析失败 | 400 | `BAD_PPTX` |
| 未知操作 | 400 | `UNKNOWN_OP` |

## 改这个模块时

- 换实现只改 `src/convert/pptx.js`；`ops.js` 的 op 名与参数名是门户的调用契约，别动
- 加操作：`ops.js` 加条目 → `portal/src/capability.js` 加方法 → 门户路由调用 → `test/` 补用例
- 主题色板、字号阶梯、版式坐标都在 `convert/pptx.js` 顶部常量里
- 导入是结构化还原：复杂动画、母版会被简化
- 不 import `portal/`，不 import 其它能力服务（`npm run lint` 会拦）
