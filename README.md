# Mook

> Mook is an AI-powered self-hosted SSH terminal and VPS management tool.

**Mook** 是一个 AI 驱动的自托管 SSH 终端与服务器管理工具：一个 Docker 容器、一个入口，管理你所有服务器。

当前版本：**v0.2**（GitHub Actions 自动构建镜像并发布 Release）

## ✨ 功能特性

- 🔐 **单密码登录**：首次运行引导设置，bcrypt 哈希存储，5 次失败锁定 15 分钟
- 🖥️ **Web SSH 终端**：xterm.js，多标签并行会话、断线检测、自动重连、回车历史保留
- 📊 **服务器监控面板**：实时延迟 / CPU / 内存 / 硬盘 / 下行 / 上行（2 秒轮询）
- 📁 **SFTP 文件管理**：浏览 / 上传 / 下载 / 新建目录 / 重命名 / 删除
- 🏷️ **服务器管理**：增删改、密码 / 私钥认证、一键复制 IP、上次连接时间
- 🤖 **AI 助手**：OpenAI 兼容接口（DeepSeek / OpenAI / Gemini / Kimi / 智谱 / Ollama / 自定义），自动获取模型，支持命令生成与日志分析
- 💾 **备份与还原**：一键导出 / 导入全部服务器、AI 设置与常用命令
- 🐳 **单容器 Docker 部署**：端口 **5866**，数据持久化到 `/data`

## 📥 快速开始（Docker）

```bash
cd docker
docker compose up -d --build
```

访问：

```text
http://localhost:5866
```

首次访问会引导设置管理员密码，也可用环境变量预设：

```yaml
# docker/docker-compose.yml
environment:
  - MOOK_PASSWORD=你的密码   # 可选，预设初始管理员密码
```

> 若需使用发布版镜像（免本机构建），可拉取 GitHub Actions 构建产物，见下文「镜像与发布」。

## 🚀 镜像与发布

本项目使用 GitHub Actions 在打 tag 时自动构建镜像并创建 Release：

- **镜像**：`ghcr.io/nikoyomi/mook`（以 `v0.2`、`0.2`、`latest` 等 tag 标记）
- **Release**：每次推送 `v*` tag 自动生成（含更新日志，取自 README「更新日志」一节的对应版本）

```bash
docker pull ghcr.io/nikoyomi/mook:v0.2
```

构建流程见 `.github/workflows/docker-build.yml`：Checkout → Buildx → 登录 GHCR →
`docker build-push`（多平台 amd64/arm64，GitHub Actions 缓存）→ 打 tag 时创建 Release。

> 镜像可见性：GHCR 包默认**私有**。若希望被公开检索/拉取，请在 GitHub
> 仓库页面 **Packages → mook → Package settings → Change visibility → Public**。
> Docker Hub 镜像见「一键构建」产物，可自行 `docker push` 到你的账号。

## 🐳 Docker 构建失败排查（国内网络）

`docker compose up -d --build` 需要联网下载三类东西，任一失败都会中断构建：

| 依赖 | 默认地址 | 失败现象 |
| --- | --- | --- |
| Docker 基础镜像 | Docker Hub（可被 daemon 镜像加速器改写） | `failed to resolve source metadata for docker.io/library/...: 401 Unauthorized` |
| Go 模块 | `https://goproxy.cn,direct`（本项目默认） | `proxy.golang.org ... dial tcp ... i/o timeout` |
| npm 包 | `https://registry.npmmirror.com`（本项目默认） | npm 下载超时 / ECONNRESET |

常见问题与解决办法：

1. **基础镜像拉取失败**：多为 Docker 守护进程配置了失效或需认证的镜像加速器（例如 `docker.fnnas.com` 返回 401）。
   - 删除或更换 `registry-mirrors` 后重启 Docker（Windows Docker Desktop：Settings → Docker Engine；Linux：编辑 `/etc/docker/daemon.json`）。
   - 使用自建镜像站时，可用 `MOOK_REGISTRY` 直接指定前缀。
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

## 💻 本地开发

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

## 🔨 一键构建

```bash
# Linux / macOS
./scripts/build.sh

# Windows
.\scripts\build.ps1
```

构建完成后，前端产物在 `frontend/dist`，后端单文件在 `backend/mook`（Windows 为 `mook.exe`）。

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| MOOK_PORT | 5866 | HTTP 服务端口 |
| MOOK_DATA | ./data | 数据目录（SQLite 与密钥） |
| MOOK_DIST | ./dist | 前端静态资源目录 |
| MOOK_PASSWORD | 空 | 可选：预设初始管理员密码 |
| MOOK_SECRET | 自动生成 | 可选：凭据加密密钥 |

## 🤖 AI 配置

在「设置」页填写（支持 DeepSeek、OpenAI、Gemini、Kimi、智谱、Ollama、自定义厂商）：

- **选择厂商**下拉选择，或选「自定义」并填写厂商名与接口地址
- **API Key**：填写后自动获取该密钥支持的模型
- **模型**：下拉选择获取到的模型，或切换为手动输入

未配置 API Key 时，AI 功能不可用，但不影响 SSH 使用。

## 📁 项目结构

```text
mook/
├── backend/     # Go 后端（API / 认证 / SSH / WebSocket / SFTP / AI / SQLite）
│   ├── api/         # HTTP 路由与处理
│   ├── ssh/         # SSH 终端会话与 SFTP
│   ├── websocket/   # 终端 WebSocket 桥接
│   ├── ai/          # OpenAI 兼容 AI 调用
│   ├── auth/        # 登录 / 会话 / 限流
│   └── database/    # SQLite 持久化（含增量迁移）
├── frontend/    # React + TypeScript + Tailwind + xterm.js
├── docker/      # Dockerfile 与 docker-compose
├── docs/        # 文档（API 一览）
├── scripts/     # 构建脚本
└── 改动.md       # 开发变更记录（时间 · 目的 · 关键代码）
```

## 🔒 安全说明

- 密码使用 bcrypt 哈希；SSH 密码、私钥、AI Key 均加密存储
- 登录有次数限制（5 次失败锁定 15 分钟）
- 会话有效期 7 天
- 建议通过 Caddy / Nginx 反向代理启用 HTTPS
- v0.2 暂不校验 SSH 主机指纹（known_hosts），后续版本完善

## 🗺️ 路线图

- v0.1：基础 SSH + AI
- v0.2：监控面板 + SFTP 文件管理 + 多标签会话 + AI 自动获取模型（当前）
- v0.5：文件管理增强 + Docker 可视化管理
- v1.0：Agent + Relay 中转同步
- v2.0：AI DevOps 助手

## 📄 更新日志

### v0.2

- 服务器信息面板：实时延迟 / CPU / 内存 / 硬盘 / 上下行速率，2 秒轮询
- SFTP 文件管理：浏览 / 上传 / 下载 / 新建 / 重命名 / 删除
- 多标签 SSH 终端：切换标签保留会话与历史输出
- 服务器「上次连接」时间展示
- AI 设置重构：厂商下拉 / API Key 自动获取模型 / 获取成功才显示保存
- 终端输出着色：错误行红色、提示符 / 用户输入行绿色；无换行提示符立即可见
- 服务器卡片网格最多 5 列；设置弹窗多轮布局与交互优化
- CI/CD：GitHub Actions 自动构建 GHCR 镜像并创建 Release

### v0.1

- 单密码登录（首次运行引导）
- Web SSH 终端（xterm.js）
- 服务器管理（增删改、密码 / 私钥认证）
- AI 助手（OpenAI 兼容接口，命令生成、日志分析）
- 备份与还原
- 单容器 Docker 部署

## 📚 文档

- [API 一览](docs/API.md)
- 开发变更记录见根目录 `改动.md`