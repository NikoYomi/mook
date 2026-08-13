import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CommandItem {
  id: string
  name: string
  command: string
  category?: string
  createdAt: number
}

interface CommandsState {
  commands: CommandItem[]
  add: (c: { name: string; command: string; category?: string }) => void
  update: (id: string, c: { name: string; command: string; category?: string }) => void
  remove: (id: string) => void
  replace: (commands: CommandItem[]) => void
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const DEFAULTS: CommandItem[] = [
  { id: 'seed-1', name: '查看磁盘占用', command: 'df -h', category: '系统', createdAt: 0 },
  { id: 'seed-2', name: '查看内存', command: 'free -h', category: '系统', createdAt: 0 },
  { id: 'seed-3', name: '实时进程', command: 'top', category: '系统', createdAt: 0 },
  { id: 'seed-4', name: '查看目录', command: 'ls -lah', category: '文件', createdAt: 0 },
  { id: 'seed-5', name: '跟踪系统日志', command: 'tail -f /var/log/syslog', category: '日志', createdAt: 0 },
  { id: 'seed-6', name: '查看端口监听', command: 'ss -tlnp', category: '网络', createdAt: 0 },
]

export const useCommands = create<CommandsState>()(
  persist(
    (set) => ({
      commands: DEFAULTS,
      add: (c) =>
        set((s) => ({
          commands: [{ ...c, id: uid(), createdAt: Date.now() }, ...s.commands],
        })),
      update: (id, c) =>
        set((s) => ({
          commands: s.commands.map((x) => (x.id === id ? { ...x, ...c } : x)),
        })),
      remove: (id) =>
        set((s) => ({ commands: s.commands.filter((x) => x.id !== id) })),
      replace: (commands) => set({ commands }),
    }),
    { name: 'mook.commands', version: 1 },
  ),
)