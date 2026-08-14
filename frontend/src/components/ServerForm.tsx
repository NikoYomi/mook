import type { FormEvent } from 'react'
import { useState } from 'react'
import type { Server, ServerInput } from '../api/client'

export default function ServerForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial?: Server
  submitting: boolean
  onSubmit: (data: ServerInput) => Promise<void> | void
  onCancel: () => void
}) {
  const [form, setForm] = useState<ServerInput>(() =>
    initial
      ? {
          name: initial.name,
          host: initial.host,
          port: initial.port,
          username: initial.username,
          auth_type: initial.auth_type,
          password: '',
          private_key: '',
          tags: initial.tags,
        }
      : {
          name: '',
          host: '',
          port: 22,
          username: 'root',
          auth_type: 'password',
          password: '',
          private_key: '',
          tags: [],
        },
  )
  const [tagText, setTagText] = useState((initial?.tags ?? []).join('，'))

  const set = <K extends keyof ServerInput>(key: K, value: ServerInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const tags = tagText
      .split(/[,，、\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    await onSubmit({ ...form, tags })
  }

  const auth = form.auth_type

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">名称 *</span>
          <input
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="input"
            placeholder="例如：我的 VPS"
          />
        </label>
        <label className="block">
          <span className="label">地址 *</span>
          <input
            required
            value={form.host}
            onChange={(e) => set('host', e.target.value)}
            className="input font-mono"
            placeholder="1.2.3.4 或 example.com"
          />
        </label>
        <label className="block">
          <span className="label">端口</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={(e) => set('port', Number(e.target.value))}
            className="input font-mono"
          />
        </label>
        <label className="block">
          <span className="label">用户名</span>
          <input
            value={form.username}
            onChange={(e) => set('username', e.target.value)}
            className="input font-mono"
            placeholder="root"
          />
        </label>
      </div>

      <div>
        <span className="label">认证方式</span>
        <div className="flex gap-3">
          {(['password', 'key'] as const).map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors duration-150 ${
                auth === t
                  ? 'border-accent/40 bg-accent-dim text-ink'
                  : 'border-line text-soft hover:border-line-strong'
              }`}
            >
              <input
                type="radio"
                name="auth"
                checked={auth === t}
                onChange={() => set('auth_type', t)}
                className="accent-accent"
              />
              {t === 'password' ? '密码' : '私钥'}
            </label>
          ))}
        </div>
      </div>

      {auth === 'password' ? (
        <label className="block">
          <span className="label">密码{initial ? '（留空则不修改）' : ' *'}</span>
          <input
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            className="input font-mono"
            placeholder="SSH 密码"
            required={!initial}
          />
        </label>
      ) : (
        <label className="block">
          <span className="label">私钥{initial ? '（留空则不修改）' : ' *'}</span>
          <textarea
            value={form.private_key}
            onChange={(e) => set('private_key', e.target.value)}
            rows={5}
            className="input resize-none font-mono text-xs leading-relaxed"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            required={!initial}
          />
        </label>
      )}

      <label className="block">
        <span className="label">标签（用逗号分隔）</span>
        <input
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          className="input"
          placeholder="例如：生产, 香港"
        />
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn-ghost" onClick={onCancel} title="取消，不保存">
          取消
        </button>
        <button type="submit" disabled={submitting} className="btn-primary" title="保存服务器配置">
          {submitting ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  )
}