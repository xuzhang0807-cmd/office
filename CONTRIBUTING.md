# 贡献与迭代约定

## 模块边界（最重要）

```
portal  ──HTTP──▶  docx / xlsx / pptx / pdf
   │
   └──▶  shared（纯函数）
```

- **门户不许 `import` 任何能力服务的实现**。要格式转换，走 `portal/src/capability.js`。
- **能力服务不许 `import` 门户的任何东西**。它们不知道用户、会话、数据库的存在。
- **能力服务之间不许互相 `import`**。需要组合时由门户编排（例如 docx→pdf 是门户先拿 HTML 再调 pdf）。
- `shared` 只放无状态纯函数与协议胶水，不许出现业务概念。

`npm run lint` 会检查这三条，越界直接失败。

## 目录自包含

每个能力目录都能独立理解、独立测试、独立部署：

```
docx/
├── package.json      自己的依赖（不共享门户的）
├── README.md         端口 / 操作表 / 错误码 / 改动指引
├── src/index.js      启动
├── src/ops.js        操作表
├── src/convert/      转换实现
└── test/             本模块单测
```

改 PPT 只看 `pptx/`，不用读门户代码。

## 新增一个能力操作

1. 在该服务 `src/ops.js` 里加一个 `{ meta, handler }` 条目
2. 在 `portal/src/capability.js` 里暴露对应方法
3. 在门户路由里调用它（不要在路由里直接写转换逻辑）
4. 补 `<能力>/test/<能力>.test.mjs` 的用例

## 新增一个能力服务（第五种格式）

1. 新建 `新格式/`，复制 `docx/` 的骨架（`package.json` / `README.md` / `src/` / `test/`）
2. 根 `package.json` 的 `workspaces` 与 `test` 脚本加进去
3. `portal/src/config.js` 的 `services` 加一项，`capability.js` 加一组方法
4. `docker-compose.yml` 加一个 service（照抄 docx 那段，改 `SERVICE` 与端口）
5. `tests/helpers/stack.mjs` 的 `SERVICE_DEFS` 加一项

## 其他约定

- 只维护 `README.md`、`CONTRIBUTING.md` 与各模块 `README.md`，不新增进度/报告类文档
- 不提交 `.env*`（`.example` 除外）、`data/`、`dist/`、`node_modules/`
- 提交前 `npm run check`（lint + 全部测试）必须通过；改 UI 再加 `npm run test:e2e`
- 转换器改动必须补往返用例（导入 → 模型 → 导出 → 再导入）
- 能力服务保持零构建：只用 Node 原生 + 少量依赖
- 前端不接触任何密钥；模型调用必须经 `/api/ai/*`
- 版本号跟根 `package.json` 走，小版本用 `vX.Y.Z` tag
