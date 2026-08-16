import { useEffect, useRef, useState } from 'react'
import { api, type ServerStats } from '../api/client'
import { useServers } from '../store/servers'
import { formatBytes, formatDateTime } from '../utils/command'
import { copyText } from '../utils/clipboard'
import {
  ActivityIcon,
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

const POLL_MS = 1000

export default function ServerInfo({
  serverId,
  onError,
}: {
  serverId: number | null
  onError?: (msg: string) => void
}) {
  const servers = useServers((s) => s.servers)
  const server = servers.find((s) => s.id === serverId)

  const host = server?.host ?? ''

  // 每台服务器最新数据的缓存：切换标签时立即显示该服务器上次数据，不闪空/不跳动
  const cacheRef = useRef<Map<number, ServerStats>>(new Map())
  // 轮询成功后 tick 一次触发重渲染（数据本身存于 cacheRef）
  const [, setTick] = useState(0)
  const [statsError, setStatsError] = useState('')
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)
  // 去重：仅当错误消息变化时才向上层上报 toast，避免轮询期反复弹窗
  const lastErr = useRef('')

  // 串行轮询服务器实时状态（上一次完成后才排下一次），避免高延迟下请求重叠、响应乱序。
  // 失败时保留上一次数据（不闪烁清空），仅记录错误状态供 UI 提示。
  useEffect(() => {
    setStatsError('')
    if (serverId == null) return

    let stop = false
    let timer: number | undefined
    const load = async () => {
      try {
        const s = await api.serverStats(serverId)
        if (stop) return
        cacheRef.current.set(serverId, s)
        setTick((v) => v + 1)
        setStatsError('')
      } catch (err) {
        if (!stop) {
          const msg = err instanceof Error ? err.message : '采集失败'
          setStatsError(msg)
          if (msg !== lastErr.current) {
            lastErr.current = msg
            onError?.(msg)
          }
        }
      } finally {
        if (!stop) timer = window.setTimeout(load, POLL_MS)
      }
    }
    load()
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [serverId, onError])

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
    const ok = await copyText(host)
    if (ok) {
      setCopied(true)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
    }
  }

  // 当前服务器对应的数据：优先读缓存（切换标签时立即显示该服务器上次数据，不闪空）
  const current = serverId != null ? cacheRef.current.get(serverId) ?? null : null
  const memPct = current && current.mem_total > 0 ? (current.mem_used / current.mem_total) * 100 : 0
  const diskPct = current && current.disk_total > 0 ? (current.disk_used / current.disk_total) * 100 : 0

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
            {current ? (
              `${current.latency_ms} ms`
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
            {current ? (
              `${Number.isFinite(current.cpu_percent) && current.cpu_percent >= 0 ? `${Math.round(current.cpu_percent)}%` : '--'} · ${current.cores || '-'} 核`
            ) : statsError ? (
              '--'
            ) : null}
          </span>
        </div>

        {current && current.mem_total > 0 && (
          <div className="rounded-lg border border-line bg-panel-2 px-2.5 py-2">
            <div className={metricLabel}>
              <DatabaseIcon size={13} />
              内存
              <span className="ml-auto font-mono text-[11px] text-soft">
                {formatBytes(current.mem_used)} / {formatBytes(current.mem_total)}
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

        {current && current.disk_total > 0 && (
          <div className="rounded-lg border border-line bg-panel-2 px-2.5 py-2">
            <div className={metricLabel}>
              <HardDriveIcon size={13} />
              硬盘
              <span className="ml-auto font-mono text-[11px] text-soft">
                {formatBytes(current.disk_used)} / {formatBytes(current.disk_total)}
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
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-soft">
            {current ? formatDateTime(new Date(current.ts * 1000).toISOString()) : '-'}
            {current && statsError && <span className="text-danger">更新失败</span>}
          </span>
        </div>
      </div>
    </div>
  )
}