# ---------- 构建参数：可用 compose 环境变量或 --build-arg 覆盖 ----------
# 国内拉取基础镜像失败（401 / 超时）时，把 BASE_IMAGE 指向可用的镜像源，例如：
#   docker.m.daocloud.io/library、docker.1ms.run/library
ARG BASE_IMAGE=docker.io/library
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG GOPROXY=https://goproxy.cn,direct

# ---------- 阶段 1：构建前端 ----------
FROM ${BASE_IMAGE}/node:26.7-alpine AS frontend
ARG NPM_REGISTRY
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --registry=${NPM_REGISTRY}
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