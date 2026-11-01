# 贡献与迭代约定

- 只维护 `README.md` 与本文件，不新增进度/报告类文档。
- 不提交 `.env*`（`.example` 除外）、`data/`、`dist/`、`node_modules/`。
- 提交前必须 `npm run check`（lint + 全部单元/接口测试）通过；涉及 UI 的改动再加跑 `npm run test:e2e`。
- 服务端保持零构建：只用 Node 原生能力 + 少量依赖，避免引入打包链。
- 前端不接触任何密钥；所有模型调用必须经 `/api/ai/*`。
- 新增文档类型时，同步更新：`server/src/routes/documents.js` 的 `KINDS`、`web/src/pages/Editor.jsx` 的分支、`web/src/lib/api.js` 的 `KIND_META`、README 能力矩阵。
- 转换器改动必须补 `tests/convert.test.mjs` 的往返用例（导入 → 模型 → 导出 → 再导入）。
- 版本号跟 `package.json` 走，小版本迭代用 `vX.Y.Z` tag。
