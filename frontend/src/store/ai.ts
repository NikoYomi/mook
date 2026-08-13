import { create } from 'zustand'
import { api, type AiSettings } from '../api/client'

interface AiState {
  settings: AiSettings | null
  loaded: boolean
  refresh: () => Promise<void>
  apply: (s: AiSettings) => void
}

export const useAi = create<AiState>((set) => ({
  settings: null,
  loaded: false,
  async refresh() {
    try {
      const settings = await api.getAiSettings()
      set({ settings, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  apply(settings) {
    set({ settings })
  },
}))