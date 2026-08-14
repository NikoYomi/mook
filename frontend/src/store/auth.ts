import { create } from 'zustand'
import { api } from '../api/client'

interface AuthState {
  user: string | null
  loading: boolean
  setupRequired: boolean
  init: () => Promise<void>
  login: (password: string) => Promise<void>
  setup: (password: string) => Promise<void>
  logout: () => Promise<void>
  setUsername: (username: string) => void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  setupRequired: false,
  async init() {
    try {
      const s = await api.setupStatus()
      set({ setupRequired: s.setup_required })
      if (!s.setup_required) {
        const me = await api.me()
        set({ user: me.username })
      }
    } catch {
      set({ user: null })
    } finally {
      set({ loading: false })
    }
  },
  async login(password) {
    const r = await api.login(password)
    set({ user: r.username, setupRequired: false })
  },
  async setup(password) {
    await api.setup(password)
    set({ setupRequired: false })
    const r = await api.login(password)
    set({ user: r.username })
  },
  async logout() {
    await api.logout()
    set({ user: null })
  },
  setUsername(username) {
    set({ user: username })
  },
}))