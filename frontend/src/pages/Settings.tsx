import type { FormEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../components/Modal'
import { api, type BackupData } from '../api/client'
import { useAuth } from '../store/auth'
import { useAi } from '../store/ai'
import { useCommands } from '../store/commands'
import { useServers } from '../store/servers'
import { friendlyModelName } from '../utils/command'
import { AI_PROVIDERS, providerByBaseUrl } from '../utils/aiProviders'
import {
  AlertIcon,
  CheckCircleIcon,
  DownloadIcon,
  GlobeIcon,
  KeyIcon,
  LoaderIcon,
  ShieldIcon,
  SparklesIcon,
  TerminalIcon,
  UploadIcon,
  UserIcon,
  XCircleIcon,
  ZapIcon,
} from '../components/icons'

export type SettingsTab = 'ai' | 'account' | 'backup' | 'about'

function unique(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean)))
}

interface Props {
  open: boolean
  initialTab?: SettingsTab
  onClose: () => void
}

export default function SettingsModal({ open, initialTab = 'ai', onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [model, setModel] = useState('deepseek-chat')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [validated, setValidated] = useState(false)
  const [providerId, setProviderId] = useState('deepseek')
  const [customName, setCustomName] = useState('')
  const [liveModels, setLiveModels] = useState<string[]>([])
  const [modelManual, setModelManual] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsMsg, setModelsMsg] = useState('')
  const [saved, setSaved] = useState('')
  const [validateError, setValidateError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // 账户
  const user = useAuth((s) => s.user)
  const setUsername = useAuth((s) => s.setUsername)
  const [username, setUsernameInput] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountMsg, setAccountMsg] = useState('')
  const [accountError, setAccountError] = useState('')

  // 备份
  const importRef = useRef<HTMLInputElement>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState('')
  const [backupError, setBackupError] = useState('')

  const commands = useCommands((s) => s.commands)
  const replaceCommands = useCommands((s) => s.replace)
  const loadServers = useServers((s) => s.load)
  const refreshAi = useAi((s) => s.refresh)

  const provider = useMemo(() => AI_PROVIDERS.find((p) => p.id === providerId), [providerId])

  // 外部指定初始子菜单时同步
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  useEffect(() => {
    if (!open) return
    setError('')
    setSaved('')
    setValidateError('')
    api
      .getAiSettings()
      .then((s) => {
        setBaseUrl(s.base_url)
        setModel(s.model)
        setHasKey(s.has_api_key)
        setValidated(s.validated)
        const p = providerByBaseUrl(s.base_url)
        setProviderId(p ? p.id : 'custom')
      })
      .catch((err) => setError(err instanceof Error ? err.message : '读取设置失败'))
  }, [open])

  useEffect(() => {
    setUsernameInput(user ?? '')
  }, [user])

  function selectProvider(id: string) {
    setProviderId(id)
    setLiveModels([])
    setModelsMsg('')
    const p = AI_PROVIDERS.find((x) => x.id === id)
    if (p) {
      setBaseUrl(p.baseUrl)
      setModelManual(id === 'custom')
    }
  }

  async function fetchModels() {
    setModelsLoading(true)
    setModelsMsg('')
    try {
      const res = await api.listModels(baseUrl.trim(), apiKey.trim())
      if (res.models.length === 0) {
        setLiveModels([])
        setModelsMsg('接口未返回可用模型，请检查 API Key 或接口地址')
      } else {
        setLiveModels(res.models)
        setModelsMsg(`获取到 ${res.models.length} 个可用模型`)
      }
    } catch (err) {
      setLiveModels([])
      setModelsMsg(
        err instanceof Error
          ? err.message.replace(/^获取模型列表失败：/, '')
          : '获取模型列表失败',
      )
    } finally {
      setModelsLoading(false)
    }
  }

  // 输入 API Key（或切换厂商/接口地址，本地 Ollama 无需密钥）后自动拉取模型
  useEffect(() => {
    if (!baseUrl.trim()) return
    if (!apiKey.trim() && provider?.id !== 'ollama') return
    const t = setTimeout(() => {
      fetchModels()
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, baseUrl, providerId])

  const modelOptions = useMemo(() => unique([...liveModels, model]), [liveModels, model])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSaved('')
    setValidateError('')
    setBusy(true)
    try {
      const res = await api.saveAiSettings({
        base_url: baseUrl.trim(),
        model: model.trim(),
        api_key: apiKey.trim(),
      })
      setHasKey(Boolean(apiKey.trim()) || hasKey)
      setApiKey('')
      setValidated(res.validated)
      if (res.validated) {
        setSaved('设置已保存，密钥验证通过')
      } else {
        setSaved('设置已保存')
        const noKey = !hasKey && !apiKey.trim()
        setValidateError(
          noKey
            ? '尚未配置 API Key，请填写后保存以启用 AI'
            : res.error || '密钥未通过验证，请检查 API Key / 接口地址 / 模型',
        )
      }
      await refreshAi()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleUsername(e: FormEvent) {
    e.preventDefault()
    setAccountMsg('')
    setAccountError('')
    const name = username.trim()
    if (!name) {
      setAccountError('用户名不能为空')
      return
    }
    setAccountBusy(true)
    try {
      const res = await api.changeUsername(name)
      setUsername(res.username)
      setAccountMsg('用户名已更新，下次登录请使用新用户名')
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : '修改失败')
    } finally {
      setAccountBusy(false)
    }
  }

  async function handlePassword(e: FormEvent) {
    e.preventDefault()
    setAccountMsg('')
    setAccountError('')
    if (newPassword.length < 6) {
      setAccountError('新密码至少 6 位')
      return
    }
    if (newPassword !== confirmPassword) {
      setAccountError('两次输入的新密码不一致')
      return
    }
    setAccountBusy(true)
    try {
      await api.changePassword(oldPassword, newPassword)
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setAccountMsg('密码已更新')
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : '修改失败')
    } finally {
      setAccountBusy(false)
    }
  }

  async function handleExport() {
    setBackupBusy(true)
    setBackupMsg('')
    setBackupError('')
    try {
      const data = await api.getBackup()
      const full: BackupData = { ...data, common_commands: commands }
      const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const d = new Date()
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
      a.href = url
      a.download = `mook-backup-${stamp}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setBackupMsg('备份已导出（包含服务器、AI 设置与常用命令）')
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return
    setBackupBusy(true)
    setBackupMsg('')
    setBackupError('')
    try {
      const text = await file.text()
      const data = JSON.parse(text) as BackupData
      if (!data || data.version !== 1 || !Array.isArray(data.servers)) {
        throw new Error('不是有效的 Mook 备份文件')
      }
      const res = await api.restoreBackup({
        version: data.version,
        servers: data.servers,
        settings: data.settings ?? {},
      })
      if (Array.isArray(data.common_commands)) {
        const raw = data.common_commands as Array<Record<string, unknown>>
        const cmds = raw
          .filter((x) => x && typeof x.name === 'string' && typeof x.command === 'string')
          .map((x, i) => ({
            id:
              typeof x.id === 'string' && x.id
                ? (x.id as string)
                : `imp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
            name: x.name as string,
            command: x.command as string,
            category: typeof x.category === 'string' ? (x.category as string) : undefined,
            createdAt: typeof x.createdAt === 'number' ? (x.createdAt as number) : Date.now(),
          }))
        replaceCommands(cmds)
      }
      await Promise.all([loadServers(), refreshAi()])
      const cmdCount = Array.isArray(data.common_commands) ? data.common_commands.length : 0
      setBackupMsg(
        `还原成功：${res.servers_restored} 台服务器、AI 设置${cmdCount > 0 ? `、${cmdCount} 条常用命令` : ''}已恢复`,
      )
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setBackupBusy(false)
      if (importRef.current) importRef.current.value = ''
    }
  }

  const menu: { key: SettingsTab; label: string; icon: typeof SparklesIcon }[] = [
    { key: 'ai', label: 'AI 助手', icon: SparklesIcon },
    { key: 'account', label: '账户安全', icon: ShieldIcon },
    { key: 'backup', label: '备份与还原', icon: ZapIcon },
    { key: 'about', label: '关于', icon: TerminalIcon },
  ]

  return (
    <Modal
      open={open}
      title="设置"
      description="AI 助手 · 账户安全 · 备份与还原"
      onClose={onClose}
      width="md"
      height="h-[540px]"
    >
      <div className="flex h-full min-h-0 flex-col gap-4 sm:flex-row">
        {/* 子菜单 */}
        <nav className="flex shrink-0 gap-1 overflow-x-auto sm:w-40 sm:flex-col sm:border-r sm:border-line sm:pr-2">
          {menu.map((item) => {
            const Icon = item.icon
            const active = tab === item.key
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] transition-colors duration-150 ${
                  active
                    ? 'bg-accent-dim text-accent-bright'
                    : 'text-soft hover:bg-panel-2 hover:text-ink'
                }`}
              >
                <Icon size={15} className={active ? 'text-accent' : 'text-faint'} />
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* 内容区 */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {tab === 'ai' && (
            <div className="space-y-3.5">
              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${
                  validated
                    ? 'border-accent/25 bg-accent-dim text-accent-bright'
                    : 'border-line bg-panel-2 text-faint'
                }`}
              >
                {validated ? (
                  <CheckCircleIcon size={15} className="shrink-0" />
                ) : (
                  <XCircleIcon size={15} className="shrink-0" />
                )}
                <span>
                  {validated
                    ? `当前状态：已验证 · ${
                        providerId === 'custom' && customName
                          ? customName
                          : model
                            ? friendlyModelName(model)
                            : 'AI 已启用'
                      }`
                    : '当前状态：未启用'}
                </span>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div>
                  <span className="label">选择厂商</span>
                  <select
                    value={providerId}
                    onChange={(e) => selectProvider(e.target.value)}
                    className="input cursor-pointer font-mono"
                  >
                    {AI_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id} className="bg-panel text-ink">
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {providerId === 'custom' && (
                    <input
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      className="input mt-2 font-mono"
                      placeholder="自定义厂商名称"
                    />
                  )}
                </div>

                <label className="block">
                  <span className="label">接口地址（Base URL）</span>
                  <input
                    value={baseUrl}
                    onChange={(e) => {
                      setBaseUrl(e.target.value)
                      const p = providerByBaseUrl(e.target.value)
                      if (p) setProviderId(p.id)
                    }}
                    className="input font-mono"
                    placeholder="https://api.deepseek.com"
                  />
                </label>

                <label className="block">
                  <span className="label flex items-center gap-1.5">
                    API Key
                    {hasKey && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent-dim px-2 py-0.5 text-[11px] font-normal text-accent-bright">
                        <CheckCircleIcon size={11} /> 已配置
                      </span>
                    )}
                  </span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="input font-mono"
                    placeholder={hasKey ? '••••••••（留空则不修改）' : 'sk-...'}
                  />
                  <span className="mt-1 block text-[11px] text-faint">
                    {provider?.id === 'ollama'
                      ? '本地 Ollama 无需密钥，自动识别本地模型'
                      : '填写 API Key 后将自动获取该密钥支持的模型'}
                  </span>
                </label>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="label">模型</span>
                    <button
                      type="button"
                      onClick={() => setModelManual((v) => !v)}
                      className="cursor-pointer text-[11px] text-accent hover:underline"
                    >
                      {modelManual ? '用下拉选择' : '手动输入'}
                    </button>
                  </div>
                  {modelManual ? (
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="input font-mono"
                      placeholder="手动输入模型名"
                    />
                  ) : (
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="input cursor-pointer font-mono"
                    >
                      {modelOptions.map((m) => (
                        <option key={m} value={m} className="bg-panel text-ink">
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-faint">
                      {modelsMsg ||
                        (liveModels.length > 0
                          ? `${liveModels.length} 个可用模型`
                          : '填写 API Key 后自动获取该密钥支持的模型')}
                    </span>
                    <button
                      type="button"
                      onClick={fetchModels}
                      disabled={modelsLoading}
                      className="cursor-pointer text-[11px] text-soft hover:text-ink disabled:opacity-50"
                    >
                      {modelsLoading ? '获取中…' : '获取可用模型'}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger-dim px-3 py-2 text-[13px] text-red-300">
                    <AlertIcon size={14} className="shrink-0 text-danger" />
                    {error}
                  </div>
                )}
                {validateError && (
                  <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-amber-300">
                    <AlertIcon size={14} className="mt-0.5 shrink-0 text-warn" />
                    <span className="min-w-0 break-all">{validateError}</span>
                  </div>
                )}
                {saved && (
                  <div className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent-dim px-3 py-2 text-[13px] text-accent-bright">
                    <CheckCircleIcon size={14} className="shrink-0" />
                    {saved}
                  </div>
                )}

                {(liveModels.length > 0 || (hasKey && !apiKey.trim())) && (
                  <div className="flex justify-end pt-1">
                    <button type="submit" disabled={busy || modelsLoading} className="btn-primary">
                      {busy ? (
                        <>
                          <LoaderIcon size={14} className="animate-spin" /> 保存并验证中…
                        </>
                      ) : (
                        '保存设置'
                      )}
                    </button>
                  </div>
                )}
              </form>
            </div>
          )}

          {tab === 'account' && (
            <div className="space-y-4">
              <form onSubmit={handleUsername} className="space-y-2">
                <label className="block">
                  <span className="label">用户名</span>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <UserIcon
                        size={15}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                      />
                      <input
                        value={username}
                        onChange={(e) => setUsernameInput(e.target.value)}
                        className="input pl-9"
                        placeholder="admin"
                      />
                    </div>
                    <button type="submit" disabled={accountBusy} className="btn-primary flex-none">
                      保存用户名
                    </button>
                  </div>
                </label>
              </form>

              <form onSubmit={handlePassword} className="space-y-3">
                <label className="block">
                  <span className="label">当前密码</span>
                  <input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="input"
                    autoComplete="current-password"
                  />
                </label>
                <label className="block">
                  <span className="label">新密码（至少 6 位）</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input"
                    autoComplete="new-password"
                  />
                </label>
                <label className="block">
                  <span className="label">确认新密码</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input"
                    autoComplete="new-password"
                  />
                </label>
                <button type="submit" disabled={accountBusy} className="btn-ghost">
                  {accountBusy ? (
                    <>
                      <LoaderIcon size={14} className="animate-spin" /> 保存中…
                    </>
                  ) : (
                    '修改密码'
                  )}
                </button>
              </form>

              {accountError && (
                <div className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger-dim px-3 py-2 text-[13px] text-red-300">
                  <AlertIcon size={14} className="shrink-0 text-danger" />
                  {accountError}
                </div>
              )}
              {accountMsg && (
                <div className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent-dim px-3 py-2 text-[13px] text-accent-bright">
                  <CheckCircleIcon size={14} className="shrink-0" />
                  {accountMsg}
                </div>
              )}
            </div>
          )}

          {tab === 'backup' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button onClick={handleExport} disabled={backupBusy} className="btn-primary">
                  {backupBusy ? (
                    <>
                      <LoaderIcon size={14} className="animate-spin" /> 处理中…
                    </>
                  ) : (
                    <>
                      <DownloadIcon size={14} /> 导出备份
                    </>
                  )}
                </button>
                <button
                  onClick={() => importRef.current?.click()}
                  disabled={backupBusy}
                  className="btn-ghost"
                >
                  <UploadIcon size={14} /> 导入备份
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => handleImportFile(e.target.files?.[0])}
                />
              </div>

              {backupError && (
                <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-dim px-3 py-2 text-[13px] text-red-300">
                  <AlertIcon size={14} className="mt-0.5 shrink-0 text-danger" />
                  <span className="min-w-0 break-all">{backupError}</span>
                </div>
              )}
              {backupMsg && (
                <div className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent-dim px-3 py-2 text-[13px] text-accent-bright">
                  <CheckCircleIcon size={14} className="shrink-0" />
                  <span className="min-w-0 break-all">{backupMsg}</span>
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-faint">
                备份包含：常用命令、服务器配置（含凭据密文）、AI 相关设置。导入会
                <strong className="text-soft">覆盖</strong>当前全部服务器与 AI 设置（常用命令也会被替换）。
                凭据以服务端加密密文形式保存，请妥善保管备份文件。
              </p>
            </div>
          )}

          {tab === 'about' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel-2 text-faint">
                  <TerminalIcon size={15} />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-ink">关于 Mook</h2>
                  <p className="text-[11px] text-faint">v0.2.0 · AI 驱动的自托管 SSH 终端</p>
                </div>
              </div>
              <ul className="space-y-2.5">
                <li className="flex items-center gap-2.5 text-[13px] text-soft">
                  <ShieldIcon size={18} className="shrink-0 text-accent" /> 凭据加密存储
                </li>
                <li className="flex items-center gap-2.5 text-[13px] text-soft">
                  <GlobeIcon size={18} className="shrink-0 text-accent" /> 多厂商 AI 接入
                </li>
                <li className="flex items-center gap-2.5 text-[13px] text-soft">
                  <TerminalIcon size={18} className="shrink-0 text-accent" /> 多标签 SSH 终端
                </li>
                <li className="flex items-center gap-2.5 text-[13px] text-soft">
                  <ZapIcon size={18} className="shrink-0 text-accent" /> SFTP 文件管理
                </li>
                <li className="flex items-center gap-2.5 text-[13px] text-soft">
                  <KeyIcon size={18} className="shrink-0 text-accent" /> 备份与还原
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
