export interface Server {
  id: number
  name: string
  host: string
  port: number
  username: string
  auth_type: 'password' | 'key'
  tags: string[]
  created_at: string
  updated_at: string
  last_connected_at: string
  sort_order: number
}

export interface ServerInput {
  name: string
  host: string
  port: number
  username: string
  auth_type: 'password' | 'key'
  password?: string
  private_key?: string
  tags: string[]
}

export interface AiSettings {
  base_url: string
  model: string
  has_api_key: boolean
  validated: boolean
  custom_providers: CustomProviderSetting[]
  provider_keys?: Record<string, boolean>
}

export interface CustomProviderSetting {
  name: string
  base_url: string
  model: string
  has_api_key: boolean
}

export interface SaveAiResult {
  ok: boolean
  validated: boolean
  error?: string
}

export interface FileEntry {
  name: string
  path: string
  is_dir: boolean
  size: number
  mod_time: string
  mode: string
}

export interface FileListResult {
  path: string
  entries: FileEntry[]
}

export interface BackupServerItem {
  name: string
  host: string
  port: number
  username: string
  auth_type: 'password' | 'key'
  password?: string
  private_key?: string
  password_enc?: string
  private_key_enc?: string
  tags?: string[]
}

export interface BackupData {
  version: number
  exported_at?: string
  servers: BackupServerItem[]
  settings: Record<string, string>
  common_commands?: CommonCommandItem[]
}

export interface CommonCommandItem {
  id: string
  name: string
  command: string
  category?: string
  usage_count?: number
  pinned?: boolean
}

export interface ServerStats {
  latency_ms: number
  cores: number
  cpu_percent: number
  load1: number
  load5: number
  load15: number
  mem_total: number
  mem_used: number
  disk_total: number
  disk_used: number
  ts: number
}

async function doRequest<T>(path: string, options: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
  })
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const data = await res.json()
      if (data && data.error) msg = data.error
    } catch {
      /* 忽略解析错误 */
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return doRequest<T>(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
}

function requestRaw<T>(path: string, options: RequestInit = {}): Promise<T> {
  return doRequest<T>(path, options)
}

export const api = {
  setupStatus: () => request<{ setup_required: boolean }>('/api/setup/status'),
  setup: (password: string) => request<{ ok: boolean }>('/api/setup', { method: 'POST', body: JSON.stringify({ password }) }),
  login: (password: string) =>
    request<{ ok: boolean; username: string }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),
  me: () => request<{ username: string }>('/api/me'),

  listServers: () => request<Server[]>('/api/servers'),
  reorderServers: (ids: number[]) =>
    request<{ ok: boolean }>('/api/servers/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
  createServer: (s: ServerInput) => request<Server>('/api/servers', { method: 'POST', body: JSON.stringify(s) }),
  updateServer: (id: number, s: ServerInput) => request<Server>(`/api/servers/${id}`, { method: 'PUT', body: JSON.stringify(s) }),
  deleteServer: (id: number) => request<{ ok: boolean }>(`/api/servers/${id}`, { method: 'DELETE' }),

  getAiSettings: () => request<AiSettings>('/api/settings/ai'),
  saveAiSettings: (s: { base_url: string; model: string; api_key: string; provider_id: string; custom_name: string }) =>
    request<SaveAiResult>('/api/settings/ai', { method: 'POST', body: JSON.stringify(s) }),

  aiCommand: (prompt: string) => request<{ result: string }>('/api/ai/command', { method: 'POST', body: JSON.stringify({ prompt }) }),
  aiAnalyze: (content: string) => request<{ result: string }>('/api/ai/analyze', { method: 'POST', body: JSON.stringify({ content }) }),

  // ---- SFTP 文件管理 ----
  listFiles: (serverId: number, dir: string) =>
    request<FileListResult>(`/api/servers/${serverId}/files?path=${encodeURIComponent(dir)}`),
  downloadUrl: (serverId: number, filePath: string) =>
    `/api/servers/${serverId}/files/download?path=${encodeURIComponent(filePath)}`,
  uploadFile: (serverId: number, dir: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return requestRaw<{ ok: boolean; path: string }>(
      `/api/servers/${serverId}/files/upload?dir=${encodeURIComponent(dir)}`,
      { method: 'POST', body: fd },
    )
  },
  mkdir: (serverId: number, path: string) =>
    request<{ ok: boolean }>(`/api/servers/${serverId}/files/mkdir`, { method: 'POST', body: JSON.stringify({ path }) }),
  rename: (serverId: number, old_path: string, new_path: string) =>
    request<{ ok: boolean }>(`/api/servers/${serverId}/files/rename`, { method: 'POST', body: JSON.stringify({ old_path, new_path }) }),
  remove: (serverId: number, path: string) =>
    request<{ ok: boolean }>(`/api/servers/${serverId}/files/remove`, { method: 'POST', body: JSON.stringify({ path }) }),

  // ---- 服务器实时状态 ----
  serverStats: (id: number) => request<ServerStats>(`/api/servers/${id}/stats`),

  // ---- 常用命令（持久化于服务端 /data）----
  listCommands: () => request<CommonCommandItem[]>('/api/commands'),
  saveCommands: (commands: CommonCommandItem[]) =>
    request<{ ok: boolean }>('/api/commands', { method: 'PUT', body: JSON.stringify(commands) }),
  useCommand: (id: string) =>
    request<{ ok: boolean }>(`/api/commands/${encodeURIComponent(id)}/use`, { method: 'POST' }),

  // ---- 账户 ----
  changeUsername: (username: string) =>
    request<{ ok: boolean; username: string }>('/api/me/username', { method: 'POST', body: JSON.stringify({ username }) }),
  verifyPassword: (password: string) =>
    request<{ ok: boolean }>('/api/me/verify-password', { method: 'POST', body: JSON.stringify({ password }) }),
  changePassword: (old_password: string, new_password: string) =>
    request<{ ok: boolean }>('/api/me/password', { method: 'POST', body: JSON.stringify({ old_password, new_password }) }),

  // ---- 备份与还原 ----
  getBackup: () => request<BackupData>('/api/backup'),
  exportBackup: (password: string) =>
    request<{ data: string }>('/api/backup/export', { method: 'POST', body: JSON.stringify({ password }) }),
  restoreBackup: (data: BackupData | { password: string; data: string }) =>
    request<{ ok: boolean; servers_restored: number }>('/api/backup/restore', { method: 'POST', body: JSON.stringify(data) }),

  // ---- AI 模型列表 ----
  listModels: (base_url: string, api_key: string) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    return request<{ models: string[] }>(
      `/api/ai/models?base_url=${encodeURIComponent(base_url)}&api_key=${encodeURIComponent(api_key)}`,
      { signal: controller.signal },
    ).finally(() => clearTimeout(timer))
  },
}
