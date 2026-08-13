import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import AiPanel from '../components/AiPanel'
import CommonCommands from '../components/CommonCommands'
import ServerInfo from '../components/ServerInfo'
import FileManager from '../components/FileManager'
import TerminalTab from '../terminal/TerminalTab'
import { useServers } from '../store/servers'
import {
  AlertIcon,
  CheckCircleIcon,
  CommandIcon,
  FolderOpenIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  ServerIcon,
  SparklesIcon,
  TerminalIcon,
  XIcon,
} from '../components/icons'

interface TabInfo {
  key: number
  serverId: number
  name: string
}

const LS_TABS = 'mook.terminal.tabs'
const LS_ACTIVE = 'mook.terminal.active'

function loadTabs(): TabInfo[] {
  try {
    const raw = localStorage.getItem(LS_TABS)
    if (!raw) return []
    const arr = JSON.parse(raw) as TabInfo[]
    if (!Array.isArray(arr)) return []
    return arr.filter((t) => t && typeof t.serverId === 'number' && typeof t.name === 'string')
  } catch {
    return []
  }
}

export default function Terminal({ serverId }: { serverId?: string }) {
  const navigate = useNavigate()
  const servers = useServers((s) => s.servers)
  const load = useServers((s) => s.load)

  const [tabs, setTabs] = useState<TabInfo[]>(loadTabs)
  const [active, setActive] = useState<number>(() => {
    const t = loadTabs()
    try {
      const a = Number(localStorage.getItem(LS_ACTIVE))
      return a >= 0 && a < t.length ? a : 0
    } catch {
      return 0
    }
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  // 左侧栏：默认打开，显示服务器信息 / 文件管理
  const [leftOpen, setLeftOpen] = useState(true)
  const [leftTab, setLeftTab] = useState<'info' | 'files'>('info')
  // 右侧栏：默认打开并显示「常用命令」
  const [sideOpen, setSideOpen] = useState(true)
  const [sideTab, setSideTab] = useState<'commands' | 'ai'>('commands')
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  const keyRef = useRef(0)
  const execRef = useRef<Map<number, (cmd: string) => void>>(new Map())
  const toastTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    load()
  }, [load])

  // 持久化标签页，刷新后自动恢复
  useEffect(() => {
    try {
      localStorage.setItem(LS_TABS, JSON.stringify(tabs))
    } catch {
      /* ignore */
    }
  }, [tabs])
  useEffect(() => {
    try {
      localStorage.setItem(LS_ACTIVE, String(active))
    } catch {
      /* ignore */
    }
  }, [active])

  // 根据 URL 中的 serverId 打开/激活标签（首次进入与跨服务器跳转）
  useEffect(() => {
    if (serverId && servers.length > 0) {
      const s = servers.find((x) => x.id === Number(serverId))
      if (s) openTab(s.id, s.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, servers])

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ type, msg })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  const openTab = (sid: number, name: string) => {
    const idx = tabs.findIndex((t) => t.serverId === sid)
    if (idx >= 0) {
      setActive(idx)
      return
    }
    keyRef.current += 1
    setTabs((prev) => [...prev, { key: keyRef.current, serverId: sid, name }])
    setActive(tabs.length)
  }

  const closeTab = (key: number) => {
    const idx = tabs.findIndex((t) => t.key === key)
    if (idx < 0) return
    execRef.current.delete(key)
    const next = tabs.filter((t) => t.key !== key)
    if (next.length === 0) {
      setTabs([])
      setActive(0)
      navigate('/')
      return
    }
    let newActive = active
    if (active >= next.length) newActive = next.length - 1
    else if (idx < active) newActive = active - 1
    setTabs(next)
    setActive(newActive)
  }

  const registerExec = useCallback((key: number, fn: (cmd: string) => void) => {
    execRef.current.set(key, fn)
  }, [])

  const unregisterExec = useCallback((key: number) => {
    execRef.current.delete(key)
  }, [])

  const runCommand = useCallback(
    (cmd: string) => {
      const tab = tabs[active]
      if (!tab) {
        showToast('请先打开一个终端会话', 'err')
        return
      }
      const fn = execRef.current.get(tab.key)
      if (!fn) {
        showToast('终端尚未就绪，请稍候', 'err')
        return
      }
      fn(cmd)
      showToast(`已发送：${cmd.trim().split('\n')[0]}`)
    },
    [tabs, active, showToast],
  )

  const activeTab = tabs[active]
  const activeServerId = activeTab ? activeTab.serverId : null

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* 标签栏 */}
      <div className="flex h-10 shrink-0 items-stretch border-b border-line bg-panel/90">
        <div className="flex shrink-0 items-center border-r border-line px-1.5">
          <button
            onClick={() => setLeftOpen((v) => !v)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-150 ${
              leftOpen ? 'bg-raise text-accent' : 'text-soft hover:bg-panel-2 hover:text-ink'
            }`}
            title={leftOpen ? '收起左侧栏（服务器信息 / 文件）' : '展开左侧栏（服务器信息 / 文件）'}
          >
            <PanelLeftIcon size={15} />
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((t, i) => (
            <div
              key={t.key}
              onClick={() => setActive(i)}
              role="tab"
              aria-selected={i === active}
              className={`group flex shrink-0 cursor-pointer items-center gap-2 border-r border-line px-3.5 text-[13px] transition-colors duration-150 ${
                i === active
                  ? 'border-t-2 border-t-accent bg-canvas text-ink'
                  : 'text-soft hover:bg-panel-2 hover:text-ink'
              }`}
            >
              <TerminalIcon size={13} className={i === active ? 'text-accent' : 'text-faint'} />
              <span className="max-w-[10rem] truncate">{t.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.key)
                }}
                className="rounded p-0.5 text-faint transition-colors duration-150 hover:bg-raise hover:text-ink"
                title="关闭标签"
                aria-label={`关闭 ${t.name}`}
              >
                <XIcon size={13} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setPickerOpen(true)}
            className="flex shrink-0 cursor-pointer items-center gap-1 px-3.5 text-[13px] text-soft transition-colors duration-150 hover:bg-panel-2 hover:text-ink"
            title="打开新的终端"
          >
            <PlusIcon size={14} />
          </button>
          {tabs.length === 0 && (
            <span className="flex items-center px-3 text-xs text-faint">未打开任何终端</span>
          )}
        </div>

        <div className="flex shrink-0 items-center border-l border-line px-1.5">
          <button
            onClick={() => setSideOpen((v) => !v)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-150 ${
              sideOpen ? 'bg-raise text-accent' : 'text-soft hover:bg-panel-2 hover:text-ink'
            }`}
            title={sideOpen ? '收起右侧栏（常用命令 / AI）' : '展开右侧栏（常用命令 / AI）'}
          >
            <PanelRightIcon size={15} />
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex min-h-0 flex-1">
        {/* 左侧栏：服务器信息 + 文件管理 */}
        {leftOpen && (
          <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
            <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-line p-2">
              <button
                onClick={() => setLeftTab('info')}
                className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors duration-150 ${
                  leftTab === 'info'
                    ? 'bg-accent-dim text-accent-bright'
                    : 'text-soft hover:bg-panel-2 hover:text-ink'
                }`}
              >
                <ServerIcon size={13} />
                服务器信息
              </button>
              <button
                onClick={() => setLeftTab('files')}
                className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors duration-150 ${
                  leftTab === 'files'
                    ? 'bg-accent-dim text-accent-bright'
                    : 'text-soft hover:bg-panel-2 hover:text-ink'
                }`}
              >
                <FolderOpenIcon size={13} />
                文件管理
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {leftTab === 'info' ? (
                <ServerInfo serverId={activeServerId} />
              ) : (
                <FileManager serverId={activeServerId} />
              )}
            </div>
          </aside>
        )}

        <div className="min-w-0 flex-1">
          {tabs.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line-strong bg-panel/40 px-10 py-12 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent-dim text-accent">
                  <TerminalIcon size={26} />
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">尚未打开任何终端</p>
                  <p className="mt-1 text-xs text-soft">
                    选择一个服务器开始 SSH 会话，或使用右侧常用命令快速操作
                  </p>
                </div>
                <button className="btn-primary" onClick={() => setPickerOpen(true)}>
                  <ServerIcon size={15} /> 选择服务器
                </button>
              </div>
            </div>
          ) : (
            // 所有标签页常驻挂载，切换时仅通过 CSS 显隐，保证 SSH 会话与历史记录不丢失
            tabs.map((t, i) => (
              <div key={t.key} className={i === active ? 'h-full' : 'hidden'}>
                <TerminalTab
                  tabKey={t.key}
                  serverId={t.serverId}
                  serverName={t.name}
                  registerExec={registerExec}
                  unregisterExec={unregisterExec}
                />
              </div>
            ))
          )}
        </div>

        {/* 右侧栏：常用命令（默认）+ AI 助手 */}
        {sideOpen && (
          <aside className="flex w-[20rem] shrink-0 flex-col border-l border-line bg-panel">
            <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-line p-2">
              <button
                onClick={() => setSideTab('commands')}
                className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors duration-150 ${
                  sideTab === 'commands'
                    ? 'bg-accent-dim text-accent-bright'
                    : 'text-soft hover:bg-panel-2 hover:text-ink'
                }`}
              >
                <CommandIcon size={13} />
                常用命令
              </button>
              <button
                onClick={() => setSideTab('ai')}
                className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors duration-150 ${
                  sideTab === 'ai'
                    ? 'bg-accent-dim text-accent-bright'
                    : 'text-soft hover:bg-panel-2 hover:text-ink'
                }`}
              >
                <SparklesIcon size={13} />
                AI 助手
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {sideTab === 'commands' ? (
                <CommonCommands onRun={runCommand} />
              ) : (
                <AiPanel onRun={runCommand} />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* 服务器选择 */}
      <Modal
        open={pickerOpen}
        title="选择服务器"
        description="选择一个服务器打开新的终端标签"
        onClose={() => setPickerOpen(false)}
      >
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {servers.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong py-8 text-center">
              <ServerIcon size={22} className="text-faint" />
              <p className="text-[13px] text-soft">暂无服务器，请先到「服务器」页添加。</p>
            </div>
          )}
          {servers.map((s) => {
            const opened = tabs.some((t) => t.serverId === s.id)
            return (
              <button
                key={s.id}
                disabled={opened}
                onClick={() => {
                  openTab(s.id, s.name)
                  setPickerOpen(false)
                }}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-panel-2 px-3.5 py-2.5 text-left text-[13px] transition-colors duration-150 hover:border-line-strong hover:bg-raise disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ServerIcon size={15} className="shrink-0 text-accent" />
                  <span className="truncate font-medium text-ink">{s.name}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  {s.username}@{s.host}:{s.port}
                </span>
              </button>
            )
          })}
        </div>
      </Modal>

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-[70] -translate-x-1/2">
          <div
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] shadow-xl shadow-black/40 backdrop-blur ${
              toast.type === 'ok'
                ? 'border-accent/25 bg-panel/95 text-ink'
                : 'border-danger/30 bg-danger-dim/95 text-red-200'
            }`}
          >
            {toast.type === 'ok' ? (
              <CheckCircleIcon size={15} className="shrink-0 text-accent" />
            ) : (
              <AlertIcon size={15} className="shrink-0 text-danger" />
            )}
            <span className="max-w-md truncate">{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  )
}