# portal 门户

唯一对外端口。负责用户、会话、文档、素材、模板、AI 网关、前端静态托管。

**不含任何格式转换器**——所有 `.docx/.xlsx/.pptx/.pdf` 处理都通过 `src/capability.js` 走 HTTP 交给能力服务。

| | |
| --- | --- |
| 端口 | `32110`（`OFFICE_PORT`） |
| 入口 | `src/index.js` |
| 前端 | `web/`（Vite + React 19，构建到 `web/dist`） |

## 内部结构

| 文件 | 职责 |
| --- | --- |
| `src/config.js` | 环境变量解析、能力服务地址、超时、配额 |
| `src/db.js` | `node:sqlite` 建表与迁移（users / documents / assets / templates / usage / settings） |
| `src/auth.js` | scrypt 口令、HMAC 签名会话 Cookie、`guestKey`、`requireUser` / `requireAdmin` |
| `src/blobs.js` | 二进制落盘（按 owner 分目录）、图片类型嗅探、存储键白名单 |
| `src/capability.js` | **能力服务 HTTP 客户端**（唯一与格式转换接触的地方） |
| `src/ai.js` | muse2api 调用、提示词模板、按天配额记账 |
| `src/seed.js` | 12 套内置模板（启动时经能力服务生成） |
| `src/routes/auth.js` | 注册 / 登录 / 登出 / 当前用户 |
| `src/routes/documents.js` | 文档 CRUD、导入、导出（调用 `capability.*`） |
| `src/routes/assets.js` | 素材上传 / 检索 / 下载 / 删除 |
| `src/routes/ai.js` | AI 网关 + 后台看板（含服务状态） |

## 单独跑

```bash
node portal/src/index.js         # :32110
npm run start:portal
docker compose up -d --build portal
```

前端热更新：

```bash
npm run dev                      # 前端 :32111，/api 代理到 :32110
```

## 失败语义（`capability.js`）

| 情况 | 门户返回 |
| --- | --- |
| 能力服务 4xx | 原状态码 + 原 `code`（用户能看懂） |
| 能力服务不可达 | `502 SERVICE_UNAVAILABLE` |
| 能力服务超时 | `504 SERVICE_TIMEOUT` |
| 服务未配置 | `500 SERVICE_NOT_CONFIGURED` |

前端拿到 502/504 时提示「该功能暂不可用」，其余功能照常工作——这是拆服务换来的隔离性。

## 降级行为

- 某个能力服务挂了：其它三个格式照常，挂掉那个的导入/导出报 502
- 模板生成失败：`seed.js` 记 `failed`，不阻塞启动；服务恢复后下次启动补齐
- AI 未配置：`AI_NOT_CONFIGURED`，其余功能不受影响

## 前端

```
web/src/
├── pages/       Home · Login · Templates · Assets · Editor · Admin
├── editors/     DocxEditor · XlsxEditor · PptxEditor · PdfEditor
├── components/  TopBar · AiPanel
└── lib/         api · session · router · toast · formula（45 个函数的公式引擎）
```

前端不接触任何密钥；模型调用必须经 `/api/ai/*`。

## 改这个模块时

- 加格式能力：只改 `capability.js` + 路由，**不要在路由里写转换逻辑**
- 门户不 import `docx|xlsx|pptx|pdf/src/**`（`npm run lint` 会拦）
- 新增 API 就补 `tests/api.test.mjs` 的用例
- 前端改动后 `npm run build`（或 `npm run dev`）再验证
