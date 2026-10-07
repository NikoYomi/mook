#!/usr/bin/env node
/**
 * Mook MCP Server
 *
 * 把 MCP 工具调用翻译成对 Mook 后端 /api/agent/* 的 HTTP 请求，
 * 使用标准输入输出（stdio）与 Agent 客户端通信。
 *
 * 环境变量：
 *   MOOK_URL      Mook 地址，如 http://192.168.31.10:5866（可含子路径）
 *   MOOK_API_KEY  在 Mook「设置 → 访问密钥」中创建的密钥（mk_ 开头）
 *
 * 该进程不保存任何状态，也不缓存凭据；每次调用即一次 HTTP 请求。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const RAW_URL = (process.env.MOOK_URL || '').trim()
const API_KEY = (process.env.MOOK_API_KEY || '').trim()

if (!RAW_URL || !API_KEY) {
  // 用 stderr 报错：stdout 是 MCP 协议通道，写坏它会直接破坏握手
  console.error(
    '[mook-mcp] 缺少配置。请设置环境变量 MOOK_URL 与 MOOK_API_KEY。\n' +
      '  MOOK_URL     例如 http://192.168.31.10:5866\n' +
      '  MOOK_API_KEY 在 Mook「设置 → 访问密钥」中创建',
  )
  process.exit(1)
}

// 去掉结尾斜杠，保证与路径拼接时不出现双斜杠
const BASE_URL = RAW_URL.replace(/\/+$/, '')

const REQUEST_TIMEOUT_MS = 120_000

/**
 * 调用 Mook 的 agent 接口。
 * 失败时抛出带有可读信息的 Error —— MCP 会把 message 原样回给模型。
 */
async function call(path, { method = 'GET', body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）：${method} ${path}`)
    }
    throw new Error(`无法连接 Mook（${BASE_URL}）：${err.message}`)
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      /* 非 JSON 响应，保留原文 */
    }
  }

  if (!res.ok) {
    const msg = (data && data.error) || text || `HTTP ${res.status}`
    if (res.status === 401) {
      throw new Error(`鉴权失败：${msg}。请检查 MOOK_API_KEY 是否有效或已被撤销。`)
    }
    if (res.status === 403) {
      throw new Error(`权限不足：${msg}。请在 Mook 中为该密钥补授对应权限。`)
    }
    throw new Error(`请求失败（HTTP ${res.status}）：${msg}`)
  }

  return data
}

/** 把任意结果序列化成 MCP 工具返回值 */
function ok(data) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  }
}

/** 统一的错误包装：把抛出的异常转成 MCP 的 isError 结果 */
function fail(err) {
  return {
    isError: true,
    content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
  }
}

/** 包装处理器，免去每个工具都写 try/catch */
function handler(fn) {
  return async (args) => {
    try {
      return ok(await fn(args))
    } catch (err) {
      return fail(err)
    }
  }
}

const server = new McpServer({
  name: 'mook',
  version: '0.4.6',
})

// ---------------------------------------------------------------------------
// 服务器
// ---------------------------------------------------------------------------

server.tool(
  'list_servers',
  '列出 Mook 中托管的所有服务器。返回每台服务器的 id、名称、地址、端口、用户名与标签，不包含任何登录凭据。',
  {},
  handler(async () => call('/api/agent/servers')),
)

server.tool(
  'get_server',
  '获取单台服务器的详情，并附带该机器的实时状态（CPU、内存、磁盘、负载、延迟）。执行前先用 list_servers 取得服务器 id。',
  {
    server_id: z.number().int().positive().describe('服务器 id，来自 list_servers'),
  },
  handler(async ({ server_id }) => call(`/api/agent/servers/${server_id}`)),
)

server.tool(
  'add_server',
  '在 Mook 中新增一台服务器。需要具备 servers:write 权限。密码或私钥会被加密存储，接口不会回显。',
  {
    name: z.string().min(1).describe('服务器显示名称'),
    host: z.string().min(1).describe('主机地址（IP 或域名）'),
    port: z.number().int().min(1).max(65535).optional().describe('SSH 端口，默认 22'),
    username: z.string().optional().describe('登录用户名，默认 root'),
    auth_type: z.enum(['password', 'key']).optional().describe('认证方式，默认 password'),
    password: z.string().optional().describe('登录密码（auth_type=password 时必填）'),
    private_key: z.string().optional().describe('私钥内容（auth_type=key 时必填）'),
    tags: z.array(z.string()).optional().describe('标签，便于分组'),
  },
  handler(async (args) => {
    const payload = { ...args }
    if (payload.port === undefined) payload.port = 22
    if (!payload.auth_type) payload.auth_type = 'password'
    return call('/api/agent/servers', { method: 'POST', body: payload })
  }),
)

server.tool(
  'update_server',
  '更新一台已有服务器的配置。只需传要修改的字段；凭据字段留空则保持原值不变。需要 servers:write 权限。',
  {
    server_id: z.number().int().positive().describe('要更新的服务器 id'),
    name: z.string().optional().describe('新的显示名称'),
    host: z.string().optional().describe('新的主机地址'),
    port: z.number().int().min(1).max(65535).optional().describe('新的 SSH 端口'),
    username: z.string().optional().describe('新的登录用户名'),
    auth_type: z.enum(['password', 'key']).optional().describe('新的认证方式'),
    password: z.string().optional().describe('新的登录密码（留空表示不改）'),
    private_key: z.string().optional().describe('新的私钥内容（留空表示不改）'),
    tags: z.array(z.string()).optional().describe('新的标签列表（整体替换）'),
  },
  handler(async ({ server_id, ...rest }) => {
    // 更新接口要求完整字段：先取当前值，再用传入字段覆盖
    const current = await call(`/api/agent/servers/${server_id}`)
    const s = current?.server ?? {}
    const body = {
      name: rest.name ?? s.name ?? '',
      host: rest.host ?? s.host ?? '',
      port: rest.port ?? s.port ?? 22,
      username: rest.username ?? s.username ?? 'root',
      auth_type: rest.auth_type ?? s.auth_type ?? 'password',
      tags: rest.tags ?? s.tags ?? [],
    }
    if (rest.password) body.password = rest.password
    if (rest.private_key) body.private_key = rest.private_key
    return call(`/api/agent/servers/${server_id}`, { method: 'PUT', body })
  }),
)

server.tool(
  'remove_server',
  '从 Mook 中删除一台服务器（仅移除托管记录，不会影响服务器本身）。这是不可撤销操作，需要 servers:write 权限。',
  {
    server_id: z.number().int().positive().describe('要删除的服务器 id'),
  },
  handler(async ({ server_id }) => call(`/api/agent/servers/${server_id}`, { method: 'DELETE' })),
)

// ---------------------------------------------------------------------------
// 远程执行
// ---------------------------------------------------------------------------

server.tool(
  'exec_command',
  '在一台服务器上通过 SSH 执行 shell 命令并返回输出。需要 servers:exec 权限。命令以该服务器配置的登录用户身份运行；耗时命令请调大 timeout_sec。',
  {
    server_id: z.number().int().positive().describe('目标服务器 id'),
    command: z.string().min(1).describe('要执行的 shell 命令，例如 "df -h" 或 "systemctl status nginx"'),
    timeout_sec: z
      .number()
      .int()
      .min(1)
      .max(600)
      .optional()
      .describe('超时秒数，默认 60，最大 600'),
  },
  handler(async ({ server_id, command, timeout_sec }) =>
    call(`/api/agent/servers/${server_id}/exec`, {
      method: 'POST',
      body: { command, timeout_sec: timeout_sec ?? 60 },
    }),
  ),
)

// ---------------------------------------------------------------------------
// 文件
// ---------------------------------------------------------------------------

server.tool(
  'list_files',
  '列出服务器上某个目录的内容。需要 servers:exec 权限。',
  {
    server_id: z.number().int().positive().describe('目标服务器 id'),
    path: z.string().optional().describe('目录绝对路径，默认 /'),
  },
  handler(async ({ server_id, path }) =>
    call(`/api/agent/servers/${server_id}/files?path=${encodeURIComponent(path || '/')}`),
  ),
)

server.tool(
  'read_file',
  '读取服务器上某个文本文件的内容。单次最多返回 1 MiB，超出部分会被截断（返回的 truncated 字段为 true）。需要 servers:exec 权限。',
  {
    server_id: z.number().int().positive().describe('目标服务器 id'),
    path: z.string().min(1).describe('文件绝对路径，例如 /etc/nginx/nginx.conf'),
  },
  handler(async ({ server_id, path }) =>
    call(`/api/agent/servers/${server_id}/files/read?path=${encodeURIComponent(path)}`),
  ),
)

server.tool(
  'write_file',
  '把内容写入服务器上的指定文件（已存在则整体覆盖，不存在则创建）。需要 servers:exec 权限。',
  {
    server_id: z.number().int().positive().describe('目标服务器 id'),
    path: z.string().min(1).describe('文件绝对路径'),
    content: z.string().describe('要写入的完整文件内容'),
  },
  handler(async ({ server_id, path, content }) =>
    call(`/api/agent/servers/${server_id}/files/write`, {
      method: 'POST',
      body: { path, content },
    }),
  ),
)

// ---------------------------------------------------------------------------
// 常用命令
// ---------------------------------------------------------------------------

server.tool(
  'list_commands',
  '列出 Mook 中保存的所有常用命令（含 id、名称、命令内容、分类、使用次数、是否置顶）。',
  {},
  handler(async () => call('/api/agent/commands')),
)

server.tool(
  'save_command',
  '新增一条常用命令，保存到 Mook 供用户在网页终端里一键使用。需要 commands:write 权限。',
  {
    name: z.string().min(1).describe('命令的显示名称，如「查看磁盘占用」'),
    command: z.string().min(1).describe('实际执行的命令内容'),
    category: z.string().optional().describe('分类，便于分组'),
    pinned: z.boolean().optional().describe('是否置顶'),
  },
  handler(async (args) =>
    call('/api/agent/commands', {
      method: 'POST',
      body: {
        name: args.name,
        command: args.command,
        category: args.category ?? '',
        pinned: args.pinned ?? false,
      },
    }),
  ),
)

server.tool(
  'update_command',
  '修改一条已保存的常用命令。只传要改的字段即可（name / command / category 传空字符串表示保持原值）。需要 commands:write 权限。',
  {
    command_id: z.string().min(1).describe('命令 id，来自 list_commands'),
    name: z.string().optional().describe('新的名称'),
    command: z.string().optional().describe('新的命令内容'),
    category: z.string().optional().describe('新的分类'),
    pinned: z.boolean().optional().describe('是否置顶'),
  },
  handler(async ({ command_id, name, command, category, pinned }) =>
    call(`/api/agent/commands/${encodeURIComponent(command_id)}`, {
      method: 'PUT',
      body: {
        name: name ?? '',
        command: command ?? '',
        category: category ?? '',
        pinned: pinned ?? false,
      },
    }),
  ),
)

server.tool(
  'delete_command',
  '删除一条已保存的常用命令。此操作不可撤销，需要 commands:write 权限。',
  {
    command_id: z.string().min(1).describe('要删除的命令 id'),
  },
  handler(async ({ command_id }) =>
    call(`/api/agent/commands/${encodeURIComponent(command_id)}`, { method: 'DELETE' }),
  ),
)

server.tool(
  'mark_command_used',
  '把某条常用命令的使用次数 +1（影响网页端的排序）。一般无需手动调用。',
  {
    command_id: z.string().min(1).describe('命令 id'),
  },
  handler(async ({ command_id }) =>
    call(`/api/agent/commands/${encodeURIComponent(command_id)}/use`, { method: 'POST' }),
  ),
)

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // 提示信息一律走 stderr，stdout 留给 MCP 协议
  console.error(`[mook-mcp] 已连接：${BASE_URL}`)
}

main().catch((err) => {
  console.error('[mook-mcp] 启动失败：', err)
  process.exit(1)
})
