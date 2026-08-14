import { useState } from 'react'
import { api } from '../api/client'
import { extractCommand } from '../utils/command'
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  LoaderIcon,
  SendIcon,
  SparklesIcon,
} from './icons'

interface Props {
  onRun?: (command: string) => void
}

export default function AiPanel({ onRun }: Props) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function run() {
    setError('')
    setOutput('')
    if (!input.trim()) {
      setError('请先粘贴日志或命令输出')
      return
    }
    setBusy(true)
    try {
      const res = await api.aiAnalyze(input)
      setOutput(res.result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '调用失败')
    } finally {
      setBusy(false)
    }
  }

  async function copyOutput() {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  }

  function runInTerminal() {
    const cmd = extractCommand(output)
    if (cmd) onRun?.(cmd)
  }

  const canSend = Boolean(extractCommand(output))

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <SparklesIcon size={15} className="text-accent" />
          AI 助手 · 分析日志
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-faint">
          不懂就问，复制粘贴给 AI，让它回答你。
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={7}
          className="input flex-none resize-none font-mono text-xs leading-relaxed"
          placeholder="例如：我运行xx命令，现在输出（粘贴输出），这是什么问题，如何解决？"
        />
        <button onClick={run} disabled={busy} className="btn-primary w-full flex-none">
          {busy ? (
            <>
              <LoaderIcon size={14} className="animate-spin" />
              分析中…
            </>
          ) : (
            <>
              <SparklesIcon size={14} /> 开始分析
            </>
          )}
        </button>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-dim px-3 py-2 text-xs text-danger">
            <AlertIcon size={14} className="mt-0.5 shrink-0 text-danger" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-canvas/60">
          <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
              {busy ? '处理中' : output ? '结果' : '输出'}
            </span>
            {output && (
              <div className="flex items-center gap-1">
                {canSend && (
                  <button
                    onClick={runInTerminal}
                    className="flex cursor-pointer items-center gap-1 rounded-md border border-accent/25 bg-accent-dim px-2 py-1 text-[11px] text-accent-bright transition-colors duration-150 hover:bg-accent/20"
                    title="把命令发送到当前终端"
                  >
                    <SendIcon size={12} />
                    发送到终端
                  </button>
                )}
                <button
                  onClick={copyOutput}
                  className="icon-btn h-6 w-6"
                  title="复制结果"
                  aria-label="复制结果"
                >
                  {copied ? <CheckIcon size={13} className="text-accent" /> : <CopyIcon size={13} />}
                </button>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {busy ? (
              <div className="flex h-full items-center justify-center gap-2 text-xs text-faint">
                <LoaderIcon size={14} className="animate-spin text-accent" />
                正在调用 AI…
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-soft">
                {output || '分析结果将显示在这里'}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}