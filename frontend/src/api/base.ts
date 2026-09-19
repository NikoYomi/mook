/**
 * 应用外部访问前缀。
 *
 * 后端输出 index.html 时会注入 <base href="...">：
 *   - 独立部署（根路径）→ "/"
 *   - 飞牛 fnOS 统一网关 → "/app/mook/"
 *
 * 前端所有站内绝对路径（API、WebSocket、静态图片）都必须经过 withBase()，
 * 才能让同一份构建产物同时兼容这两种部署方式。
 */
function detectBasePath(): string {
  const href = document.querySelector('base')?.getAttribute('href') ?? '/'
  // 去掉结尾斜杠："/app/mook/" → "/app/mook"；"/" → ""
  return href.replace(/\/+$/, '')
}

export const BASE_PATH = detectBasePath()

/** 给以 "/" 开头的站内路径加上访问前缀；外部 URL 原样返回 */
export function withBase(path: string): string {
  if (!BASE_PATH || !path.startsWith('/')) return path
  return BASE_PATH + path
}
