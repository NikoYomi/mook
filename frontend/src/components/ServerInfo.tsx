import { useNavigate } from 'react-router-dom'
import { useServers } from '../store/servers'
import {
  ClockIcon,
  GlobeIcon,
  KeyIcon,
  LockIcon,
  PencilIcon,
  ServerIcon,
  TagIcon,
  UserIcon,
} from './icons'

export default function ServerInfo({ serverId }: { serverId: number | null }) {
  const servers = useServers((s) => s.servers)
  const navigate = useNavigate()
  const server = servers.find((s) => s.id === serverId)

  if (!server) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel-2 text-faint">
          <ServerIcon size={18} />
        </span>
        <p className="text-xs text-faint">打开一个终端后，这里会显示该服务器的详细信息</p>
      </div>
    )
  }

  const rows: { label: string; value: string; icon: typeof GlobeIcon }[] = [
    { label: '地址', value: `${server.host}:${server.port}`, icon: GlobeIcon },
    { label: '用户名', value: server.username, icon: UserIcon },
    {
      label: '认证方式',
      value: server.auth_type === 'key' ? '私钥' : '密码',
      icon: server.auth_type === 'key' ? KeyIcon : LockIcon,
    },
  ]

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/15 bg-accent-dim text-accent">
          <ServerIcon size={17} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{server.name}</div>
          <div className="truncate font-mono text-[11px] text-faint">
            {server.username}@{server.host}:{server.port}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        {rows.map((row) => {
          const Icon = row.icon
          return (
            <div
              key={row.label}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-2"
            >
              <span className="flex items-center gap-1.5 text-[11px] text-faint">
                <Icon size={13} />
                {row.label}
              </span>
              <span className="min-w-0 truncate text-right font-mono text-xs text-soft">
                {row.value}
              </span>
            </div>
          )
        })}
        <div className="rounded-lg border border-line bg-panel-2 px-2.5 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-faint">
            <TagIcon size={13} />
            标签
          </div>
          {server.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {server.tags.map((t) => (
                <span key={t} className="chip text-faint">
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[11px] text-faint">无</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-2">
          <span className="flex items-center gap-1.5 text-[11px] text-faint">
            <ClockIcon size={13} />
            更新时间
          </span>
          <span className="font-mono text-[11px] text-soft">
            {server.updated_at ? server.updated_at.replace('T', ' ').slice(0, 16) : '-'}
          </span>
        </div>
      </div>

      <button
        className="btn-ghost mt-3 w-full"
        onClick={() => navigate('/')}
      >
        <PencilIcon size={14} /> 编辑服务器
      </button>
    </div>
  )
}