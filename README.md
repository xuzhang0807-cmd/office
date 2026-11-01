# 在线办公 · Office Portal

自建的 Web 在线办公工作台：**DOCX / XLSX / PPTX / PDF 四件套在线编辑**，自带**素材库**与**内置 AI 模型**（muse2api：文生图 + 文本润色/摘要/翻译/大纲）。可以挂在博客下面当工具站，也可以独立给团队用。

- 游客可用全部编辑器与导出，文件按浏览器 Cookie 隔离
- 登录后文档落库到账号，跨设备可用
- 管理员统一管理用户角色、AI 配额与素材
- 模型密钥只存在服务端，浏览器拿不到

---

## 1. 能力矩阵

| 模块 | 在线编辑 | 导入 | 导出 | AI |
| --- | --- | --- | --- | --- |
| DOCX | 富文本（标题/列表/表格/图片/链接/对齐/引用） | `.docx` | `.docx` / `.pdf` / `.txt` | 润色、摘要、扩写、翻译、插入结果 |
| XLSX | 网格编辑、公式引擎、样式、多工作表 | `.xlsx` | `.xlsx` / `.pdf` / `.csv` | 公式生成、表格分析 |
| PPTX | 幻灯片增删改、文本框/色块/表格/图片、主题、备注 | `.pptx` | `.pptx` / `.pdf` | 主题→整套大纲→一键成稿、配图 |
| PDF | 渲染预览、缩放、旋转/删页/提取/水印/合并/重排/元数据 | `.pdf` | `.pdf` | 引用选中文字做摘要 |
| 素材库 | 上传/检索/标签/改名/删除 | 图片 | 直链 / Markdown 引用 | 文生图，结果自动入库 |
| 模板库 | 12 套内置模板（合同/周报/简历/通知/预算/库存/进度/BP/汇报/课件/PDF） | — | 原文件下载 / 在线编辑 | — |

**任意格式 → PDF 由内置排版引擎完成**（`server/src/convert/topdf.js`）：纯 JS + pdf-lib，产出矢量文字（可选中、可搜索），不依赖 LibreOffice、不需要额外容器、冷启动 0 秒。DOCX 支持标题层级/列表/表格/引用/代码/图片，XLSX 支持多表/列宽/底色/深色表头自动反白，PPTX 按幻灯片逐页等比缩放并保留背景与页码。

公式引擎支持：`SUM AVERAGE MIN MAX COUNT COUNTA COUNTIF SUMIF AVERAGEIF IF IFS AND OR NOT ROUND ROUNDUP ROUNDDOWN ABS SQRT POWER MOD INT CEILING FLOOR PI EXP LN LOG LEN LEFT RIGHT MID UPPER LOWER TRIM CONCAT CONCATENATE TEXTJOIN TEXT VALUE TODAY NOW YEAR MONTH DAY VLOOKUP HLOOKUP INDEX MATCH ISBLANK ISNUMBER ISTEXT IFERROR`，含 `#DIV/0! #NAME? #REF! #ERROR #CIRCULAR` 错误传播与循环引用保护。

---

## 2. 目录结构

```
office/
├── server/                 Express 后端（ESM，无构建步骤）
│   └── src/
│       ├── index.js        应用装配 + 启动 + 定时清理
│       ├── config.js       环境变量 / .env 解析
│       ├── db.js           node:sqlite schema 与全部查询
│       ├── auth.js         scrypt 口令、签名会话 Cookie、游客身份
│       ├── blobs.js        内容寻址存储、图片嗅探、尺寸解析
│       ├── ai.js           muse2api 网关、配额、用量日志、大纲修复
│       ├── seed.js         内置模板（代码生成，无二进制入库）
│       ├── http.js         multipart / JSON body / 响应助手
│       ├── convert/        docx / xlsx / pptx / pdf / topdf / html / fonts
│       └── routes/         auth · documents · assets · ai
├── web/                    Vite + React 前端
│   └── src/
│       ├── editors/        DocxEditor · XlsxEditor · PptxEditor · PdfEditor
│       ├── components/     TopBar · AiPanel · AssetPanel
│       ├── pages/          Home · Login · Templates · Assets · Admin · Editor
│       └── lib/            api · session · toast · formula（公式引擎）
├── tests/                  node:test（API / 转换 / 公式 / 浏览器 E2E）
├── deploy/                 nginx 示例 + deploy.sh
├── Dockerfile
└── compose.yaml
```

---

## 3. 本地开发

```bash
cd /root/projects/office
npm install                 # 安装 server + web 依赖（workspaces）
cp .env.example .env        # 按需改 OFFICE_MUSE_KEY / OFFICE_BLOG_URL
npm run build               # 构建前端到 web/dist
npm start                   # http://127.0.0.1:32110
```

前后端分离开发（热更新）：

```bash
npm run dev:server          # 后端 :32110（--watch）
npm run dev:web             # 前端 :32111，/api 代理到 32110
```

首个注册账号自动成为管理员；之后注册的都是普通成员。

### 接入 muse2api

`OFFICE_MUSE_KEY` 留空时，服务会自动读取同级仓库 `../muse2api/.env` 的 `MUSE2API_KEY`，所以本机通常不用额外配置。容器部署时因为走不到同级目录，需要显式写入 `.env`：

```dotenv
OFFICE_MUSE_KEY=m2a_xxxxxxxx
OFFICE_MUSE_BASE=http://host.docker.internal:18610
```

---

## 4. Docker 部署

```bash
cp .env.example .env        # 填 OFFICE_MUSE_KEY、OFFICE_BLOG_URL
bash deploy/deploy.sh       # 构建 + 启动 + 健康检查
docker compose logs -f office
```

- 数据在命名卷 `data`（SQLite + 内容寻址 blob）
- 默认只监听 `127.0.0.1:32110`，公网由宿主机 nginx 暴露，配置见 `deploy/nginx.office.conf`
- 容器只读根文件系统、`cap_drop: ALL`、`no-new-privileges`
- 镜像内置 `fonts-wqy-zenhei`（TrueType），PDF 中文水印与标题可正常嵌入。
  **不要换成 `fonts-noto-cjk`**：那是 CFF 轮廓，fontkit 的 `CFFSubset` 在 subset 时
  会在异步队列里抛 `RangeError` 直接打挂进程（`try/catch` 接不住）。
- 容器与 muse2api 共用 `muse2api_default` 网络，`OFFICE_MUSE_BASE` 默认 `http://muse2api:18610`

---

## 5. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OFFICE_PORT` / `OFFICE_HOST` | `32110` / `0.0.0.0` | 监听地址 |
| `OFFICE_DATA_DIR` | `./data` | SQLite 与 blob 目录 |
| `OFFICE_BLOG_URL` | `https://blog.example.com` | 顶栏「博客」按钮 |
| `OFFICE_SITE_NAME` | `在线办公` | 站点名 |
| `OFFICE_ALLOW_REGISTER` | `1` | 是否开放自助注册 |
| `OFFICE_MAX_UPLOAD_MB` | `25` | 单文件上传上限 |
| `OFFICE_MAX_JSON_MB` | `32` | 文档模型 JSON 上限 |
| `OFFICE_SESSION_DAYS` | `30` | 会话有效期 |
| `OFFICE_MUSE_KEY` | 空 | muse2api 密钥（空则读 `../muse2api/.env`） |
| `OFFICE_MUSE_BASE` | `http://127.0.0.1:18610` | muse2api 地址 |
| `OFFICE_MUSE_CHAT_MODEL` | `muse-spark` | 文本模型 |
| `OFFICE_MUSE_IMAGE_MODEL` | `muse-image` | 生图模型 |
| `OFFICE_MUSE_CHAT_TIMEOUT` | `180` | 文本超时（秒） |
| `OFFICE_MUSE_IMAGE_TIMEOUT` | `240` | 生图超时（秒） |
| `OFFICE_QUOTA_MEMBER_CHAT` | `60` | 成员每日文本次数（`0`=禁用，`-1`=不限） |
| `OFFICE_QUOTA_MEMBER_IMAGE` | `6` | 成员每日生图次数 |
| `OFFICE_PDF_FONT` | 空 | 指定 PDF 字体路径（空则自动探测） |

管理员恒为不限额度；`guest` 角色默认无 AI 权限。

---

## 6. HTTP 接口

统一响应：成功 `{ok:true,data}`，失败 `{ok:false,error:{message,code}}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/auth/register` / `login` / `logout` | 会话 |
| GET | `/api/auth/me` | 当前身份 + 配额 + 站点配置 |
| GET | `/api/meta/bootstrap` | 首页聚合（模型状态、统计） |
| GET/POST | `/api/documents` | 列表 / 新建 |
| POST | `/api/documents/import` | 上传 docx/xlsx/pptx/pdf 导入 |
| GET/PUT | `/api/documents/:id` | 读取 / 保存模型 |
| POST | `/api/documents/:id/rename` / `duplicate` | 重命名 / 复制 |
| POST | `/api/documents/:id/export` | 导出（`format` + `model`） |
| GET | `/api/documents/:id/raw` | PDF 原始流 |
| POST | `/api/documents/:id/pdf-ops` | 旋转/删除/提取/水印/合并/重排/元数据 |
| GET/POST | `/api/assets` | 素材列表（分页/标签/搜索）/ 上传 |
| GET | `/api/assets/:id/file` | 素材文件（带所有权校验） |
| PATCH/DELETE | `/api/assets/:id` | 改名打标签 / 删除 |
| GET | `/api/templates` | 模板列表 |
| GET | `/api/templates/:slug/file` | 模板原文件 |
| GET | `/api/ai/status` | 模型健康 + 配额 |
| POST | `/api/ai/chat` | 文本任务（`polish/summarize/expand/translate/outline/formula/analyze`） |
| POST | `/api/ai/outline` | 主题 → 结构化大纲（自动修复脏 JSON） |
| POST | `/api/ai/image` | 生图，结果落素材库 |
| GET | `/api/admin/overview` | 管理总览（仅 admin） |
| PATCH | `/api/admin/users/:id` | 改角色 / 停用 |

---

## 7. 测试

```bash
npm test                       # API + 转换 + 公式 + 字体（node:test）
npx playwright install chromium
npm run test:e2e               # 浏览器 E2E（真实 Chromium）
```

覆盖点：注册/登录/会话、游客隔离、四件套 CRUD 与**往返导入导出**、PDF 页操作、素材所有权与标签作用域、模板渲染、AI 配额与上游失败降级、管理权限、路径穿越、浏览器端编辑与下载。

当前状态：**66 项单测 + 8 项 E2E 全绿**。

---

## 8. 与博客集成

一条命令把入口接进博客（幂等，可重复执行）：

```bash
node deploy/patch-blog.mjs --blog /path/to/blog --url https://office.example.com --dry-run  # 先看要改什么
node deploy/patch-blog.mjs --blog /path/to/blog --url https://office.example.com            # 实际写入
```

它会做三件事，任何一处已存在标记就跳过：

1. `DesignHomepage.tsx` —— hero 快捷入口追加「在线办公」卡片
2. `HomepageContent.tsx` —— 顶部导航追加「办公」
3. `tests/homepage.test.mjs` —— 快捷卡片数量断言 4 → 5

博客侧只需再加一个环境变量：

```dotenv
NEXT_PUBLIC_OFFICE_URL=https://office.example.com
```

也可以直接放链接或 iframe：应用已允许同源嵌入（`X-Frame-Options: SAMEORIGIN`）；跨域嵌入需要把博客域名加进 `server/src/index.js` 的 CSP `frame-ancestors`。

---

## 9. 安全与边界

- 口令 scrypt 加盐；会话 Cookie `HttpOnly` + HMAC 签名，服务端只存 token 的 SHA-256
- 游客靠签名 Cookie 生成 `guestKey`，文档/素材按 key 隔离，登录时自动认领
- 素材文件下载校验所有权；存储键正则白名单，禁止 `..` 穿越
- 上传按字节头嗅探真实图片类型，不信任扩展名
- AI Key 只在服务端；配额按天在服务端记账，浏览器伪造请求无效
- CSP 默认只允许同源脚本/样式/图片，`connect-src 'self'`

已知限制：PDF 排版引擎不处理分栏、脚注、浮动图片与自动目录，表格不做跨页表头重复；PPTX 导入为结构化还原（复杂动画、母版会简化）；PDF 编辑器不做内容级文字编辑，只做页级操作与预览。
