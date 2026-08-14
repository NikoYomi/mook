# ---------- 构建参数：可用 compose 环境变量或 --build-arg 覆盖 ----------
# GitHub Actions 环境已能直连原生源，默认无需任何镜像。
# 国内网络构建时可覆盖为国内源（BASE_IMAGE / NPM_REGISTRY / GOPROXY），
# 备份见「项目中转文件\备份国内构建」。
ARG BASE_IMAGE=docker.io/library
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG GOPROXY=https://proxy.golang.org,direct

# ---------- 阶段 1：构建前端 ----------
FROM ${BASE_IMAGE}/node:26.7-alpine AS frontend
ARG NPM_REGISTRY
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install --registry=${NPM_REGISTRY} --no-package-lock
COPY frontend/ ./
RUN npm run build

# ---------- 阶段 2：构建后端 ----------
FROM ${BASE_IMAGE}/golang:1.26-alpine AS backend
ARG GOPROXY
WORKDIR /app/backend
COPY backend/ ./
RUN GOPROXY=${GOPROXY} go mod tidy && CGO_ENABLED=0 go build -ldflags="-s -w" -o /mook .

# ---------- 阶段 3：运行 ----------
FROM ${BASE_IMAGE}/alpine:3.24
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend /mook /app/mook
COPY --from=frontend /app/frontend/dist /app/dist
ENV MOOK_PORT=5866
ENV MOOK_DATA=/data
ENV MOOK_DIST=/app/dist
EXPOSE 5866
VOLUME ["/data"]
ENTRYPOINT ["/app/mook"]
