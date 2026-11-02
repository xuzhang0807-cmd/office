# pdf 能力服务

PDF 的转换与页级操作服务。三块职责：

1. **页级操作**：拆分 / 删除 / 合并 / 旋转 / 水印 / 重排 / 元数据
2. **文字层**：pdf.js 跑在 Node 里抽正文（pdf-lib 只能改结构，读不了文字）
3. **排版**：DOCX / XLSX / PPTX 模型 → PDF（纯 JS + pdf-lib，不依赖 LibreOffice）

| | |
| --- | --- |
| 端口 | `32204`（`OFFICE_PDF_PORT`） |
| 依赖 | `pdf-lib` 1.17、`@pdf-lib/fontkit` 1.1、`pdfjs-dist` 6.4、`@office/shared` |
| 入口 | `src/index.js` |
| 操作表 | `src/ops.js` |
| 实现 | `convert/pdf.js`（页操作）· `convert/pdftext.js`（文字层）· `convert/topdf.js`（排版）· `convert/fonts.js`（字体探测） |
| 测试 | `test/pdf.test.mjs` |

## 单独跑

```bash
node pdf/src/index.js          # :32204
npm --workspace @office/pdf test
docker compose up -d --build pdf
```

## 操作（15 个）

| op | 入参 | 说明 |
| --- | --- | --- |
| `info` | `buffer` | 页数、各页尺寸、字体名 |
| `extract` | `buffer`, `pages`（`"1-2,4"` / `"all"`） | 提取指定页为新 PDF |
| `delete` | `buffer`, `pages` | 删除指定页（不允许删完） |
| `merge` | `buffers[]` | 依序合并多份 |
| `rotate` | `buffer`, `pages`, `angle` | 旋转页 |
| `watermark` | `buffer`, `text`, `opacity`, `size`, `color` | 平铺水印（中文可用） |
| `reorder` | `buffer`, `order[]` | 按给定顺序重排全部页 |
| `create` | `title`, `pages`, `width`, `height` | 新建空白/带标题 PDF |
| `metadata` | `buffer`, `title/author/subject/keywords` | 写入元数据 |
| `text` | `buffer`, `maxPages?` | 文字层提取（整篇） |
| `pages` | `buffer`, `maxPages?` | 文字层提取（逐页） |
| `fromHtml` | `html`, `title?` | DOCX 的 HTML 模型 → PDF |
| `fromXlsx` | `model`, `title?` | 工作表模型 → PDF（每表一页） |
| `fromPptx` | `model`, `title?` | 幻灯片模型 → PDF（每页一张） |
| `fonts` | — | 字体探测结果（诊断） |

```bash
# 看字体是否就位（容器里必须是 TrueType，不能是 CFF）
curl -s localhost:32204/rpc -H 'content-type: application/json' \
  -d '{"op":"fonts","args":{}}'

# 中文排版
curl -s localhost:32204/rpc -H 'content-type: application/json' \
  -d '{"op":"fromHtml","args":{"html":"<h1>标题</h1><p>中文正文</p>","title":"x"}}' | head -c 120
```

## 字体（踩过的坑）

`convert/fonts.js` 按顺序探测系统 CJK 字体：

- ✅ `fonts-wqy-zenhei`（TrueType）—— 镜像里装的就是它
- ❌ `fonts-noto-cjk`（CFF 轮廓）—— fontkit 的 `CFFSubset` 会在异步队列抛 `RangeError`，**进程直接挂，try/catch 抓不到**

`OFFICE_PDF_FONT` 可指定字体文件，`OFFICE_PDF_FONT_CACHE` 是子集缓存目录（容器里指到 tmpfs）。

## 错误语义

| 场景 | 状态码 | `code` |
| --- | --- | --- |
| 缺 `buffer` / base64 非法 | 400 | `MISSING_BUFFER` |
| `pages` 缺失或越界 | 400 | `BAD_PAGES` |
| `order` 不是数组 / 页数不匹配 | 400 | `BAD_ORDER` |
| `buffers` 为空 | 400 | `EMPTY_MERGE` |
| 缺 `model` | 400 | `NO_MODEL` |
| 未知操作 | 400 | `UNKNOWN_OP` |

## 改这个模块时

- 页操作用 `pdf-lib`；读文字必须用 `pdfjs-dist` 的 legacy build（Node 里没有 DOM）
- `pdftext.js` 按 `transform[5]` 行基线重组 text item——不这么做空格会乱插
- 排版不支持分栏、脚注、浮动图片、自动目录；表格不跨页重复表头
- 加操作：`ops.js` 加条目 → `portal/src/capability.js` 加方法 → 门户路由调用 → `test/` 补用例
- 不 import `portal/`，不 import 其它能力服务（`npm run lint` 会拦）
