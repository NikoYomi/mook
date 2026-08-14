import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { useCommands, type CommandItem } from '../store/commands'
import { api } from '../api/client'
import { extractCommand } from '../utils/command'
import {
  CommandIcon,
  LoaderIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  StarIcon,
  TrashIcon,
} from './icons'

interface Props {
  onRun: (command: string) => void
}

export default function CommonCommands({ onRun }: Props) {
  const { commands, add, update, remove, use, togglePin } = useCommands()
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CommandItem | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.command.toLowerCase().includes(q) ||
        (c.category ?? '').toLowerCase().includes(q),
    )
  }, [commands, query])

  function handleRun(c: CommandItem) {
    onRun(c.command)
    void use(c.id) // 记录使用次数（自动排序依据），失败不影响运行
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="relative flex-1">
          <SearchIcon
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索命令…"
            className="input py-1.5 pl-8 text-[13px]"
            aria-label="搜索常用命令"
          />
        </div>
        <button
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
          className="btn-primary px-2.5 py-1.5"
          title="添加常用命令"
          aria-label="添加常用命令"
        >
          <PlusIcon size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel-2 text-faint">
              <CommandIcon size={22} />
            </span>
            <p className="text-[13px] text-soft">
              {commands.length === 0 ? '还没有常用命令' : '没有匹配的命令'}
            </p>
            {commands.length === 0 && (
              <button
                className="btn-soft mt-1"
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
                title="添加常用命令"
              >
                <PlusIcon size={13} /> 添加第一条命令
              </button>
            )}
          </div>
        ) : (
          filtered.map((c) => (
            <div
              key={c.id}
              className={`group rounded-xl border bg-panel-2 p-2.5 transition-colors duration-150 hover:border-line-strong ${
                c.pinned ? 'border-accent/30' : 'border-line'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  {c.pinned ? (
                    <StarIcon size={14} className="shrink-0 fill-accent text-accent" />
                  ) : (
                    <CommandIcon size={14} className="shrink-0 text-accent" />
                  )}
                  <span className="truncate text-[13px] font-medium text-ink">{c.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:duration-150 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button
                    onClick={() => handleRun(c)}
                    className="icon-btn h-6 w-6 hover:text-accent"
                    title="在终端中运行"
                    aria-label={`运行 ${c.name}`}
                  >
                    <PlayIcon size={13} />
                  </button>
                  <button
                    onClick={() => togglePin(c.id)}
                    className={`icon-btn h-6 w-6 ${c.pinned ? 'text-accent' : 'hover:text-accent'}`}
                    title={c.pinned ? '取消置顶' : '置顶到最前'}
                    aria-label={c.pinned ? `取消置顶 ${c.name}` : `置顶 ${c.name}`}
                  >
                    <StarIcon size={13} />
                  </button>
                  <button
                    onClick={() => {
                      setEditing(c)
                      setFormOpen(true)
                    }}
                    className="icon-btn h-6 w-6"
                    title="编辑"
                    aria-label={`编辑 ${c.name}`}
                  >
                    <PencilIcon size={13} />
                  </button>
                  <button
                    onClick={() => remove(c.id)}
                    className="icon-btn h-6 w-6 hover:text-danger"
                    title="删除"
                    aria-label={`删除 ${c.name}`}
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-line/70 bg-canvas/70 px-2 py-1 font-mono text-[11px] text-accent-bright/90">
                  {c.command}
                </code>
                {c.category && (
                  <span className="chip shrink-0 py-0 text-faint">{c.category}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <CommandFormModal
        open={formOpen}
        editing={editing}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSubmit={(data) => {
          if (editing) update(editing.id, data)
          else add(data)
          setFormOpen(false)
          setEditing(null)
        }}
      />
    </div>
  )
}

function CommandFormModal({
  open,
  editing,
  onClose,
  onSubmit,
}: {
  open: boolean
  editing: CommandItem | null
  onClose: () => void
  onSubmit: (data: { name: string; command: string; category?: string }) => void
}) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState('')
  // AI 生成命令
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '')
      setCommand(editing?.command ?? '')
      setCategory(editing?.category ?? '')
      setError('')
      setAiError('')
    }
  }, [open, editing])

  /** 用「名称」框里输入的自然语言，让 AI 生成命令并填入命令框。
   *  注意：只在鼠标点击 ✨ 按钮时触发；名称输入框内按回车不会触发 AI。 */
  async function generateByAI() {
    setAiError('')
    const prompt = name.trim()
    if (!prompt) {
      setAiError('请先填写命令名称，再点击右侧 AI 图标生成命令')
      return
    }
    setAiBusy(true)
    try {
      const res = await api.aiCommand(prompt)
      const cmd = extractCommand(res.result)
      if (cmd) {
        setCommand(cmd)
        setAiError('')
      } else {
        setAiError('AI 未能生成有效命令，请换个说法再试')
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI 调用失败')
    } finally {
      setAiBusy(false)
    }
  }

  function submit() {
    if (!name.trim()) {
      setError('请填写命令名称')
      return
    }
    if (!command.trim()) {
      setError('请填写命令内容')
      return
    }
    onSubmit({ name: name.trim(), command: command.trim(), category: category.trim() || undefined })
  }

  return (
    <Modal
      open={open}
      title={editing ? '编辑常用命令' : '添加常用命令'}
      description="保存后点击运行，即可在终端中快速执行"
      onClose={onClose}
    >
      <div className="space-y-3">
        <label className="block">
          <span className="label">名称 *</span>
          <div className="relative">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input pr-11"
              placeholder="例如：查看磁盘占用，或描述你想做什么"
              autoFocus
            />
            <button
              type="button"
              onClick={generateByAI}
              disabled={aiBusy || !name.trim()}
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-accent transition-colors duration-150 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
              title={name.trim() ? '根据名称自动生成命令' : '先填写名称，再点这里生成命令'}
              aria-label="AI 根据名称生成命令"
            >
              {aiBusy ? (
                <LoaderIcon size={14} className="animate-spin" />
              ) : (
                <SparklesIcon size={14} />
              )}
            </button>
          </div>
          <span className="mt-1 block text-[11px] text-faint">
            输入名称后点击右侧 ✨ 图标，AI 会把命令自动填入下方命令框（回车不会触发 AI）
          </span>
        </label>

        {aiError && (
          <div className="break-all rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn">
            {aiError}
          </div>
        )}

        <label className="block">
          <span className="label">命令 *</span>
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            rows={3}
            className="input resize-none font-mono text-[13px]"
            placeholder="例如：df -h"
          />
        </label>
        <label className="block">
          <span className="label">分类（可选）</span>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="input"
            placeholder="例如：系统 / 网络 / 日志"
          />
        </label>
        {error && (
          <div className="rounded-lg border border-danger/25 bg-danger-dim px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose} title="取消，不保存">
            取消
          </button>
          <button className="btn-primary" onClick={submit} title="保存常用命令">
            {editing ? '保存修改' : '添加'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
