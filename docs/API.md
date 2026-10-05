# Mook API 一览

所有接口返回 JSON；除标注外均需要登录（Cookie 会话，有效期 6 小时）。

## 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/setup/status | 是否需要进行首次初始化 |
| POST | /api/setup | 首次设置管理员密码 `{password}` |
| POST | /api/login | 登录 `{username, password}`（username 省略时默认 admin） |
| POST | /api/logout | 退出登录 |
| GET | /api/me | 当前用户 |

## 账户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/me/username | 修改用户名 `{username}` |
| POST | /api/me/verify-password | 修改密码前验证当前密码 `{old_password}` |
| POST | /api/me/password | 修改密码 `{old_password, new_password}` |

## 服务器管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/servers | 服务器列表 |
| POST | /api/servers | 新增服务器 |
| PUT | /api/servers/{id} | 更新服务器 |
| DELETE | /api/servers/{id} | 删除服务器 |
| PUT | /api/servers/reorder | 拖拽排序 `{ids: [...]}` |
| GET | /api/servers/{id}/stats | 实时监控（延迟/CPU/内存/磁盘） |

服务器请求体：

```json
{
  "name": "我的 VPS",
  "host": "1.2.3.4",
  "port": 22,
  "username": "root",
  "auth_type": "password",
  "password": "xxx",
  "private_key": "",
  "tags": ["生产", "香港"]
}
```

- `auth_type` 为 `password` 时填写 `password`；为 `key` 时填写 `private_key`（PEM 私钥）
- 密码 / 私钥在服务端加密存储，接口永不返回明文

## 文件管理（SFTP）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/servers/{id}/files?path=/ | 列出目录 |
| GET | /api/servers/{id}/files/download?path=/x | 下载文件（流式） |
| POST | /api/servers/{id}/files/upload?dir=/x | 上传文件（multipart，字段名 `file`） |
| POST | /api/servers/{id}/files/mkdir | 新建目录 `{path}` |
| POST | /api/servers/{id}/files/rename | 重命名/移动 `{old_path, new_path}` |
| POST | /api/servers/{id}/files/remove | 删除文件/目录（目录递归）`{path}` |

文件列表返回：

```json
{
  "path": "/app",
  "entries": [
    { "name": "config.yml", "path": "/app/config.yml", "is_dir": false, "size": 128, "mod_time": "2026-08-13 10:00", "mode": "-rw-r--r--" }
  ]
}
```

## 常用命令

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/commands | 常用命令列表 |
| PUT | /api/commands | 全量保存常用命令 |
| POST | /api/commands/{id}/use | 使用某条命令（计数 +1，用于自动排序） |

## 备份与还原

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/backup/export | 导出加密备份 `{password}`（服务器配置含凭据密文 + AI 设置 + 常用命令，整包口令加密） |
| POST | /api/backup/restore | 还原备份：加密版 `{password, data}` 或旧版明文 `{version, servers, settings, common_commands}` |
| GET | /api/backup | 导出明文结构备份（兼容旧客户端，凭据为服务端加密密文；新前端改用 POST export） |

备份文件结构（前端导出时整包使用口令加密，`data` 为密文）：

```json
{
  "version": 1,
  "exported_at": "2026-08-13T10:00:00Z",
  "servers": [ { "name": "...", "host": "...", "port": 22, "username": "root", "auth_type": "password", "password_enc": "...", "private_key_enc": "", "tags": ["生产"] } ],
  "settings": { "ai_base_url": "...", "ai_model": "...", "ai_api_key": "...", "ai_validated": "1", "ai_provider_keys": "{...}", "ai_custom_providers": "[...]" }
}
```

## AI

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/settings/ai | 读取 AI 设置（不返回 Key），含 `validated` 状态 |
| POST | /api/settings/ai | 保存 AI 设置 `{base_url, model, api_key}`，保存时自动校验连通性，返回 `{ok, validated, error}` |
| GET | /api/ai/models | 获取模型列表 `?base_url=&api_key=`（api_key 省略时用已保存的密钥） |
| POST | /api/ai/command | 生成命令 `{prompt}` |
| POST | /api/ai/analyze | 分析日志 `{content}` |

`GET /api/settings/ai` 响应：

```json
{
  "base_url": "https://api.deepseek.com",
  "model": "deepseek-chat",
  "has_api_key": true,
  "validated": true,
  "custom_providers": [ { "name": "...", "base_url": "...", "model": "...", "has_api_key": true } ],
  "provider_keys": { "https://api.deepseek.com": true, "https://api.openai.com/v1": false }
}
```

说明：
- API Key 按厂商（规范化 `base_url`）独立加密存储，切换厂商不会互相覆盖；`provider_keys` 供前端切换厂商时显示各厂商密钥是否已配置。
- 备份导出采用口令加密（PBKDF2 + AES-256-GCM），忘记密码无法解密；导入时需输入同一密码。

## WebSocket

- 路径：`/ws/terminal?serverId=1`
- 客户端 -> 服务端：
  - `{"type":"input","data":"ls\n"}`
  - `{"type":"resize","cols":120,"rows":30}`
- 服务端 -> 客户端：
  - `{"type":"output","data":"..."}`
  - `{"type":"error","message":"..."}`
  - `{"type":"closed","reason":"..."}`

## 访问密钥（Agent 接入）

给外部 Agent（MCP 客户端 / 技能插件 / 自写脚本）使用的 API 密钥。密钥管理接口走浏览器 Cookie 会话，`/api/agent/*` 走密钥鉴权。

密钥格式：`mk_` + 48 位随机十六进制（共 51 字符）。服务端只保存 SHA-256 摘要，**明文仅在创建时返回一次**，之后无法再次读取。

### 密钥管理（需登录）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/keys/scopes | 可用权限清单（含名称、说明、是否高危） |
| GET | /api/keys | 密钥列表（不含明文，仅前缀） |
| POST | /api/keys | 创建密钥 `{name, scopes, expires_in_days}` |
| POST | /api/keys/{id}/revoke | 撤销密钥（保留记录，立即失效） |
| DELETE | /api/keys/{id} | 删除密钥记录 |

创建响应（`plaintext` 只出现这一次）：

```json
{
  "key": { "id": 1, "name": "运维 Agent", "prefix": "mk_07867484", "scopes": ["servers:read"], "created_at": "...", "last_used_at": "...", "expires_at": "...", "revoked": false },
  "plaintext": "mk_07867484fd51c2e2151d303b99e87fcad75d18f63ece871c"
}
```

### 权限（scopes）

| 权限 | 说明 | 是否高危 |
| --- | --- | --- |
| servers:read | 查看服务器 | 否 |
| servers:write | 管理服务器（增删改） | 否 |
| servers:exec | 远程执行命令、读写文件 | 是 |
| commands:read | 查看常用命令 | 否 |
| commands:write | 管理常用命令（增删改） | 否 |

`*` 表示全部权限。

### 鉴权方式

两种请求头任选其一：

```
Authorization: Bearer mk_xxxxxxxx...
X-API-Key: mk_xxxxxxxx...
```

失败响应：`401`（缺少 / 无效 / 已撤销 / 已过期）、`403`（缺少权限，形如 `{"error":"密钥缺少权限：servers:exec"}`）。

### Agent 接口

| 方法 | 路径 | 所需权限 | 说明 |
| --- | --- | --- | --- |
| GET | /api/agent/servers | servers:read | 服务器列表（不含凭据） |
| POST | /api/agent/servers | servers:write | 新增服务器 |
| GET | /api/agent/servers/{id} | servers:read | 服务器详情 + 实时状态 |
| PUT | /api/agent/servers/{id} | servers:write | 更新服务器（凭据留空表示不改） |
| DELETE | /api/agent/servers/{id} | servers:write | 删除服务器 |
| POST | /api/agent/servers/{id}/exec | servers:exec | 执行命令 `{command, timeout_sec}` |
| GET | /api/agent/servers/{id}/files | servers:exec | 列目录 `?path=/etc` |
| GET | /api/agent/servers/{id}/files/read | servers:exec | 读文件 `?path=/etc/hosts`（上限 1 MiB） |
| POST | /api/agent/servers/{id}/files/write | servers:exec | 写文件 `{path, content}` |
| GET | /api/agent/commands | commands:read | 常用命令列表 |
| POST | /api/agent/commands | commands:write | 新增常用命令 |
| PUT | /api/agent/commands/{id} | commands:write | 更新常用命令 |
| DELETE | /api/agent/commands/{id} | commands:write | 删除常用命令 |
| POST | /api/agent/commands/{id}/use | commands:read | 使用计数 +1 |

执行命令响应（命令本身失败也返回 200，用 `ok` 区分）：

```json
{ "ok": true, "output": "Linux vps 6.1.0 ...", "exit_error": "" }
```

`timeout_sec` 默认 60，取值范围 1–600。

**刻意不对外开放**：账户设置（改密码 / 改用户名）与备份导出还原属于高危操作，仅限浏览器 Cookie 会话，密钥无法访问。

### MCP 服务器

仓库 `mcp/` 目录提供一个即用的 MCP 服务器，把上述接口封装成 14 个工具：

```bash
cd mcp && npm install
```

客户端配置（Claude Desktop / Cursor 等）：

```json
{
  "mcpServers": {
    "mook": {
      "command": "node",
      "args": ["/绝对路径/mook/mcp/src/index.js"],
      "env": { "MOOK_URL": "http://192.168.31.10:5866", "MOOK_API_KEY": "mk_..." }
    }
  }
}
```
