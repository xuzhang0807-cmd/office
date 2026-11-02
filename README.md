# 在线办公 · Office Portal

自建的 Web 在线办公工作台：**DOCX / XLSX / PPTX / PDF 四件套在线编辑**，自带**素材库**与**内置 AI 模型**（muse2api：文生图 + 文本润色/摘要/翻译/大纲）。

**模块化架构**：每个能力都是独立可部署的服务，可以单独重启、单独升级、单独换实现（甚至换语言）。门户只通过 HTTP 调用它们。

---

## 1. 架构

```
                    ┌─────────────────────────┐
   浏览器  ────────▶│  portal  :32110         │  会话 / 文档 / 素材 / 模板 / AI 网关
                    │  （唯一对外端口）        │
                    └───────────┬─────────────┘
                                │ HTTP /rpc（base64 二进制）
              ┌─────────────────┼─────────────────┬─────────────────┐
              ▼                 ▼                 ▼                 ▼
        ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
        │ docx     │     │ xlsx     │     │ pptx     │     │ pdf      │
        │ :32201   │     │ :32202   │     │ :32203   │     │ :32204   │
        └──────────┘     └──────────┘     └──────────┘     └──────────┘
         HTML⇄docx        模型⇄xlsx        模型⇄pptx        页操作/文字层/排版
```

**为什么这样切**：格式转换是最容易出问题、最需要独立升级的部分。拆开后
- 某个格式库炸了，只有那一个服务挂，门户和其它三个照常工作
- 换实现只改一个 URL：`OFFICE_PDF_URL=http://other-host:9000`
- 每个服务可以单独限内存、单独打镜像、单独回滚

---

## 2. 目录

```
office/
├── shared/           共享层：纯函数 + 服务协议骨架（不 import 任何业务模块）
│   └── src/          util.js · html.js · http.js · service.js
├── docx/             DOCX 能力服务（独立可部署）
│   ├── src/index.js  启动
│   ├── src/ops.js    操作表（export / import / text）
│   ├── src/convert/  docx.js
│   ├── test/         本模块单测
│   └── README.md     端口 / 操作 / 错误码 / 改动指引
├── xlsx/             XLSX 能力服务（export / import / csv / bounds）
├── pptx/             PPTX 能力服务（export / import / outline / blank / text）
├── pdf/              PDF 能力服务（15 个操作：页操作 / 文字层 / 排版 / 字体）
├── portal/           门户
│   ├── src/          db · auth · blobs · ai · capability（HTTP 客户端）· seed
│   ├── src/routes/   auth · documents · assets · ai
│   ├── web/          Vite + React 前端（editors / pages / components / lib）
│   └── README.md     内部结构 / 失败语义 / 降级行为
├── docker/           Dockerfile.service · Dockerfile.portal
├── tools/            prune-workspaces.mjs · healthcheck.mjs
├── tests/
│   ├── contract/     协议契约测试（真起 4 个进程）
│   ├── helpers/      stack.mjs（起整套服务）
│   ├── api.test.mjs  门户集成测试
│   └── e2e/          浏览器端到端
├── docker-compose.yml
└── scripts/          stack.mjs（本地起整套）· dev.mjs · lint.mjs
```

每个能力目录都是**自包含**的：自己的 `package.json`、`src/`、`test/`、`README.md`。
要动 PPT 就只看 `pptx/`，不用理解门户。

各模块自己的文档：

| 模块 | 端口 | 文档 |
| --- | --- | --- |
| shared | — | [shared/README.md](shared/README.md) |
| docx | 32201 | [docx/README.md](docx/README.md) |
| xlsx | 32202 | [xlsx/README.md](xlsx/README.md) |
| pptx | 32203 | [pptx/README.md](pptx/README.md) |
| pdf | 32204 | [pdf/README.md](pdf/README.md) |
| portal | 32110 | [portal/README.md](portal/README.md) |

---

## 3. 服务协议

所有能力服务遵守同一套协议，因此可以被任意实现替换。

```http
GET  /health          → { ok: true, data: { service, version, uptimeMs, status } }
GET  /capabilities    → { ok: true, data: { service, version, ops: [{ op, input, output }] } }
POST /rpc             { "op": "<操作名>", "args": { ... } }
                      → { ok: true, data: { ... } }
                      → { ok: false, error: { message, code } }
```

- 二进制入参与出参统一走 **base64**，字段名固定为 `buffer`
- 出错用 HTTP 4xx + `code`（`BAD_DOCX` / `NO_MODEL` / `MISSING_BUFFER` …），不用 500 表达用户错误
- 门户侧失败语义：能力服务 4xx 原样透传；不可达 → `502 SERVICE_UNAVAILABLE`；超时 → `504 SERVICE_TIMEOUT`

各服务操作一览：

| 服务 | 操作 |
| --- | --- |
| docx | `export` `import` `text` |
| xlsx | `export` `import` `csv` `bounds` |
| pptx | `export` `import` `outline` `blank` `text` |
| pdf | `info` `create` `extract` `delete` `merge` `rotate` `watermark` `reorder` `metadata` `text` `pages` `fromHtml` `fromXlsx` `fromPptx` `fonts` |

---

## 4. 能力矩阵

| 模块 | 在线编辑 | 导入 | 导出 | AI |
| --- | --- | --- | --- | --- |
| DOCX | 富文本（标题/列表/表格/图片/链接/对齐/引用） | `.docx` | `.docx` / `.pdf` / `.txt` | 润色、摘要、扩写、翻译、插入结果 |
| XLSX | 网格编辑、公式引擎、样式、多工作表 | `.xlsx` | `.xlsx` / `.pdf` / `.csv` | 公式生成、表格分析 |
| PPTX | 幻灯片增删改、文本框/色块/表格/图片、主题、备注 | `.pptx` | `.pptx` / `.pdf` | 主题→整套大纲→一键成稿、配图 |
| PDF | 渲染预览、缩放、旋转/删页/提取/水印/合并/重排/元数据 | `.pdf` | `.pdf` | 全文文字层提取 → 摘要/翻译/分析 |
| 素材库 | 上传/检索/标签/改名/删除 | 图片 | 直链 / Markdown 引用 | 文生图，结果自动入库 |
| 模板库 | 12 套内置模板 | — | 原文件下载 / 在线编辑 | — |

**任意格式 → PDF** 由 `pdf` 服务的 `topdf.js` 完成：纯 JS + pdf-lib，产出矢量文字（可选中、可搜索），不依赖 LibreOffice、不加容器、冷启动 0 秒。

**PDF → 文本** 由 `pdftext.js` 完成（pdf.js legacy build 跑在 Node 里），按 `transform[5]` 行基线重组 text item，避免分块导致的空格乱插。

公式引擎（浏览器端，`portal/web/src/lib/formula.js`）支持 45 个函数，含 `#DIV/0! #NAME? #REF! #ERROR #CIRCULAR` 错误传播与循环引用保护。

---

## 5. 本地开发

```bash
npm install
cp .env.example .env

# 一键起整套（4 个能力 + 门户），自动等能力就绪再启动门户
npm start

# 或分开起
node docx/src/index.js    # :32201
node xlsx/src/index.js    # :32202
node pptx/src/index.js    # :32203
node pdf/src/index.js     # :32204
node portal/src/index.js  # :32110

# 前端热更新（另开终端）
npm run dev               # 前端 :32111，/api 代理到 :32110
```

`npm start` 内部是 `scripts/stack.mjs`：先起 4 个能力、轮询 `/health`、再起门户。顺序很重要——门户启动时会通过 HTTP 生成内置模板。

首个注册账号自动成为管理员。

### 只跑某一个能力

```bash
node scripts/stack.mjs pdf --no-portal   # 只起 pdf 服务
node pdf/src/index.js                    # 更直接
npm --workspace @office/pdf test         # 只跑 pdf 的测试
```

每个能力目录都有自己的 `README.md`：端口、操作表、错误码、改动指引。
改哪个格式就只看哪个目录，不需要理解门户。

---

## 6. Docker 部署

```bash
cp .env.example .env        # 填 OFFICE_MUSE_KEY、OFFICE_BLOG_URL
docker compose build
docker compose up -d
docker compose ps
```

五个容器：`office-portal` / `office-docx` / `office-xlsx` / `office-pptx` / `office-pdf`。

**只重启某个能力**：
```bash
docker compose up -d --build pdf        # 只重建并重启 pdf
docker compose restart docx
```

**把某个能力换到别处**（例如独立机器上的 PDF 服务）：
```bash
# .env
OFFICE_PDF_URL=http://10.0.0.9:32204
```

镜像：
- `docker/Dockerfile.service` + `--build-arg SERVICE=docx|xlsx|pptx|pdf` → 每个能力一个镜像
- `docker/Dockerfile.portal` → 只含门户 + 前端产物，不含任何转换器
- 能力服务无状态、非 root 运行、`read_only` 根文件系统、`cap_drop: ALL`
- 门户数据用 bind mount `./data:/data`（命名卷首次创建归 root，uid 10001 写不进 SQLite）
- `pdf` 镜像内置 `fonts-wqy-zenhei`（TrueType）。**不要换 `fonts-noto-cjk`**：CFF 轮廓会让 fontkit 的 `CFFSubset` 在异步队列抛 `RangeError` 打挂进程

---

## 7. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OFFICE_PORT` / `OFFICE_HOST` | `32110` / `0.0.0.0` | 门户监听 |
| `OFFICE_DATA_DIR` | `./data` | SQLite 与 blob 目录 |
| `OFFICE_DOCX_URL` | `http://127.0.0.1:32201` | docx 服务地址 |
| `OFFICE_XLSX_URL` | `http://127.0.0.1:32202` | xlsx 服务地址 |
| `OFFICE_PPTX_URL` | `http://127.0.0.1:32203` | pptx 服务地址 |
| `OFFICE_PDF_URL` | `http://127.0.0.1:32204` | pdf 服务地址 |
| `OFFICE_DOCX_PORT` 等 | `32201`…`32204` | 各能力服务自身监听端口 |
| `OFFICE_SERVICE_TIMEOUT` | `60` | 能力调用超时（秒） |
| `OFFICE_SERVICE_HEAVY_TIMEOUT` | `180` | 合并等重操作超时（秒） |
| `OFFICE_PDF_FONT` / `OFFICE_PDF_FONT_CACHE` | 自动探测 / 临时目录 | PDF 中文字体 |
| `OFFICE_BLOG_URL` | `https://blog.example.com` | 顶栏「博客」按钮 |
| `OFFICE_SITE_NAME` | `在线办公` | 站点名 |
| `OFFICE_ALLOW_REGISTER` | `1` | 是否开放自助注册 |
| `OFFICE_MAX_UPLOAD_MB` | `25` | 单文件上传上限 |
| `OFFICE_MAX_JSON_MB` | `32` | 文档模型 JSON 上限 |
| `OFFICE_SESSION_DAYS` | `30` | 会话有效期 |
| `OFFICE_MUSE_KEY` | 空 | muse2api 密钥（空则读 `../muse2api/.env`） |
| `OFFICE_MUSE_BASE` | `http://127.0.0.1:18610` | muse2api 地址 |
| `OFFICE_MUSE_CHAT_MODEL` / `OFFICE_MUSE_IMAGE_MODEL` | `muse-spark` / `muse-image` | 模型名 |
| `OFFICE_QUOTA_MEMBER_CHAT` / `OFFICE_QUOTA_MEMBER_IMAGE` | `60` / `6` | 成员每日额度（`0`=禁用，`-1`=不限） |

---

## 8. 测试

```bash
npm test          # 能力服务单测 + 协议契约 + 门户集成（node:test）
npm run test:e2e  # 浏览器 E2E（需 npx playwright install chromium）
npm run lint      # 语法 + 前端卫生 + 模块边界
```

测试分层：
- `<能力>/test/*.test.mjs` —— 直接 import 该服务的 `ops.js`，不启进程，快；可单独跑
- `tests/contract/` —— 真起 4 个进程，验证协议一致性、错误码、二进制往返
- `tests/api.test.mjs` —— 起整套，验证门户的跨服务链路与降级行为
- `tests/e2e/` —— Chromium 真实操作

单独跑某一个能力的测试：

```bash
npm run test:docx     # 或 test:xlsx / test:pptx / test:pdf
npm run test:contract
npm --workspace @office/pdf test
```

当前状态：**98 项单测 + 8 项 E2E 全绿**。

---

## 9. 与博客集成

```bash
node deploy/patch-blog.mjs --blog /path/to/blog --url https://office.example.com --dry-run
node deploy/patch-blog.mjs --blog /path/to/blog --url https://office.example.com
```

幂等，只改三处：hero 快捷入口加卡片、顶部导航加「办公」、测试断言 4→5。博客侧加 `NEXT_PUBLIC_OFFICE_URL` 即可。

---

## 10. 安全与边界

- 口令 scrypt 加盐；会话 Cookie `HttpOnly` + HMAC 签名，服务端只存 token 的 SHA-256
- 游客靠签名 Cookie 生成 `guestKey`，文档/素材按 key 隔离，登录时自动认领
- 素材下载校验所有权；存储键正则白名单，禁止 `..` 穿越
- 上传按字节头嗅探真实图片类型；docx/xlsx/pptx 先验 ZIP 签名，坏文件返回 400 而非 500
- AI Key 只在服务端；配额按天在服务端记账
- CSP 默认只允许同源脚本/样式/图片
- 能力服务不接触用户身份、不碰数据库、不读密钥——它们只是纯转换器

已知限制：PDF 排版不处理分栏、脚注、浮动图片与自动目录，表格不跨页重复表头；PPTX 导入为结构化还原（复杂动画、母版会简化）；PDF 编辑器不做内容级文字编辑，只做页级操作与预览。
