import type { ReactNode } from 'react'
import { useRef } from 'react'
import { XIcon } from './icons'

interface Props {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  width?: 'sm' | 'md' | 'lg'
  height?: string
}

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

export default function Modal({ open, title, description, onClose, children, width = 'md', height }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)

  if (!open) return null

  // 修复：鼠标在输入框内框选/拖选文字把选择拖出弹窗边界，
  // mouseup 落在背景遮罩上会触发点击关闭，导致已输入内容丢失。
  // 当框内输入控件存在非空选区、或 DOM 选择非折叠且起点在弹窗内时，
  // 认为是"框选拖拽"，不触发关闭。
  function handleOutsideClick() {
    if (boxRef.current) {
      const active = document.activeElement
      if (active && boxRef.current.contains(active)) {
        const typedSel =
          (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
          active.selectionStart != null &&
          active.selectionEnd != null &&
          active.selectionStart !== active.selectionEnd
        const sel = window.getSelection()
        const domSelInBox = sel && !sel.isCollapsed && boxRef.current.contains(sel.anchorNode)
        if (typedSel || domSelInBox) return
      }
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={handleOutsideClick}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={boxRef}
        className={`flex w-full ${WIDTHS[width]} ${height ?? ''} max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/60`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-soft">{description}</p>}
          </div>
          <button onClick={onClose} className="icon-btn -mr-1 -mt-1 shrink-0" title="关闭" aria-label="关闭">
            <XIcon size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}