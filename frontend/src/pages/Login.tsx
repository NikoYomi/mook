import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useI18n } from '../utils/i18n'
import {
  AlertIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeOffIcon,
  GithubIcon,
  LoaderIcon,
  LockIcon,
  ShieldIcon,
} from '../components/icons'

export default function Login() {
  const t = useI18n()
  const { loading, setupRequired, init, login, setup, user } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const navigate = useNavigate()

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ type, msg })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2000)
  }

  useEffect(() => {
    if (!user) init()
  }, [user, init])

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (setupRequired && password !== confirm) {
      showToast('两次输入的密码不一致', 'err')
      return
    }
    setBusy(true)
    try {
      if (setupRequired) await setup(password)
      else await login(password)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '操作失败', 'err')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3">
          <LoaderIcon size={22} className="animate-spin text-accent" />
          <span className="text-sm text-soft">正在加载…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3">
            <img
              src="/icon.png"
              alt="Mook"
              className="h-16 w-16 rounded-2xl object-cover shadow-lg shadow-accent/10"
              title="Mook"
            />
            <p className="text-center text-[13px] text-soft">
              {setupRequired ? '欢迎使用，请先完成初始化' : 'AI 驱动的自托管 SSH 终端'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="card space-y-3 p-6">
            {setupRequired && (
              <p className="rounded-lg border border-info/20 bg-info/10 px-3 py-2 text-center text-xs text-info">
                首次使用，请设置管理员密码（至少 6 位）
              </p>
            )}
            <label className="block">
              <span className="label">{setupRequired ? '设置密码' : '密码'}</span>
              <div className="relative">
                <LockIcon
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                />
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={setupRequired ? '至少 6 位' : '请输入密码'}
                  className="input py-2.5 pl-9 pr-10"
                  autoComplete={setupRequired ? 'new-password' : 'current-password'}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-faint transition-colors duration-150 hover:text-ink"
                  title={show ? '隐藏密码' : '显示密码'}
                  aria-label={show ? '隐藏密码' : '显示密码'}
                >
                  {show ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                </button>
              </div>
            </label>

            {setupRequired && (
              <label className="block">
                <span className="label">确认密码</span>
                <div className="relative">
                  <LockIcon
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                  />
                  <input
                    type={show ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="再次输入密码"
                    className="input py-2.5 pl-9"
                  />
                </div>
              </label>
            )}

            {toast &&
              createPortal(
                <div
                  className="pointer-events-none fixed left-1/2 top-4 z-[80] -translate-x-1/2"
                  role="status"
                >
                  <div
                    className={`flex max-w-md items-center gap-2 rounded-lg border px-3 py-2 text-[13px] shadow-lg ${
                      toast.type === 'ok'
                        ? 'border-accent/25 bg-panel text-accent'
                        : 'border-danger/25 bg-danger-dim text-danger'
                    }`}
                  >
                    {toast.type === 'ok' ? (
                      <CheckCircleIcon size={14} className="shrink-0" />
                    ) : (
                      <AlertIcon size={14} className="shrink-0" />
                    )}
                    <span className="min-w-0 break-all">{toast.msg}</span>
                  </div>
                </div>,
                document.body,
              )}

            <button
              type="submit"
              disabled={busy}
              className="btn-primary w-full py-2.5"
              title={setupRequired ? '设置初始密码并进入系统' : '登录系统'}
            >
              {busy ? (
                <>
                  <LoaderIcon size={14} className="animate-spin" /> {t('loginLoading')}
                </>
              ) : setupRequired ? (
                '初始化并进入'
              ) : (
                t('login')
              )}
            </button>
          </form>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-faint">
            <ShieldIcon size={12} />
            会话有效期 6 小时 · 失败 5 次锁定 15 分钟
          </p>
        </div>
      </div>

      {/* 页脚（与服务器 / 终端页一致） */}
      <footer className="flex shrink-0 items-center justify-center gap-1.5 border-t border-line px-5 py-2.5 text-[11px] text-faint">
        <span>© 2026</span>
        <a
          href="https://github.com/NikoYomi"
          target="_blank"
          rel="noopener noreferrer"
          title="NikoYomi 主页"
          className="transition-colors duration-150 hover:text-ink"
        >
          NikoYomi
        </a>
        <span>· Built with AI assistance ·</span>
        <a
          href="https://github.com/NikoYomi/mook"
          target="_blank"
          rel="noopener noreferrer"
          title="Mook 开源项目地址"
          className="flex items-center text-soft transition-colors duration-150 hover:text-ink"
        >
          <GithubIcon size={13} />
        </a>
        <span>v0.2.8</span>
      </footer>
    </div>
  )
}