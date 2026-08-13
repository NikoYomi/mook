import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import {
  AlertIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderIcon,
  LockIcon,
  ShieldIcon,
  TerminalIcon,
  UserIcon,
} from '../components/icons'

export default function Login() {
  const { loading, setupRequired, init, login, setup, user } = useAuth()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!user) init()
  }, [user, init])

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (setupRequired && password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      if (setupRequired) await setup(password)
      else await login(username.trim() || 'admin', password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
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
    <div className="flex h-full items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent-dim text-accent shadow-lg shadow-accent/10">
            <TerminalIcon size={26} />
          </span>
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-wide text-ink">Mook</h1>
            <p className="mt-1 text-[13px] text-soft">
              {setupRequired ? '欢迎使用，请先完成初始化' : 'AI 驱动的自托管 SSH 终端'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-3 p-6">
          {setupRequired && (
            <p className="rounded-lg border border-info/20 bg-info/10 px-3 py-2 text-center text-xs text-info">
              首次使用，请设置管理员密码（至少 6 位）
            </p>
          )}
          <label className="block">
            <span className="label">用户名</span>
            <div className="relative">
              <UserIcon
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="input py-2.5 pl-9"
                autoComplete="username"
              />
            </div>
          </label>
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

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger-dim px-3 py-2 text-[13px] text-red-300">
              <AlertIcon size={14} className="shrink-0 text-danger" />
              {error}
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
            {busy ? (
              <>
                <LoaderIcon size={14} className="animate-spin" /> 处理中…
              </>
            ) : setupRequired ? (
              '初始化并进入'
            ) : (
              '登录'
            )}
          </button>
        </form>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-faint">
          <ShieldIcon size={12} />
          密码 bcrypt 加密存储 · 会话有效期 7 天 · 失败 5 次锁定 15 分钟
        </p>
      </div>
    </div>
  )
}