import { SendIcon } from './icons'

interface InlineNode {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
}

type Block =
  | { type: 'h'; level: number; content: string }
  | { type: 'p'; content: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'quote'; content: string }
  | { type: 'hr' }
  | { type: 'code'; lang: string; content: string }

const FENCE = /^```([\w+-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const UL = /^\s*[-*•]\s+/
const OL = /^\s*\d+[.)]\s+/
const QUOTE = /^>\s?/

/** 解析行内格式：**粗体**、*斜体*、`行内代码` */
function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g
  let m: RegExpExecArray | null
  let last = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push({ text: text.slice(last, m.index) })
    const t = m[0]
    if (t.startsWith('**')) nodes.push({ text: t.slice(2, -2), bold: true })
    else if (t.startsWith('`')) nodes.push({ text: t.slice(1, -1), code: true })
    else nodes.push({ text: t.slice(1, -1), italic: true })
    last = m.index + t.length
  }
  if (last < text.length) nodes.push({ text: text.slice(last) })
  return nodes
}

/** 解析 markdown 子集为块级结构 */
function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    const fence = line.match(FENCE)
    if (fence) {
      const lang = fence[1] || ''
      const buf: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++
      blocks.push({ type: 'code', lang, content: buf.join('\n') })
      continue
    }

    const h = line.match(HEADING)
    if (h) {
      blocks.push({ type: 'h', level: h[1].length, content: h[2] })
      i++
      continue
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    if (UL.test(line)) {
      const items: string[] = []
      while (i < lines.length && UL.test(lines[i])) {
        items.push(lines[i].replace(UL, ''))
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    if (OL.test(line)) {
      const items: string[] = []
      while (i < lines.length && OL.test(lines[i])) {
        items.push(lines[i].replace(OL, ''))
        i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    if (QUOTE.test(line)) {
      const buf: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        buf.push(lines[i].replace(QUOTE, ''))
        i++
      }
      blocks.push({ type: 'quote', content: buf.join('\n') })
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    const buf: string[] = []
    while (i < lines.length) {
      const l = lines[i]
      if (!l.trim()) break
      if (
        FENCE.test(l) ||
        HEADING.test(l) ||
        HR.test(l) ||
        UL.test(l) ||
        OL.test(l) ||
        QUOTE.test(l)
      )
        break
      buf.push(l)
      i++
    }
    blocks.push({ type: 'p', content: buf.join('\n') })
  }
  return blocks
}

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.code)
          return (
            <code
              key={i}
              className="rounded bg-panel-2 px-1 py-0.5 font-mono text-[11px] text-accent-bright"
            >
              {n.text}
            </code>
          )
        return (
          <span key={i} className={n.bold ? 'font-semibold text-ink' : n.italic ? 'italic' : undefined}>
            {n.text}
          </span>
        )
      })}
    </>
  )
}

function CodeBlock({ lang, content, onSend }: { lang: string; content: string; onSend?: (cmd: string) => void }) {
  const cmd = content.trim()

  function send() {
    if (cmd) onSend?.(cmd)
  }

  return (
    <div
      onClick={send}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          send()
        }
      }}
      title="点击发送到当前终端"
      className="group my-1.5 cursor-pointer overflow-hidden rounded-lg border border-accent/30 bg-accent-dim/60 transition-colors duration-150 hover:border-accent/50 hover:bg-accent/10"
    >
      <div className="flex items-center justify-between border-b border-accent/20 px-2.5 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-accent-bright">
          {lang || '命令'}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-accent-bright opacity-60 transition-opacity duration-150 group-hover:opacity-100">
          <SendIcon size={11} />
          点击发送到终端
        </span>
      </div>
      <pre className="whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-xs leading-relaxed text-ink">
        {cmd}
      </pre>
    </div>
  )
}

const HEAD_SIZES = ['text-lg font-semibold', 'text-base font-semibold', 'text-[15px] font-semibold', 'text-sm font-semibold', 'text-sm font-medium', 'text-sm font-medium']

/** 轻量 markdown 渲染：标题/列表/引用/分隔线/代码块(点击发送到终端)，零外部依赖 */
export default function AiMarkdown({ text, onSend }: { text: string; onSend?: (cmd: string) => void }) {
  const blocks = parseBlocks(text)
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-soft">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h':
            return (
              <div key={i} className={HEAD_SIZES[b.level - 1] ?? 'text-sm font-semibold'}>
                <Inline nodes={parseInline(b.content)} />
              </div>
            )
          case 'p':
            return (
              <p key={i}>
                <Inline nodes={parseInline(b.content)} />
              </p>
            )
          case 'ul':
            return (
              <ul key={i} className="space-y-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-1.5">
                    <span className="shrink-0 text-accent">•</span>
                    <span>
                      <Inline nodes={parseInline(it)} />
                    </span>
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} className="space-y-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-1.5">
                    <span className="shrink-0 font-mono text-faint">{j + 1}.</span>
                    <span>
                      <Inline nodes={parseInline(it)} />
                    </span>
                  </li>
                ))}
              </ol>
            )
          case 'quote':
            return (
              <div key={i} className="border-l-2 border-line-strong bg-panel-2 px-2.5 py-1.5 text-faint">
                <Inline nodes={parseInline(b.content)} />
              </div>
            )
          case 'hr':
            return <div key={i} className="border-t border-line" />
          case 'code':
            return <CodeBlock key={i} lang={b.lang} content={b.content} onSend={onSend} />
        }
      })}
    </div>
  )
}