/** 从 AI 回复中提取可执行命令：优先取代码块首行，其次取第一个非中文句子 */
export function extractCommand(text: string): string {
  const fence = text.match(/```(?:bash|sh|shell)?\s*\n([\s\S]*?)```/)
  if (fence) {
    const lines = fence[1]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    return lines[0] ?? ''
  }
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  for (const line of lines) {
    if (/^[#$]/.test(line)) return line.replace(/^[#$]\s*/, '')
    if (/[\u4e00-\u9fa5]/.test(line[0] ?? '')) continue
    if (/^[-*•\d.]/.test(line)) continue
    if (line.length > 2) return line
  }
  return ''
}

/** 把模型名转成更友好的展示名，如 deepseek-chat -> DeepSeek */
export function friendlyModelName(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('deepseek')) return 'DeepSeek'
  if (m.includes('gpt')) return 'GPT'
  if (m.includes('qwen')) return 'Qwen'
  if (m.includes('glm')) return 'GLM'
  if (m.includes('claude')) return 'Claude'
  if (m.includes('ollama') || m.includes('llama')) return 'Ollama'
  const trimmed = model.trim()
  return trimmed || 'AI'
}

/** 把 ISO 时间字符串格式化为「年 月 日 时:分」，非法输入返回 '-' */
export function formatDateTime(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  if (d.getFullYear() <= 1970) return '-'
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}年${m}月${day}日 ${hh}:${mm}`
}

/** 把字节数格式化为可读大小，如 1.2 GB */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  do {
    v /= 1024
    i += 1
  } while (v >= 1024 && i < units.length - 1)
  return `${v.toFixed(1)} ${units[i]}`
}

/** 把字节/秒格式化为可读速率 */
export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s'
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`
  const units = ['KB/s', 'MB/s', 'GB/s']
  let v = bytesPerSec
  let i = -1
  do {
    v /= 1024
    i += 1
  } while (v >= 1024 && i < units.length - 1)
  return `${v.toFixed(1)} ${units[i]}`
}