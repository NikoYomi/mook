# CLAUDE.md — Mook 项目 AI 行为守则

## 1. 项目简介与核心目标

Mook 是一个 AI 驱动的自托管 SSH 终端与 VPS 管理工具。一个 Docker 容器、一个网页入口，集中管理所有服务器。核心场景：Web SSH 终端、服务器监控、SFTP 文件管理、AI 辅助（生成命令 / 分析日志）。

## 2. 技术栈与关键依赖

- **后端**：Go 1.23+ · 标准库 net/http · gorilla/websocket · golang.org/x/crypto/ssh · pkg/sftp · modernc.org/sqlite
- **前端**：React 18 · TypeScript · Vite · Tailwind CSS 4 · xterm.js 5 · Zustand · react-router
- **存储**：SQLite（单文件，`mook.db`，随数据卷持久化）
- **部署**：Docker 多阶段构建 · docker-compose
- **CI/CD**：GitHub Actions · 多架构镜像（amd64/arm64）· 仅 Docker Hub
- **AI**：OpenAI 兼容接口（DeepSeek / OpenAI / Gemini / Kimi / 智谱 / Ollama / 自定义）

## 3. 项目结构与架构说明

```text
项目/mook/
├── backend/        # Go 后端（API / 认证 / SSH / WebSocket / SFTP / AI / SQLite）
│   ├── main.go     # 入口
│   ├── config/     # 环境变量配置
│   ├── api/        # HTTP 路由与处理（含 stats.go 监控、logging.go 访问日志）
│   ├── auth/       # 登录 / 会话 / 限流（bcrypt + Cookie）
│   ├── database/   # SQLite（含增量迁移）
│   ├── ssh/        # SSH 终端会话与 SFTP
│   ├── websocket/  # 终端 WebSocket 桥接
│   ├── ai/         # OpenAI 兼容 AI 调用
│   └── utils/      # 加密 / 随机数
├── frontend/src/
│   ├── pages/      # Login / Servers / Terminal / Settings
│   ├── components/ # Workspace / ServerInfo / FileManager / CommonCommands / AiPanel / Modal / ...
│   ├── store/      # zustand：auth / servers / commands / ai / settings
│   ├── api/        # 前端 API client
│   ├── terminal/   # TerminalTab（xterm.js）+ backgrounds
│   └── utils/      # i18n / command / aiProviders
├── docker/         # Dockerfile + docker-compose
├── docs/           # API.md、截图
├── scripts/        # build.sh / build.ps1
├── .github/workflows/docker-build.yml
└── README.md
```

**核心架构**：浏览器（React + xterm.js）→ WebSocket (/ws/terminal) → Mook Backend（Go / net/http / gorilla/websocket）→ SSH / SFTP → VPS / 服务器。AI：Mook Backend → OpenAI 兼容 API → DeepSeek / OpenAI 等。数据：SQLite（/data/mook.db）+ secret.key（凭据加密密钥）。

## 4. 开发环境搭建 & 常用命令

**环境要求**：Node 20+、Go 1.23+。

```bash
# 后端（端口 5866）
cd backend
go mod tidy
MOOK_DATA=./data go run .

# 前端（Vite 开发服务器，代理到 5866）
cd frontend
npm install
npm run dev
```

**常用命令**：
- 后端构建：`go build ./...`
- 后端检查：`go vet ./...`
- 前端类型检查：`node node_modules/typescript/bin/tsc --noEmit`
- 前端构建：`npm run build`
- Docker 构建：`docker compose up -d --build`

## 5. 代码风格与规范

- **后端 Go**：包内小写驼峰命名；路由沿用 `mux.Handle("METHOD /api/.../{id}")` 风格
- **前端 React**：组件用 PascalCase、状态用 camelCase；遵循现有语义色 token（`text-ink/soft/faint/accent/danger` 等），亮暗双主题都要可读
- **通用**：不记录隐私到日志（密码/密钥/主机/文件路径/查询串等）

## 6. 测试要求

- 测试文件放 `测试环境/`（`macos/`、`win/` 两子目录分别对应公司 Windows 与家用 macOS）
- 不得把测试/无关文件放入 `项目/mook/`
- 本地测试数据目录：macOS 用 `测试环境/macos/data/`，Windows 用 `测试环境/win/data/`
- 无自动化测试套件（后端 / 前端均无测试），验证以构建检查为主

## 7. Git 工作流与提交规范

- 推送 GitHub 前必须审核：无构建产物、无隐私信息、无无关文件
- 审核方法：`git status --short` + `git ls-files`、可疑文件名扫描
- 版本号规则：小迭代 +0.0.1；大迭代 +0.1.0；正式版 +1.0.0。版本号由用户决定
- README 更新规则：仅在重大更新（大功能添加）时更新版本号与发布描述

## 8. 关键设计原则与约束

- **轻量单容器**：一个 Docker 容器 + SQLite，不做宝塔/K8s 式复杂平台
- **标准库 net/http**：后端不引入 Gin/Echo
- **凭据加密存储**：SSH 密码/私钥、AI Key 加密后入库，接口永不返回明文
- **日志不含隐私**：访问日志只记路径（不含查询串/请求体）
- **弹窗输入框框选保护**：所有含输入框的弹窗必须使用 `frontend/src/utils/selection.ts` 的 `isDragSelectingInside()`

## 9. AI 代理行为守则

- 开始任务前按顺序阅读：PROJECT.md → AI开发规范.md → 相关专业文档 → TODO.md → CHANGELOG.md
- 发现文档与代码冲突：以代码为当前实现事实，并把差异记录到当日日志或 PROJECT.md 待确认项
- 修改代码前先理解现有架构，禁止未经确认的大规模重构
- 优先复用现有组件 / store / 工具函数
- 所有改动必须写入当日日志
- 推送前按规则完成审核

## 10. 常见陷阱 & 已知问题

- **SSH 主机指纹未校验**（`InsecureIgnoreHostKey`）——已知安全缺口，计划 v0.5 完善
- AI 端到端（真实 API Key）未做完整实测（仅接口级验证）
- Docker 镜像在真实 Docker 环境未做运行验证（CI 构建已通过）
- 多浏览器 / 手机适配未系统测试
- `docs/API.md` 缺少 v0.2.2+ 新增接口（reorder / commands use / verify-password 等）
- 前端构建在本机（macOS）缺 `@rollup/rollup-darwin-arm64`（node_modules 来自 Windows），完整 `vite build` 需在对应平台执行

## 11. 其他

- 文档体系在 `计划/` 文件夹，不在 `项目/mook/` 内
- 每日工作日志制度：当天有工作就必须创建/更新 `计划/每日日志/YYYY-MM-DD.md`
- 测试环境目录：`测试环境/macos/` 和 `测试环境/win/`

<!-- neat-freak: initialized at 2026-09-06 -->