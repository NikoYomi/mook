import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { AlertIcon, RefreshIcon } from '../components/icons'

// 错误/下载相关关键词 → 行文字标红，网络错误前缀等常见词也覆盖
const ERR_RE =
  /\b(error|failed|failure|fatal|denied|refused|exception|panic|killed|not found|no such file|no such directory|unable to|cannot|could not|command not found|permission denied|syntax error|unrecognized|segmentation fault|traceback)\b|\b(错误|失败|拒绝|无法|无效|找不到|不存在|超时|异常|无权限|权限被拒绝)\b/i
// 形如 user@host ... $ / # / % [命令] 的提示符行（含用户输入回显）→ 标绿
const PROMPT_RE = /^[^\n]*@[^\n]*[\$#>%](?:\s+\S+.*)?$/
// 行首的回车 / ANSI 控制序列（如 \r \x1b[0m \x1b[J），在其后插入颜色以绕过 reset
const ANSI_LEAD_RE = /^(\r\n?|\x1b\[[0-9;?]*[A-Za-z])*/

interface Props {
  tabKey: number
  serverId: number
  serverName: string
  registerExec?: (key: number, fn: (cmd: string) => void) => void
  unregisterExec?: (key: number) => void
}

type Status = 'connecting' | 'connected' | 'closed'

export default function TerminalTab({
  tabKey,
  serverId,
  serverName,
  registerExec,
  unregisterExec,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const el = elRef.current
    if (!el) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace',
      theme: {
        background: '#070d1a',
        foreground: '#e2e8f0',
        cursor: '#22c55e',
        cursorAccent: '#020617',
        selectionBackground: 'rgba(34, 197, 94, 0.25)',
        red: '#f87171',
        green: '#22c55e',
      },
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)

    // 页面切到「服务器/设置」时终端容器会被隐藏，尺寸为 0，需跳过自适应
    const doFit = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        try {
          fit.fit()
        } catch {
          /* ignore */
        }
      }
    }
    doFit()

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/terminal?serverId=${serverId}`)
    setStatus('connecting')
    setError('')

    const send = (obj: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
    }
    const sendResize = () => {
      if (term.cols > 0 && term.rows > 0) {
        send({ type: 'resize', cols: term.cols, rows: term.rows })
      }
    }

    // 对输出按行注入 ANSI 颜色：错误行红、提示符/用户输入行绿
    const decorateLine = (line: string) => {
      const leadMatch = ANSI_LEAD_RE.exec(line)
      const lead = leadMatch ? leadMatch[0] : ''
      const rest = line.slice(lead.length)
      if (!rest) return line
      if (ERR_RE.test(rest)) return `${lead}\x1b[31m${rest}\x1b[0m`
      if (PROMPT_RE.test(rest)) return `${lead}\x1b[32m${rest}\x1b[0m`
      return line
    }
    // 按行注入 ANSI 颜色：错误行红、提示符/用户输入行绿。
    // 行以 \n 或 \r 分隔；无分隔符的尾部（如未换行的提示符）立即输出，避免暂存导致不显示。
    let pending = ''
    const decorate = (chunk: string) => {
      pending += chunk
      let out = ''
      let buf = pending
      pending = ''
      while (buf.length > 0) {
        const ci = buf.search(/[\r\n]/)
        if (ci === -1) {
          out += decorateLine(buf)
          break
        }
        out += decorateLine(buf.slice(0, ci))
        if (buf[ci] === '\n') {
          out += '\n'
          buf = buf.slice(ci + 1)
        } else {
          out += '\r'
          if (buf[ci + 1] === '\n') {
            out += '\n'
            buf = buf.slice(ci + 2)
          } else {
            buf = buf.slice(ci + 1)
          }
        }
      }
      return out
    }

    ws.onopen = () => {
      setStatus('connected')
      sendResize()
      term.focus()
    }
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data)
        if (m.type === 'output') {
          term.write(decorate(m.data))
        } else if (m.type === 'error') {
          setStatus('closed')
          setError(m.message || '连接失败')
        } else if (m.type === 'closed') {
          setStatus('closed')
          setError(m.reason || '连接已断开')
        }
      } catch {
        /* 忽略无法解析的消息 */
      }
    }
    ws.onclose = () => {
      setStatus('closed')
      setError((prev) => prev || '连接已断开')
    }
    ws.onerror = () => {
      setStatus('closed')
      setError('无法连接服务器')
    }

    // 供右侧「常用命令 / AI」把命令写入当前会话
    const exec = (cmd: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        send({ type: 'input', data: `${cmd}\r` })
      }
    }
    registerExec?.(tabKey, exec)

    const dataDisposer = term.onData((d) => send({ type: 'input', data: d }))
    const ro = new ResizeObserver(() => {
      doFit()
      sendResize()
    })
    ro.observe(el)

    return () => {
      dataDisposer.dispose()
      ro.disconnect()
      unregisterExec?.(tabKey)
      ws.close()
      term.dispose()
    }
  }, [serverId, retry, tabKey, registerExec, unregisterExec])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line bg-panel/90 px-3">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <StatusDot status={status} />
          <span className="truncate font-medium text-soft">{serverName}</span>
          <span
            className={
              status === 'connected'
                ? 'text-accent-bright'
                : status === 'connecting'
                  ? 'text-warn'
                  : 'text-danger'
            }
          >
            {status === 'connected' ? '已连接' : status === 'connecting' ? '连接中…' : '已断开'}
          </span>
        </div>
        {status === 'closed' && (
          <button
            onClick={() => setRetry((r) => r + 1)}
            className="btn-soft flex-none py-1 text-[11px]"
          >
            <RefreshIcon size={12} /> 重新连接
          </button>
        )}
      </div>
      {error && status === 'closed' && (
        <div className="flex items-center gap-1.5 border-b border-danger/20 bg-danger-dim px-3 py-1.5 text-[11px] text-red-300">
          <AlertIcon size={12} className="shrink-0 text-danger" />
          <span className="truncate">{error}</span>
        </div>
      )}
      <div ref={elRef} className="min-h-0 flex-1 bg-[#070d1a] p-1" />
    </div>
  )
}

function StatusDot({ status }: { status: Status }) {
  const cls =
    status === 'connected'
      ? 'bg-accent shadow-[0_0_6px_rgba(34,197,94,0.7)]'
      : status === 'connecting'
        ? 'bg-warn'
        : 'bg-danger'
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />
}