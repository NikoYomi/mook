import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../api/client'

export interface CommandItem {
  id: string
  name: string
  command: string
  category?: string
  createdAt: number
}

interface CommandsState {
  commands: CommandItem[]
  synced: boolean
  init: () => Promise<void>
  add: (c: { name: string; command: string; category?: string }) => void
  update: (id: string, c: { name: string; command: string; category?: string }) => void
  remove: (id: string) => void
  replace: (commands: CommandItem[]) => void
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// 服务端条目 → 本地条目（服务端不保存 createdAt，此处置 0）
function fromServer(c: { id: string; name: string; command: string; category?: string }): CommandItem {
  return { id: c.id, name: c.name, command: c.command, category: c.category, createdAt: 0 }
}

// 变更后推送到服务端（持久化到 /data，容器重建不丢失）
function sync(commands: CommandItem[]) {
  api.saveCommands(commands).catch((err) => {
    console.warn('同步常用命令到服务端失败：', err)
  })
}

const DEFAULTS: CommandItem[] = [
  { id: 'seed-1', name: '容器列表', command: 'docker ps -a', category: 'Docker', createdAt: 0 },
  { id: 'seed-2', name: '容器资源监控', command: 'docker stats', category: 'Docker', createdAt: 0 },
  { id: 'seed-3', name: '镜像列表', command: 'docker images', category: 'Docker', createdAt: 0 },
  { id: 'seed-4', name: '容器日志（最近运行）', command: 'docker logs -f --tail 100 $(docker ps -q | head -1)', category: 'Docker', createdAt: 0 },
  { id: 'seed-5', name: 'Docker 磁盘占用', command: 'docker system df', category: 'Docker', createdAt: 0 },
  { id: 'seed-6', name: 'Compose 服务状态', command: 'docker compose ps', category: 'Compose', createdAt: 0 },
  { id: 'seed-7', name: 'Compose 日志（跟随）', command: 'docker compose logs --tail 100 -f', category: 'Compose', createdAt: 0 },
  { id: 'seed-8', name: 'Compose 启动', command: 'docker compose up -d', category: 'Compose', createdAt: 0 },
  { id: 'seed-9', name: 'Compose 停止', command: 'docker compose down', category: 'Compose', createdAt: 0 },
  { id: 'seed-10', name: 'Compose 重启', command: 'docker compose restart', category: 'Compose', createdAt: 0 },
]

// 旧版默认命令（v1），用于版本迁移时识别「仍是默认值、未自定义」的用户
const OLD_SEED_IDS = ['seed-1', 'seed-2', 'seed-3', 'seed-4', 'seed-5', 'seed-6']

export const useCommands = create<CommandsState>()(
  persist(
    (set, get) => ({
      commands: DEFAULTS,
      synced: false,
      async init() {
        try {
          const list = await api.listCommands()
          if (list && list.length > 0) {
            set({ commands: list.map(fromServer), synced: true })
            return
          }
          // 服务端尚无记录：把当前（默认或本地自定义）命令首次写入 /data
          const current = get().commands
          await api.saveCommands(current)
          set({ synced: true })
        } catch {
          set({ synced: false })
        }
      },
      add: (c) => {
        const next = [{ ...c, id: uid(), createdAt: Date.now() }, ...get().commands]
        set({ commands: next })
        if (get().synced) sync(next)
      },
      update: (id, c) => {
        const next = get().commands.map((x) => (x.id === id ? { ...x, ...c } : x))
        set({ commands: next })
        if (get().synced) sync(next)
      },
      remove: (id) => {
        const next = get().commands.filter((x) => x.id !== id)
        set({ commands: next })
        if (get().synced) sync(next)
      },
      replace: (commands) => {
        set({ commands })
        if (get().synced) sync(commands)
      },
    }),
    {
      name: 'mook.commands',
      version: 2,
      migrate(persisted, version) {
        const raw = persisted as { commands?: CommandItem[] } | undefined
        const list = raw?.commands
        // 只有 v1 且命令恰好是旧版 6 条默认命令（seed-1..6）时才替换为新默认；用户自定义过则保留
        if (version < 2 && Array.isArray(list)) {
          const ids = list.map((c) => c.id)
          const isOldDefaults =
            ids.length === OLD_SEED_IDS.length &&
            OLD_SEED_IDS.every((id) => ids.includes(id))
          if (isOldDefaults) {
            return { ...raw, commands: DEFAULTS }
          }
        }
        return raw
      },
    },
  ),
)
