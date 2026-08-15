// 弹窗遮罩点击关闭时的框选拖拽保护。
// 鼠标在输入框内框选/拖选文字把选择拖出弹窗边界，mouseup 落在背景遮罩上
// 会触发点击关闭，导致已输入内容丢失。当框内输入控件存在非空选区、
// 或 DOM 选择非折叠且起点在弹窗内时，认为是"框选拖拽"，不触发关闭。
export function isDragSelectingInside(box: HTMLElement | null): boolean {
  if (!box) return false
  const active = document.activeElement
  if (active && box.contains(active)) {
    const typedSel =
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
      active.selectionStart != null &&
      active.selectionEnd != null &&
      active.selectionStart !== active.selectionEnd
    const sel = window.getSelection()
    const domSelInBox =
      !!sel && !sel.isCollapsed && !!sel.anchorNode && box.contains(sel.anchorNode)
    return typedSel || domSelInBox
  }
  return false
}