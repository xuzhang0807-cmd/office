# shared 共享层

无状态纯函数 + 服务协议骨架。**不含任何业务概念**（没有用户、文档、素材、配额）。

被 4 个能力服务和门户共同依赖，所以改动要格外保守。

| 文件 | 内容 |
| --- | --- |
| `src/util.js` | `HttpError`、`slugify`、`clamp`、`pick`、`nowIso`、`parsePages` 等纯函数 |
| `src/html.js` | HTML ↔ 块模型（标题/段落/列表/表格/引用），docx 与 pdf 排版共用 |
| `src/http.js` | `jsonBody`（可配上限）、`errorHandler`（统一 `{ok:false,error}`）、`asyncRoute` |
| `src/service.js` | 能力服务骨架：`/health`、`/capabilities`、`/rpc`、`decodeBuffer`、`encodeBuffer`、`startService` |
| `src/index.js` | 统一出口 |

## 服务协议（所有能力服务一致）

```http
GET  /health        → { ok:true, data:{ service, version, uptimeMs, status:'up' } }
GET  /capabilities  → { ok:true, data:{ service, version, ops:[{op,input,output}] } }
POST /rpc           { "op":"<操作名>", "args":{...} }
                    → { ok:true, data:{...} }
                    → { ok:false, error:{ message, code } }
```

- 二进制统一 base64，字段名固定 `buffer`
- 用户错误一律 4xx + `code`，绝不用 500
- 门户侧：4xx 原样透传；不可达 → `502 SERVICE_UNAVAILABLE`；超时 → `504 SERVICE_TIMEOUT`

## 用法

```js
import { HttpError, slugify } from '@office/shared/util';
import { decodeBuffer, encodeBuffer, createServiceApp, startService } from '@office/shared/service';

export const ops = {
  ping: { meta: { input: '(none)', output: 'pong' }, handler: async () => ({ pong: true }) },
};

startService({ name: 'demo', version: '1.0.0', ops, port: 32999 });
```

## 边界

- 不许 import 任何能力服务或门户的代码（`npm run lint` 会拦）
- 不许出现业务概念（用户、文档、素材、密钥）
- 这里只放「多处以相同语义使用」的东西；只有一个调用方就别放进来
