#!/usr/bin/env node
/**
 * 容器健康检查。
 * 能力服务用 SERVICE 环境变量 + OFFICE_<SERVICE>_PORT 决定端口；
 * 门户用 OFFICE_PORT。两者都在这里处理，Dockerfile 只需调一次。
 */
const service = process.env.SERVICE || '';
const envKey = service ? `OFFICE_${service.toUpperCase()}_PORT` : 'OFFICE_PORT';
const port = Number(process.env[envKey] || process.env.OFFICE_PORT || (service ? 0 : 32110));
const path = service ? '/health' : '/api/health';

if (!port) {
  console.error(`[healthcheck] 无法确定端口（SERVICE=${service || '(none)'}）`);
  process.exit(1);
}

fetch(`http://127.0.0.1:${port}${path}`)
  .then((response) => {
    if (!response.ok) console.error(`[healthcheck] HTTP ${response.status}`);
    process.exit(response.ok ? 0 : 1);
  })
  .catch((error) => {
    console.error(`[healthcheck] ${error.message}`);
    process.exit(1);
  });
