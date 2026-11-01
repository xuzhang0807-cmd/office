# syntax=docker/dockerfile:1.7
# 多阶段：构建前端 → 只带运行期依赖的运行时镜像
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci --no-audit --no-fund
COPY web ./web
RUN npm --workspace web run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    OFFICE_HOST=0.0.0.0 \
    OFFICE_PORT=32110 \
    OFFICE_DATA_DIR=/data

# 中文字体：PDF 水印/标题需要嵌入 CJK 字形，否则只能退化为 ASCII。
# 选 TrueType(glyf) 的文泉驿而不是 Noto CJK：后者是 CFF 轮廓，fontkit 的
# CFFSubset 在 subset 时会在异步队列里抛 RangeError 直接打挂进程。
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-wqy-zenhei \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
COPY --from=build /app/web/dist ./web/dist

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 32110

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.OFFICE_PORT||32110)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
