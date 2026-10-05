# Mook MCP Server

把 Mook 封装成 MCP（Model Context Protocol）工具集，让任意支持 MCP 的 Agent 客户端
（Claude Desktop、Cursor、Cline、自研 Agent……）可以直接管理 Mook 上托管的服务器与常用命令。

## 能力

连接后可用的 14 个工具：

| 工具 | 说明 | 所需权限 |
| --- | --- | --- |
| `list_servers` | 列出所有托管服务器 | servers:read |
| `get_server` | 服务器详情 + 实时状态（CPU/内存/磁盘/负载） | servers:read |
| `add_server` | 新增服务器 | servers:write |
| `update_server` | 修改服务器配置 | servers:write |
| `remove_server` | 删除服务器 | servers:write |
| `exec_command` | SSH 执行命令并取回输出 | servers:exec |
| `list_files` | 列出远程目录 | servers:exec |
| `read_file` | 读取远程文件（上限 1 MiB） | servers:exec |
| `write_file` | 写入远程文件 | servers:exec |
| `list_commands` | 列出常用命令 | commands:read |
| `save_command` | 新增常用命令 | commands:write |
| `update_command` | 修改常用命令 | commands:write |
| `delete_command` | 删除常用命令 | commands:write |
| `mark_command_used` | 命令使用计数 +1 | commands:read |

## 安装

```bash
cd mcp
npm install
```

## 在 Mook 里创建密钥

1. 打开 Mook → 右下角账户菜单 → **设置** → **访问密钥**
2. 点「新建密钥」，填名称、勾选权限、选有效期
3. **立刻复制明文密钥**（`mk_` 开头，51 字符）—— 关闭弹窗后无法再次查看

## 客户端配置

### Claude Desktop

编辑 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "mook": {
      "command": "node",
      "args": ["/absolute/path/to/mook/mcp/src/index.js"],
      "env": {
        "MOOK_URL": "http://192.168.31.10:5866",
        "MOOK_API_KEY": "mk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### Cursor / Cline / 其他

同样的 `command` + `args` + `env` 结构，按各自文档放到 MCP 配置里即可。

### 直接调试

```bash
MOOK_URL=http://127.0.0.1:5866 MOOK_API_KEY=mk_... node src/index.js
```

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `MOOK_URL` | 是 | Mook 地址，如 `http://192.168.31.10:5866`；经反向代理带子路径时一并写上，如 `https://example.com/app/mook` |
| `MOOK_API_KEY` | 是 | 访问密钥，`mk_` 开头 |

## 安全说明

- 密钥只在创建时明文显示一次，服务端仅存 SHA-256 摘要
- 建议按最小权限原则授权：只读场景不要勾选 `servers:write` / `servers:exec`
- `servers:exec` 可在目标服务器上以登录用户身份执行任意命令，属高危权限，请谨慎授予
- 吊销密钥：设置 → 访问密钥 → 「撤销」，立即生效（不需要重启 MCP 客户端）
- 本进程不落盘、不缓存任何凭据，stdout 只用于 MCP 协议，日志一律走 stderr

## 故障排查

| 现象 | 原因 |
| --- | --- |
| `缺少配置` 并退出 | 未设置 `MOOK_URL` 或 `MOOK_API_KEY` |
| `无法连接 Mook` | 地址写错、端口不通，或 Mook 未启动 |
| `鉴权失败` | 密钥无效、已撤销或已过期 |
| `权限不足：密钥缺少权限：xxx` | 到 Mook 设置里给该密钥补勾对应权限 |
