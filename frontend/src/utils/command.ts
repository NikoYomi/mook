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