import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { AlertIcon, LayersIcon, RefreshIcon } from '../components/icons'
import { useI18n } from '../utils/i18n'
import { useSettings } from '../store/settings'
import { BACKGROUNDS, bgStyle, CYCLE_ORDER, XTERM_BG_CLASSIC, XTERM_BG_TEXTURE } from './backgrounds'

// 错误/下载相关关键词 → 行文字标红
const ERR_RE =
  /\b(error|failed|failure|fatal|denied|refused|exception|panic|killed|not found|no such file|no such directory|unable to|cannot|could not|command not found|permission denied|syntax error|unrecognized|segmentation fault|traceback)\b|\b(错误|失败|拒绝|无法|无效|找不到|不存在|超时|异常|无权限|权限被拒绝)\b/i
// 形如 user@host ... $ / # 的提示符行 → 标绿（允许命令与尾部空格）
const PROMPT_RE = /^[^\n]*@[^\n]*[\$#>%][^\n]*$/
// 清除终端中的 ANSI 转义（CSI / OSC / 字符集），用于纯文本匹配
const stripAnsi = (s: string) =>
  s
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')

// 行首的回车 / ANSI 控制序列（如 \r \x1b[0m \x1b[J），在其后插入颜色以绕过 reset
const ANSI_LEAD_RE = /^(\r\n?|\x1b\[[0-9;?]*[A-Za-z])*/

const isPrintable = (c: string) => /[\x20-\x7e]/.test(c)

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
  const t = useI18n()
  const elRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  const termBg = useSettings((s) => s.termBg)
  const termBgImage = useSettings((s) => s.termBgImage)
  const setTermBg = useSettings((s) => s.setTermBg)

  const cycleBackground = () => {
    const order = CYCLE_ORDER
    const idx = order.indexOf(termBg)
    const next = order[(idx + 1) % order.length]
    setTermBg(next)
  }

  useEffect(() => {
    const el = elRef.current
    if (!el) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      allowProposedApi: true,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace',
      allowTransparency: true,
      theme: {
        background: termBg === 'classic' ? XTERM_BG_CLASSIC : XTERM_BG_TEXTURE,
        foreground: '#e2e8f0',
        cursor: '#22c55e',
        cursorAccent: '#020617',
        selectionBackground: 'rgba(34, 197, 94, 0.25)',
        red: '#f87171',
        green: '#22c55e',
      },
      scrollback: 5000,
    })
    termRef.current = term
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

    // 用户输入回显追踪：远端会把用户输入原样回显，用括号匹配来标绿
    let echoTarget = ''

    const decorateLine = (line: string) => {
      const leadMatch = ANSI_LEAD_RE.exec(line)
      const lead = leadMatch ? leadMatch[0] : ''
      const rest = line.slice(lead.length)
      if (!rest) return line

      // 1) 用户输入回显 → 绿（优先，避免被错误关键词误判）
      if (echoTarget) {
        let i = 0
        while (i < rest.length && i < echoTarget.length && rest[i] === echoTarget[i]) i++
        if (i > 0) {
          const matched = rest.slice(0, i)
          const tail = rest.slice(i)
          echoTarget = echoTarget.slice(i)
          return `${lead}\x1b[32m${matched}\x1b[0m${tail}`
        }
        // 回显与预期不匹配（如密码不回显）→ 放弃追踪
        echoTarget = ''
      }

      const clean = stripAnsi(rest)
      // 2) 报错 → 红
      if (ERR_RE.test(clean)) return `${lead}\x1b[31m${rest}\x1b[0m`
      // 3) 提示符 → 绿
      if (PROMPT_RE.test(clean)) return `${lead}\x1b[32m${rest}\x1b[0m`
      return line
    }

    // 按行注入 ANSI 颜色。行以 \n 或 \r 分隔；无分隔符的尾部（如未换行的提示符）立即输出
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
          // 输出到达即认为回显目标已消耗完毕（多数回显不含换行）
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
        for (const c of cmd + ' ') if (isPrintable(c)) echoTarget += c
        send({ type: 'input', data: `${cmd}\r` })
      }
      // 命令写入后把键盘焦点还给终端，方便继续输入
      term.focus()
    }
    registerExec?.(tabKey, exec)

    const dataDisposer = term.onData((d) => {
      // 记录可显示字符作为回显匹配目标（忽略控制序列）
      for (const c of d) if (isPrintable(c)) echoTarget += c
      send({ type: 'input', data: d })
    })

    // Ctrl/Cmd + Shift + C 复制选中内容，Shift + V 粘贴（不发送到远端）。
    // xterm 5.x 该 API 返回 void，会随 term.dispose() 一并清理。
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        const sel = term.getSelection()
        if (sel) navigator.clipboard.writeText(sel).catch(() => {})
        return false
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        navigator.clipboard
          .readText()
          .then((txt) => {
            if (txt) {
              for (const c of txt) if (isPrintable(c)) echoTarget += c
              send({ type: 'input', data: txt })
            }
          })
          .catch(() => {})
        return false
      }
      return true
    })

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
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, retry, tabKey, registerExec, unregisterExec])

  // 背景切换：仅更新容器样式与 xterm 透明度，不重建会话
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const style = bgStyle(termBg, termBgImage)
    Object.assign(el.style, style)
    const term = termRef.current
    if (term) {
      term.options.theme = {
        ...term.options.theme,
        background: termBg === 'classic' ? XTERM_BG_CLASSIC : XTERM_BG_TEXTURE,
      }
      try {
        term.refresh(0, term.rows - 1)
      } catch {
        /* ignore */
      }
    }
  }, [termBg, termBgImage])

  const flexreset =
    'flex shrink-0 cursor-pointer items-center justify-center rounded-md bg-canvas/40 text-faint transition-colors duration-150 hover:bg-raise hover:text-ink'

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
            {status === 'connected' ? t('connected') : status === 'connecting' ? t('connecting') : t('disconnected')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={cycleBackground}
            className={flexreset}
            title={`切换终端背景（当前：${(BACKGROUNDS[termBg] as { name: string })?.name ?? termBg}）`}
            aria-label="切换终端背景"
          >
            <LayersIcon size={13} />
          </button>
          {status === 'closed' && (
            <button
              onClick={() => setRetry((r) => r + 1)}
              className="btn-soft flex-none py-1 text-[11px]"
            >
              <RefreshIcon size={12} /> {t('retry')} 重新连接
            </button>
          )}
        </div>
      </div>
      {error && status === 'closed' && (
        <div className="flex items-center gap-1.5 border-b border-danger/20 bg-danger-dim px-3 py-1.5 text-[11px] text-danger">
          <AlertIcon size={12} className="shrink-0 text-danger" />
          <span className="truncate">{error}</span>
        </div>
      )}
      <div ref={elRef} className="min-h-0 flex-1 p-1" style={bgStyle(termBg, termBgImage)} />
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