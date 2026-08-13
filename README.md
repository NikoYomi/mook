# Mook

> Mook is an AI-powered self-hosted SSH terminal and VPS management tool.

**Mook** 是一个 AI 驱动的自托管 SSH 终端与服务器管理工具：一个 Docker 容器、一个入口，管理你所有服务器。

- 🔐 单密码登录（首次运行引导设置，密码加密存储）
- 🖥️ Web SSH 终端（xterm.js，多标签、断线检测、自动重连）
- 🏷️ 服务器管理（增删改、标签分组、密码 / 私钥认证）
- 🤖 AI 助手（OpenAI 兼容接口，支持 DeepSeek 等；命令生成、日志分析）
- 🐳 单容器 Docker 部署，端口 **5866**

## 快速开始（Docker）

```bash
cd docker
docker compose up -d --build
```

然后访问：

```text
http://localhost:5866
```

首次访问会引导你设置管理员密码。也可以用环境变量预设密码：

```yaml
# docker/docker-compose.yml
environment:
  - MOOK_PASSWORD=你的密码   # 可选
```

## Docker 构建失败排查（国内网络）

`docker compose up -d --build` 需要联网下载三类东西，任一失败都会中断构建：

| 依赖 | 默认地址 | 失败现象 |
| --- | --- | --- |
| Docker 基础镜像 | Docker Hub（可被 daemon 镜像加速器改写） | `failed to resolve source metadata for docker.io/library/...: 401 Unauthorized` |
| Go 模块 | `https://goproxy.cn,direct`（本项目默认） | `proxy.golang.org ... dial tcp ... i/o timeout` |
| npm 包 | `https://registry.npmmirror.com`（本项目默认） | npm 下载超时 / ECONNRESET |

常见问题与解决办法：

1. **基础镜像拉取失败**：多为 Docker 守护进程配置了失效或需认证的镜像加速器（例如 `docker.fnnas.com` 返回 401）。
   - 删除或更换 `registry-mirrors` 后重启 Docker（Windows Docker Desktop：Settings → Docker Engine；Linux：编辑 `/etc/docker/daemon.json`）。
   - 使用自建镜像站（如 `dockercat.snty.de`）时，可把它加进 `registry-mirrors`，或用 `MOOK_REGISTRY` 直接指定前缀（路径约定以你的镜像站为准，常见为 `dockercat.snty.de/library`）。
   - 用 `docker pull alpine:3.24` 验证加速器是否生效。
2. **Go 模块下载超时**：本项目默认已用 `https://goproxy.cn,direct`；如仍失败可换成 `https://goproxy.io,direct` 等。
3. **npm 下载超时**：本项目默认已用 `https://registry.npmmirror.com`。

一键构建（全部走国内可达源，在 `docker/` 目录下）：

```bash
# Linux / macOS
MOOK_REGISTRY=dockercat.snty.de/library \
MOOK_NPM_REGISTRY=https://registry.npmmirror.com \
MOOK_GOPROXY=https://goproxy.cn,direct \
docker compose up -d --build

# Windows PowerShell
$env:MOOK_REGISTRY="dockercat.snty.de/library"
$env:MOOK_NPM_REGISTRY="https://registry.npmmirror.com"
$env:MOOK_GOPROXY="https://goproxy.cn,direct"
docker compose up -d --build
```

> 注意：`MOOK_REGISTRY` 只影响 Docker 基础镜像；Go 模块和 npm 分别由 `MOOK_GOPROXY`、`MOOK_NPM_REGISTRY` 控制，**Docker 镜像加速站无法替代 Go / npm 代理**。

## 本地开发

环境要求：Node 20+、Go 1.23+。

```bash
# 终端 1：后端（端口 5866）
cd backend
go mod tidy
go run .

# 终端 2：前端（Vite 开发服务器，代理到 5866）
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`。

## 一键构建

```bash
# Linux / macOS
./scripts/build.sh

# Windows
.\scripts\build.ps1
```

构建完成后，前端产物在 `frontend/dist`，后端单文件在 `backend/mook`（Windows 为 `mook.exe`）。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| MOOK_PORT | 5866 | HTTP 服务端口 |
| MOOK_DATA | ./data | 数据目录（SQLite 与密钥） |
| MOOK_DIST | ./dist | 前端静态资源目录 |
| MOOK_PASSWORD | 空 | 可选：预设初始管理员密码 |
| MOOK_SECRET | 自动生成 | 可选：凭据加密密钥 |

## AI 配置

在「设置」页填写：

- 接口地址：默认 `https://api.deepseek.com`（任意 OpenAI 兼容接口均可）
- 模型：默认 `deepseek-chat`
- API Key：DeepSeek 等平台的密钥

未配置 API Key 时，AI 功能不可用，但不影响 SSH 使用。

## 项目结构

```text
mook/
├── backend/     # Go 后端（API / 认证 / SSH / WebSocket / AI / SQLite）
├── frontend/    # React + TypeScript + Tailwind + xterm.js
├── docker/      # Dockerfile 与 docker-compose
├── docs/        # 文档
├── scripts/     # 构建脚本
└── README.md
```

## 安全说明

- 密码使用 bcrypt 哈希；SSH 密码、私钥、AI Key 均加密存储
- 登录有次数限制（5 次失败锁定 15 分钟）
- 会话有效期 7 天
- 建议通过 Caddy / Nginx 反向代理启用 HTTPS
- v0.1 暂不校验 SSH 主机指纹（known_hosts），后续版本完善

## 路线图

- v0.1：基础 SSH + AI（当前）
- v0.5：文件管理 + Docker 可视化管理
- v1.0：Agent + Relay 中转同步
- v2.0：AI DevOps 助手

## 文档

- [API 一览](docs/API.md)
- 设计方案与完成情况记录见「计划」文件夹