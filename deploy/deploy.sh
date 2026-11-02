#!/usr/bin/env bash
# 一键部署：同步 muse2api 密钥 → 构建镜像 → 起容器 → 健康检查
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[deploy] 已生成 .env，请按需修改 OFFICE_BLOG_URL 等"
fi

# 密钥优先取环境变量，其次从同级 muse2api 仓库读取，最后沿用 .env 里已有的值
KEY="${OFFICE_MUSE_KEY:-}"
if [ -z "$KEY" ] && [ -f ../muse2api/.env ]; then
  KEY="$(grep -E '^MUSE2API_KEY=' ../muse2api/.env | head -1 | cut -d= -f2- | tr -d '\r')"
fi
if [ -n "$KEY" ]; then
  if grep -q '^OFFICE_MUSE_KEY=' .env; then
    sed -i "s|^OFFICE_MUSE_KEY=.*|OFFICE_MUSE_KEY=${KEY}|" .env
  else
    printf 'OFFICE_MUSE_KEY=%s\n' "$KEY" >> .env
  fi
  echo "[deploy] 已同步 muse2api 密钥（${KEY:0:6}…）"
else
  echo "[deploy] 警告：未找到 muse2api 密钥，AI 功能将返回 AI_NOT_CONFIGURED"
fi

docker compose build
docker compose up -d

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${OFFICE_HOST_PORT:-32110}/api/health" >/dev/null 2>&1; then
    echo "[deploy] 服务已就绪：http://127.0.0.1:${OFFICE_HOST_PORT:-32110}"
    exit 0
  fi
  sleep 2
done

echo "[deploy] 健康检查超时，查看日志：docker compose logs --tail=80 portal"
exit 1
