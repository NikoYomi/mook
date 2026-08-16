import { create } from 'zustand'

// AI 助手面板的按标签页状态。每个终端标签拥有独立的 AI 对话
// （input/output/error/busy），切换标签时右侧栏 AI 面板跟随显示
// 当前标签自己的对话；关闭标签或该连接断开时删除该标签的对话。
// 状态提升到 store 的原因：切换右侧栏（常用命令/AI）、收起右侧栏、
// 切换页面时组件会卸载，若状态留在组件内会随卸载丢失。

interface PanelState {
  input: string
  output: string
  error: string
  busy: boolean
}

const emptyPanel = (): PanelState => ({ input: '', output: '', error: '', busy: false })

// 无激活标签（tabs 为空）时的临时区 key
export const KEY_PENDING = '__pending__'

export const panelKey = (key: number | null): string => (key == null ? KEY_PENDING : String(key))

interface AiPanelState {
  byKey: Record<string, PanelState>
  // 写入某个标签（或临时区）的 AI 面板状态
  setState: (key: number | null, patch: Partial<PanelState>) => void
  // 删除某个标签的对话（关闭标签 / 连接断开时）
  remove: (key: number) => void
  // 清空全部对话
  removeAll: () => void
}

export const useAiPanel = create<AiPanelState>((set) => ({
  byKey: {},
  setState: (key, patch) =>
    set((s) => {
      const k = panelKey(key)
      const cur = s.byKey[k] ?? emptyPanel()
      return { byKey: { ...s.byKey, [k]: { ...cur, ...patch } } }
    }),
  remove: (key) =>
    set((s) => {
      const k = String(key)
      if (!(k in s.byKey)) return s
      const next = { ...s.byKey }
      delete next[k]
      return { byKey: next }
    }),
  removeAll: () => set({ byKey: {} }),
}))