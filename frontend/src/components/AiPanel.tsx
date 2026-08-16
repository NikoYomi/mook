import { api } from '../api/client'
import { useAiPanel, panelKey } from '../store/aiPanel'
import AiMarkdown from './AiMarkdown'
import { AlertIcon, LoaderIcon, SparklesIcon } from './icons'

interface Props {
  onRun?: (command: string) => void
  // 当前激活的终端标签 key：每个标签拥有独立的 AI 对话，切换标签时跟随变化
  ownerKey: number | null
}

export default function AiPanel({ onRun, ownerKey }: Props) {
  const key = panelKey(ownerKey)
  const input = useAiPanel((s) => s.byKey[key]?.input ?? '')
  const output = useAiPanel((s) => s.byKey[key]?.output ?? '')
  const error = useAiPanel((s) => s.byKey[key]?.error ?? '')
  const busy = useAiPanel((s) => s.byKey[key]?.busy ?? false)
  const setState = useAiPanel((s) => s.setState)

  async function run() {
    setState(ownerKey, { error: '', output: '' })
    if (!input.trim()) {
      setState(ownerKey, { error: '请先粘贴日志或命令输出' })
      return
    }
    setState(ownerKey, { busy: true })
    try {
      const res = await api.aiAnalyze(input)
      setState(ownerKey, { output: res.result })
    } catch (err) {
      setState(ownerKey, { error: err instanceof Error ? err.message : '调用失败' })
    } finally {
      setState(ownerKey, { busy: false })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <SparklesIcon size={15} className="text-accent" />
          Mook AI助手
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
        <textarea
          value={input}
          onChange={(e) => setState(ownerKey, { input: e.target.value })}
          rows={7}
          className="input flex-none resize-none font-mono text-xs leading-relaxed"
          placeholder="例如：我运行xx命令，现在输出（粘贴输出），这是什么问题，如何解决？"
        />
        <button
          onClick={run}
          disabled={busy}
          className="btn-primary w-full flex-none"
          title="让 AI 分析输入的内容并给出诊断与建议"
        >
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
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {busy ? (
              <div className="flex h-full items-center justify-center gap-2 text-xs text-faint">
                <LoaderIcon size={14} className="animate-spin text-accent" />
                正在调用 AI…
              </div>
            ) : output ? (
              <AiMarkdown text={output} onSend={(cmd) => onRun?.(cmd)} />
            ) : (
              <div className="text-xs text-faint">分析结果将显示在这里</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}