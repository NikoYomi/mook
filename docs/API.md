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
| POST | /api/me/password | 修改密码 `{old_password, new_password}` |

## 服务器管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/servers | 服务器列表 |
| POST | /api/servers | 新增服务器 |
| PUT | /api/servers/{id} | 更新服务器 |
| DELETE | /api/servers/{id} | 删除服务器 |

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

## 备份与还原

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/backup | 导出备份（服务器配置含凭据密文 + AI 设置） |
| POST | /api/backup/restore | 还原备份（服务器清空重建 + 设置覆盖） |

备份文件结构（前端还会附带 `common_commands` 常用命令）：

```json
{
  "version": 1,
  "exported_at": "2026-08-13T10:00:00Z",
  "servers": [ { "name": "...", "host": "...", "port": 22, "username": "root", "auth_type": "password", "password_enc": "...", "private_key_enc": "", "tags": ["生产"] } ],
  "settings": { "ai_base_url": "...", "ai_model": "...", "ai_api_key": "...", "ai_validated": "1" }
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
  "validated": true
}
```

## WebSocket

- 路径：`/ws/terminal?serverId=1`
- 客户端 -> 服务端：
  - `{"type":"input","data":"ls\n"}`
  - `{"type":"resize","cols":120,"rows":30}`
- 服务端 -> 客户端：
  - `{"type":"output","data":"..."}`
  - `{"type":"error","message":"..."}`
  - `{"type":"closed","reason":"..."}`