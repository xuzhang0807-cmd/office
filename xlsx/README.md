# xlsx 能力服务

Excel 工作簿的转换服务。**只管工作表模型 ⇄ .xlsx**，外加 CSV 导出与范围估算。

公式求值不在这里——那是浏览器端编辑器（`portal/web/src/lib/formula.js`）的事，服务端只负责存与转。

| | |
| --- | --- |
| 端口 | `32202`（`OFFICE_XLSX_PORT`） |
| 依赖 | `exceljs` 4.4、`@office/shared` |
| 入口 | `src/index.js` |
| 操作表 | `src/ops.js` |
| 转换实现 | `src/convert/xlsx.js` |
| 测试 | `test/xlsx.test.mjs` |

## 单独跑

```bash
node xlsx/src/index.js          # :32202
npm --workspace @office/xlsx test
docker compose up -d --build xlsx
```

## 操作

| op | 入参 | 出参 | 说明 |
| --- | --- | --- | --- |
| `export` | `model`, `title?` | `buffer`(base64) `ext` `mime` `bytes` `title` | 模型 → .xlsx |
| `import` | `buffer`(base64), `maxRows?` | `model` | .xlsx → 模型（保留公式、样式、多表） |
| `csv` | `model`, `sheetIndex?` | `csv` | 指定工作表 → CSV |
| `bounds` | `model`, `sheetIndex?` | `bounds{rows,cols}` | 估算有内容区域 |

模型形状：

```js
{ sheets: [ { name: 'S', rows: [ [ { v: 1 }, { f: '=A1*2', v: 0 } ] ], colWidths: {...}, merges: [...] } ] }
```

```bash
curl -s localhost:32202/rpc -H 'content-type: application/json' \
  -d '{"op":"csv","args":{"model":{"sheets":[{"name":"S","rows":[[{"v":"A"},{"v":1}]]}]}}}'
```

## 错误语义

| 场景 | 状态码 | `code` |
| --- | --- | --- |
| 缺 `model` | 400 | `NO_MODEL` |
| 缺 `buffer` / base64 非法 | 400 | `MISSING_BUFFER` |
| 无 ZIP 签名 / 解析失败 | 400 | `BAD_XLSX` |
| 未知操作 | 400 | `UNKNOWN_OP` |

## 改这个模块时

- 换实现只改 `src/convert/xlsx.js`；`ops.js` 的 op 名与参数名是门户的调用契约，别动
- 加操作：`ops.js` 加条目 → `portal/src/capability.js` 加方法 → 门户路由调用 → `test/` 补用例
- 样式映射、列宽、合并单元格的处理都在 `convert/xlsx.js`
- 不 import `portal/`，不 import 其它能力服务（`npm run lint` 会拦）
