import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TermBgId } from '../terminal/backgrounds'

export type ThemeMode = 'dark' | 'light' | 'system'

interface SettingsState {
  theme: ThemeMode
  english: boolean
  termBg: TermBgId
  termBgImage: string
  setTheme: (theme: ThemeMode) => void
  setEnglish: (english: boolean) => void
  setTermBg: (bg: TermBgId) => void
  setTermBgImage: (image: string) => void
  resetTermBg: () => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      english: false,
      termBg: 'classic',
      termBgImage: '',
      setTheme: (theme) => set({ theme }),
      setEnglish: (english) => set({ english }),
      setTermBg: (bg) => set({ termBg: bg }),
      setTermBgImage: (image) =>
        set({ termBgImage: image, termBg: image ? 'image' : 'classic' }),
      resetTermBg: () => set({ termBg: 'classic', termBgImage: '' }),
    }),
    { name: 'mook.settings', version: 1 },
  ),
)

export function resolveTheme(theme: ThemeMode): 'dark' | 'light' {
  if (theme === 'system') {
    return typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  }
  return theme
}

export function applyTheme(theme: ThemeMode) {
  const resolved = resolveTheme(theme)
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}
