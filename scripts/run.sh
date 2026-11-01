#!/usr/bin/env bash
# 启动 office 服务（开发用，前台）
set -eu
cd /root/projects/office
export OFFICE_PORT="${OFFICE_PORT:-32110}"
export OFFICE_HOST="${OFFICE_HOST:-0.0.0.0}"
exec node server/src/index.js
