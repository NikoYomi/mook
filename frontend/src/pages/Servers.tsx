import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import ServerForm from '../components/ServerForm'
import type { Server, ServerInput } from '../api/client'
import { useServers } from '../store/servers'
import { useI18n } from '../utils/i18n'
import { formatDateTime } from '../utils/command'
import {
  AlertIcon,
  GithubIcon,
  HistoryIcon,
  KeyIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  TerminalIcon,
  TrashIcon,
} from '../components/icons'

export default function Servers() {
  const t = useI18n()
  const { servers, loading, load, create, update, remove } = useServers()
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Server | undefined>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return servers
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }, [servers, query])

  async function handleSubmit(data: ServerInput) {
    setError('')
    setBusy(true)
    try {
      if (editing) await update(editing.id, data)
      else await create(data)
      setFormOpen(false)
      setEditing(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(s: Server) {
    if (!window.confirm(`确定删除服务器「${s.name}」吗？`)) return
    try {
      await remove(s.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-panel/40 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[15px] font-semibold text-ink">{t('servers')}</h1>
          <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[11px] text-soft">
            {servers.length} 台
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称 / 地址 / 标签…"
              className="input w-64 py-1.5 pl-8 text-[13px]"
              aria-label="搜索服务器"
            />
          </div>
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            <PlusIcon size={15} /> {t('addServer')}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-danger/20 bg-danger-dim px-5 py-2 text-[13px] text-danger">
          <AlertIcon size={14} className="shrink-0 text-danger" />
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-soft">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center overflow-y-auto p-4">
            <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed border-line-strong bg-panel/40 px-6 py-10 text-center sm:px-10 sm:py-12">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-line bg-panel-2 text-faint">
                <ServerIcon size={26} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {servers.length === 0 ? '还没有服务器' : '没有匹配的服务器'}
                </p>
                <p className="mt-1 text-xs text-soft">
                  {servers.length === 0
                    ? '添加你的第一台服务器，开始远程管理'
                    : '换个关键词试试'}
                </p>
              </div>
              {servers.length === 0 && (
                <button
                  className="btn-primary shrink-0"
                  onClick={() => {
                    setEditing(undefined)
                    setFormOpen(true)
                  }}
                >
                  <PlusIcon size={15} /> {t('addServer')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            {filtered.map((s) => (
              <div
                key={s.id}
                className="group flex flex-col rounded-2xl border border-line bg-panel p-4 transition-colors duration-150 hover:border-line-strong"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/15 bg-accent-dim text-accent">
                      <ServerIcon size={17} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{s.name}</div>
                      <div className="truncate font-mono text-[11px] text-faint">
                        {s.username}@{s.host}:{s.port}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                      s.auth_type === 'key'
                        ? 'border-info/25 bg-info/10 text-info'
                        : 'border-warn/25 bg-warn/10 text-warn'
                    }`}
                  >
                    {s.auth_type === 'key' ? <KeyIcon size={11} /> : <LockIcon size={11} />}
                    {s.auth_type === 'key' ? '私钥' : '密码'}
                  </span>
                </div>

                <div className="mb-3 flex shrink-0 items-center gap-1.5 text-[11px] text-faint">
                  <HistoryIcon size={12} className="shrink-0" />
                  <span className="truncate">
                    上次连接：
                    <span className={s.last_connected_at ? 'text-soft' : ''}>
                      {s.last_connected_at ? formatDateTime(s.last_connected_at) : '从未连接'}
                    </span>
                  </span>
                </div>

                {s.tags.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1">
                    {s.tags.map((t) => (
                      <span key={t} className="chip text-faint">
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex gap-2 pt-1">
                  <button
                    className="btn-primary flex-1"
                    onClick={() => navigate(`/terminal/${s.id}`)}
                  >
                    <TerminalIcon size={14} /> {t('connect')}
                  </button>                  <button
                    className="btn-ghost px-2.5"
                    onClick={() => {
                      setEditing(s)
                      setFormOpen(true)
                    }}
                    title="编辑"
                    aria-label={`编辑 ${s.name}`}
                  >
                    <PencilIcon size={14} />
                  </button>
                  <button
                    className="btn-danger px-2.5"
                    onClick={() => handleDelete(s)}
                    title="删除"
                    aria-label={`删除 ${s.name}`}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-center gap-1.5 border-t border-line px-5 py-2.5 text-[11px] text-faint">
        <span>© 2026</span>
        <a
          href="https://github.com/NikoYomi"
          target="_blank"
          rel="noopener noreferrer"
          title="NikoYomi 主页"
          className="transition-colors duration-150 hover:text-ink"
        >
          NikoYomi
        </a>
        <span>· Built with AI assistance ·</span>
        <a
          href="https://github.com/NikoYomi/mook"
          target="_blank"
          rel="noopener noreferrer"
          title="Mook 开源项目地址"
          className="flex items-center text-soft transition-colors duration-150 hover:text-ink"
        >
          <GithubIcon size={13} />
        </a>
        <span>v0.2.1</span>
      </footer>

      <Modal
        open={formOpen}
        title={editing ? `编辑服务器：${editing.name}` : '添加服务器'}
        description="保存后可一键连接，凭据将加密存储在后端"
        onClose={() => {
          setFormOpen(false)
          setEditing(undefined)
        }}
      >
        <ServerForm
          initial={editing}
          submitting={busy}
          onSubmit={handleSubmit}
          onCancel={() => {
            setFormOpen(false)
            setEditing(undefined)
          }}
        />
      </Modal>
    </div>
  )
}