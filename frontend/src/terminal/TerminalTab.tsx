import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { withBase } from '../api/base'
import { AlertIcon, CheckIcon, CopyIcon, LayersIcon, RefreshIcon } from '../components/icons'
import { useI18n } from '../utils/i18n'
import { copyText } from '../utils/clipboard'
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
  registerExec?: (key: number, fn: (cmd: string) => boolean) => void
  unregisterExec?: (key: number) => void
  onDisconnect?: (tabKey: number) => void
}

type Status = 'connecting' | 'connected' | 'closed'

export default function TerminalTab({
  tabKey,
  serverId,
  serverName,
  registerExec,
  unregisterExec,
  onDisconnect,
}: Props) {
  const t = useI18n()
  const wrapRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  // 选中文字后浮出的「复制」按钮位置（相对终端容器左上角，单位 px）
  const [selBox, setSelBox] = useState<{ top: number; left: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [hint, setHint] = useState('')

  const termBg = useSettings((s) => s.termBg)
  const termBgImage = useSettings((s) => s.termBgImage)
  const setTermBg = useSettings((s) => s.setTermBg)

  const cycleBackground = () => {
    const order = CYCLE_ORDER
    const idx = order.indexOf(termBg)
    const next = order[(idx + 1) % order.length]
    setTermBg(next)
  }

  // 复制当前终端选中内容（供浮动按钮调用）
  const handleCopySelection = async () => {
    const term = termRef.current
    const sel = term?.getSelection()
    if (!sel) return
    const ok = await copyText(sel)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
    term?.focus()
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
    const ws = new WebSocket(`${proto}://${window.location.host}${withBase('/ws/terminal')}?serverId=${serverId}`)
    setStatus('connecting')
    setError('')

    // 组件卸载 / 重连重建会话时主动关闭，不视为「断开」，不触发 onDisconnect
    let intentionalClose = false

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
      // 补发连接建立前排队的命令
      if (queuedCmds.length > 0) {
        writeInput(queuedCmds.join('\n'))
        queuedCmds = []
      }
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
          onDisconnect?.(tabKey)
        } else if (m.type === 'closed') {
          setStatus('closed')
          setError(m.reason || '连接已断开')
          onDisconnect?.(tabKey)
        }
      } catch {
        /* 忽略无法解析的消息 */
      }
    }
    ws.onclose = () => {
      setStatus('closed')
      setError((prev) => prev || '连接已断开')
      if (!intentionalClose) onDisconnect?.(tabKey)
    }
    ws.onerror = () => {
      setStatus('closed')
      setError('无法连接服务器')
      onDisconnect?.(tabKey)
    }

    // 供右侧「常用命令 / AI」把命令写入当前会话；返回是否真正写入成功
    let queuedCmds: string[] = []
    const writeInput = (cmd: string) => {
      for (const c of cmd + ' ') if (isPrintable(c)) echoTarget += c
      send({ type: 'input', data: `${cmd}\r` })
    }
    const exec = (cmd: string): boolean => {
      if (ws.readyState === WebSocket.OPEN) {
        writeInput(cmd)
        // 命令写入后把键盘焦点还给终端，方便继续输入
        term.focus()
        return true
      }
      // 连接尚未建立（刚打开标签/刚切换）：排队，等 onopen 后补发
      if (ws.readyState === WebSocket.CONNECTING) {
        queuedCmds.push(cmd)
        return true
      }
      return false
    }
    registerExec?.(tabKey, exec)

    // —— 剪贴板提示 ——
    let hintTimer = 0
    const flashHint = (msg: string) => {
      setHint(msg)
      window.clearTimeout(hintTimer)
      hintTimer = window.setTimeout(() => setHint(''), 2600)
    }

    // —— 粘贴 ——
    // 剪贴板「读取」不像写入那样能降级：非安全上下文（http://IP:端口）下
    // navigator.clipboard 不存在，只能提示用户改用 HTTPS 或 localhost。
    const pasteFromClipboard = () => {
      const clip = navigator.clipboard
      if (!clip || typeof clip.readText !== 'function') {
        flashHint('当前环境无法读取剪贴板（需 HTTPS 或 localhost 访问）')
        return
      }
      clip
        .readText()
        .then((txt) => {
          if (!txt) return
          for (const c of txt) if (isPrintable(c)) echoTarget += c
          send({ type: 'input', data: txt })
          term.focus()
        })
        .catch(() => flashHint('浏览器拒绝了剪贴板读取权限'))
    }

    // —— 选区浮动复制按钮 ——
    // xterm 5.x 用 DomRenderer，选区被渲染成 .xterm-selection 下若干绝对定位 div，
    // 其 left/top/width/height 已是相对 .xterm-screen 的像素值 —— 直接读它即可像素级对齐，
    // 无需私有 API。注意该层在 xterm 自己的 requestAnimationFrame 里才刷新，
    // 所以这里用「嵌套两层 rAF」，确保读到的是刷新之后的几何。
    let raf1 = 0
    let raf2 = 0
    const syncSel = () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          const host = elRef.current
          const wrap = wrapRef.current
          if (!host || !wrap || !term.hasSelection()) {
            setSelBox(null)
            return
          }
          const layer = host.querySelector('.xterm-selection')
          const screen = host.querySelector('.xterm-screen')
          const kids = layer ? Array.from(layer.children) : []
          if (!screen || kids.length === 0) {
            setSelBox(null)
            return
          }
          const wrapRect = wrap.getBoundingClientRect()
          const scrRect = screen.getBoundingClientRect()
          const baseX = scrRect.left - wrapRect.left
          const baseY = scrRect.top - wrapRect.top
          let minTop = Infinity
          let maxRight = -Infinity
          for (const k of kids) {
            const s = (k as HTMLElement).style
            const t = parseFloat(s.top) || 0
            const l = parseFloat(s.left) || 0
            const w = parseFloat(s.width) || 0
            if (t < minTop) minTop = t
            if (l + w > maxRight) maxRight = l + w
          }
          if (!Number.isFinite(minTop) || !Number.isFinite(maxRight)) {
            setSelBox(null)
            return
          }
          const BTN = 26
          const GAP = 4
          // 默认贴在选区首行右上角外侧；上方空间不足时改贴首行内侧，避免被容器裁掉
          let top = baseY + minTop - BTN - GAP
          if (top < 2) top = baseY + minTop + 2
          let left = baseX + maxRight - BTN
          const maxLeft = Math.max(2, wrapRect.width - BTN - 2)
          left = Math.min(Math.max(left, 2), maxLeft)
          setSelBox({ top, left })
        })
      })
    }

    // 拖选过程中先收起按钮，松手后按新选区重新定位；双击则改为粘贴。
    let dragging = false
    const onDownCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      // 点在复制按钮上：交给按钮自身的 onClick，不参与选区/粘贴逻辑
      if (target && target.closest('[data-term-copy]')) return
      if (e.detail === 2) {
        // 双击 → 粘贴。捕获阶段拦下并阻止冒泡，避免 xterm 触发「双击选词」
        e.preventDefault()
        e.stopPropagation()
        pasteFromClipboard()
        return
      }
      dragging = true
      setSelBox(null)
    }
    const onUpCapture = () => {
      if (!dragging) return
      dragging = false
      syncSel()
    }
    el.addEventListener('mousedown', onDownCapture, true)
    el.addEventListener('mouseup', onUpCapture, true)

    const selDisposer = term.onSelectionChange(() => {
      setCopied(false)
      syncSel()
    })
    const scrollDisposer = term.onScroll(() => syncSel())
    const resizeDisposer = term.onResize(() => syncSel())

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
        if (sel) copyText(sel)
        return false
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        pasteFromClipboard()
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
      selDisposer.dispose()
      scrollDisposer.dispose()
      resizeDisposer.dispose()
      ro.disconnect()
      el.removeEventListener('mousedown', onDownCapture, true)
      el.removeEventListener('mouseup', onUpCapture, true)
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.clearTimeout(hintTimer)
      setSelBox(null)
      unregisterExec?.(tabKey)
      intentionalClose = true
      ws.close()
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, retry, tabKey, registerExec, unregisterExec])

  // 背景切换：仅更新容器样式与 xterm 透明度，不重建会话
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const style = bgStyle(termBg, termBgImage)
    Object.assign(wrap.style, style)
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
          {hint && <span className="truncate text-warn">{hint}</span>}
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
              title="重新连接当前终端"
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
      {/* 左右留白，避免终端输出贴边 */}
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 px-3 py-1.5"
        style={bgStyle(termBg, termBgImage)}
      >
        <div ref={elRef} className="h-full w-full" />
        {selBox && (
          <button
            data-term-copy
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCopySelection}
            style={{ top: selBox.top, left: selBox.left }}
            title={copied ? '已复制' : '复制选中内容'}
            aria-label="复制选中内容"
            className="absolute z-20 flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-md border border-line-strong bg-panel/95 text-soft shadow-lg shadow-black/40 backdrop-blur transition-colors duration-150 hover:border-accent/40 hover:text-accent-bright"
          >
            {copied ? (
              <CheckIcon size={14} className="text-accent-bright" />
            ) : (
              <CopyIcon size={14} />
            )}
          </button>
        )}
      </div>
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