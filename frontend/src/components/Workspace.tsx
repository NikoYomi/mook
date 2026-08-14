import type { ComponentType } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useAi } from '../store/ai'
import { useCommands } from '../store/commands'
import { useI18n } from '../utils/i18n'
import Terminal from '../pages/Terminal'
import Servers from '../pages/Servers'
import SettingsModal, { type SettingsTab } from '../pages/Settings'
import { friendlyModelName } from '../utils/command'
import {
  ChevronDownIcon,
  LogOutIcon,
  ServerIcon,
  SettingsIcon,
  TerminalIcon,
  UserIcon,
  ZapIcon,
} from './icons'
import type { IconProps } from './icons'

type View = 'terminal' | 'servers'

function viewOf(pathname: string): View {
  if (pathname.startsWith('/terminal')) return 'terminal'
  return 'servers'
}

interface NavItem {
  key: View
  label: string
  to: string
  icon: ComponentType<IconProps>
}

// 导航顺序：服务器、终端（设置移到右上角）
function navItems(t: (k: string) => string): NavItem[] {
  return [
    { key: 'servers', label: t('servers'), to: '/', icon: ServerIcon },
    { key: 'terminal', label: t('terminal'), to: '/terminal', icon: TerminalIcon },
  ]
}

function AiBadge({ onOpen }: { onOpen: () => void }) {
  const settings = useAi((s) => s.settings)
  const validated = Boolean(settings?.validated)

  return (
    <button
      onClick={onOpen}
      title={validated ? '点击配置 / 修改 AI 密钥' : '尚未启用，点击去设置 AI 密钥'}
      className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors duration-150 ${
        validated
          ? 'border-accent/25 bg-accent-dim text-accent-bright hover:bg-accent/20'
          : 'border-line bg-panel-2 text-faint hover:border-line-strong hover:text-soft'
      }`}
    >
      <ZapIcon size={12} />
      {validated ? `AI终端：${friendlyModelName(settings?.model ?? '')}` : 'AI终端：未启用'}
    </button>
  )
}

export default function Workspace() {
  const t = useI18n()
  const { pathname } = useLocation()
  const terminalMatch = pathname.match(/^\/terminal\/(\d+)/)
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const refreshAi = useAi((s) => s.refresh)
  const initCommands = useCommands((s) => s.init)
  const view = viewOf(pathname)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')

  useEffect(() => {
    refreshAi()
  }, [refreshAi])

  useEffect(() => {
    initCommands()
  }, [initCommands])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  async function handleLogout() {
    setMenuOpen(false)
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-panel/90 px-3">
        <div className="flex min-w-0 items-center gap-1">
          <button
            onClick={() => navigate('/')}
            className="mr-2 flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-raise"
            title="Mook 首页"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent">
              <TerminalIcon size={15} />
            </span>
            <span className="text-sm font-bold tracking-wide text-ink">Mook</span>
          </button>
          <nav className="flex items-center gap-0.5">
            {navItems(t).map((item) => {
              const active = view === item.key
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  onClick={() => navigate(item.to)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors duration-150 ${
                    active
                      ? 'bg-raise text-ink'
                      : 'text-soft hover:bg-panel-2 hover:text-ink'
                  }`}
                >
                  <Icon size={15} />
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <AiBadge
            onOpen={() => {
              setSettingsTab('ai')
              setSettingsOpen(true)
            }}
          />

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors duration-150 ${
                menuOpen ? 'bg-raise text-ink' : 'text-soft hover:bg-panel-2 hover:text-ink'
              }`}
              title="账户"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-dim text-accent">
                <UserIcon size={13} />
              </span>
              <span className="hidden max-w-[8rem] truncate sm:inline">{user}</span>
              <ChevronDownIcon
                size={13}
                className={`transition-transform duration-150 ${menuOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+6px)] z-50 w-full overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/50"
              >
                <div className="border-b border-line px-3 py-2.5">
                  <div className="truncate text-[13px] font-medium text-ink">{user}</div>
                  <div className="mt-0.5 text-[11px] text-faint">{t('admin')}</div>
                </div>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setSettingsTab('general')
                    setSettingsOpen(true)
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 border-b border-line px-3 py-2.5 text-left text-[13px] text-soft transition-colors duration-150 hover:bg-panel-2 hover:text-ink"
                >
                  <SettingsIcon size={15} />
                  {t('settings')}
                </button>
                <button
                  role="menuitem"
                  onClick={handleLogout}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-[13px] text-soft transition-colors duration-150 hover:bg-danger-dim hover:text-danger"
                >
                  <LogOutIcon size={15} />
                  {t('logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {/* 终端页面常驻挂载：切到服务器时保留会话，返回无需重连 */}
        <div className={view === 'terminal' ? 'h-full' : 'hidden'}>
          <Terminal serverId={terminalMatch ? terminalMatch[1] : undefined} />
        </div>
        {view === 'servers' && <Servers />}
      </main>

      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}