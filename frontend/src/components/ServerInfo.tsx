import { useEffect, useRef, useState } from 'react'
import { api, type ServerStats } from '../api/client'
import { useServers } from '../store/servers'
import { formatBytes, formatDateTime } from '../utils/command'
import {
  ActivityIcon,
  AlertIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  CpuIcon,
  DatabaseIcon,
  GlobeIcon,
  HardDriveIcon,
  LoaderIcon,
  ServerIcon,
} from './icons'

const POLL_MS = 3000

export default function ServerInfo({ serverId }: { serverId: number | null }) {
  const servers = useServers((s) => s.servers)
  const server = servers.find((s) => s.id === serverId)

  const host = server?.host ?? ''

  const [stats, setStats] = useState<ServerStats | null>(null)
  const [statsError, setStatsError] = useState('')
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)

  // 串行轮询服务器实时状态（上一次完成后才排下一次），避免高延迟下请求重叠、响应乱序。
  useEffect(() => {
    setStats(null)
    setStatsError('')
    if (serverId == null) return

    let stop = false
    let timer: number | undefined
    const load = async () => {
      try {
        const s = await api.serverStats(serverId)
        if (stop) return
        setStats(s)
        setStatsError('')
      } catch (err) {
        if (!stop) setStatsError(err instanceof Error ? err.message : '采集失败')
      } finally {
        if (!stop) timer = window.setTimeout(load, POLL_MS)
      }
    }
    load()
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [serverId])

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

  async function copyHost() {
    if (!host) return
    try {
      await navigator.clipboard.writeText(host)
      setCopied(true)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  }

  const memPct = stats && stats.mem_total > 0 ? (stats.mem_used / stats.mem_total) * 100 : 0
  const diskPct = stats && stats.disk_total > 0 ? (stats.disk_used / stats.disk_total) * 100 : 0

  // 简化宽屏布局：统计区用网格；窄屏（左侧栏展开时空间有限）保持两列
  const metric = 'flex items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-2'
  const metricLabel = 'flex items-center gap-1.5 text-[11px] text-faint'
  const metricValue = 'min-w-0 truncate text-right font-mono text-xs text-soft'

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/15 bg-accent-dim text-accent">
          <ServerIcon size={17} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{server.name}</div>
          <div className="truncate font-mono text-[11px] text-faint">
            {server.username}@{server.host}
          </div>
        </div>
      </div>

      {statsError && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-danger/25 bg-danger-dim px-2.5 py-1.5 text-[11px] text-danger">
          <AlertIcon size={12} className="shrink-0 text-danger" />
          <span className="min-w-0 break-all">{statsError}</span>
        </div>
      )}

      <div className="space-y-1.5">
        {/* 地址：仅显示 IP，点击可复制 */}
        <button
          onClick={copyHost}
          className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-2 transition-colors duration-150 hover:border-accent/40 hover:bg-raise"
          title="点击复制 IP 地址"
        >
          <span className={metricLabel}>
            <GlobeIcon size={13} />
            地址
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs text-soft">{server.host}</span>
            {copied ? (
              <CheckIcon size={13} className="shrink-0 text-accent" />
            ) : (
              <CopyIcon size={12} className="shrink-0 text-faint transition-colors duration-150 group-hover:text-accent" />
            )}
          </span>
        </button>

        {/* 延迟 */}
        <div className={metric}>
          <span className={metricLabel}>
            <ActivityIcon size={13} />
            延迟
          </span>
          <span className={metricValue}>
            {stats ? (
              `${stats.latency_ms} ms`
            ) : statsError ? (
              '--'
            ) : (
              <LoaderIcon size={12} className="animate-spin text-accent" />
            )}
          </span>
        </div>
      </div>

      {/* 系统实时监控 */}
      <div className="mt-1.5 space-y-1.5">
        <div className={metric}>
          <span className={metricLabel}>
            <CpuIcon size={13} />
            CPU
          </span>
          <span className={metricValue}>
            {stats ? (
              `${Number.isFinite(stats.cpu_percent) && stats.cpu_percent >= 0 ? `${Math.round(stats.cpu_percent)}%` : '--'} · ${stats.cores || '-'} 核`
            ) : statsError ? (
              '--'
            ) : null}
          </span>
        </div>

        {stats && stats.mem_total > 0 && (
          <div className="rounded-lg border border-line bg-panel-2 px-2.5 py-2">
            <div className={metricLabel}>
              <DatabaseIcon size={13} />
              内存
              <span className="ml-auto font-mono text-[11px] text-soft">
                {formatBytes(stats.mem_used)} / {formatBytes(stats.mem_total)}
              </span>
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-canvas">
              <div
                className={`h-full rounded-full transition-all duration-300 ${memPct > 90 ? 'bg-danger' : memPct > 70 ? 'bg-warn' : 'bg-accent'}`}
                style={{ width: `${Math.min(100, memPct)}%` }}
              />
            </div>
          </div>
        )}

        {stats && stats.disk_total > 0 && (
          <div className="rounded-lg border border-line bg-panel-2 px-2.5 py-2">
            <div className={metricLabel}>
              <HardDriveIcon size={13} />
              硬盘
              <span className="ml-auto font-mono text-[11px] text-soft">
                {formatBytes(stats.disk_used)} / {formatBytes(stats.disk_total)}
              </span>
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-canvas">
              <div
                className={`h-full rounded-full transition-all duration-300 ${diskPct > 90 ? 'bg-danger' : diskPct > 70 ? 'bg-warn' : 'bg-accent'}`}
                style={{ width: `${Math.min(100, diskPct)}%` }}
              />
            </div>
          </div>
        )}

        <div className={metric}>
          <span className={metricLabel}>
            <ClockIcon size={13} />
            更新时间
          </span>
          <span className="font-mono text-[11px] text-soft">
            {stats ? formatDateTime(new Date(stats.ts * 1000).toISOString()) : '-'}
          </span>
        </div>
      </div>
    </div>
  )
}