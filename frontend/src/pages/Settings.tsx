import type { FormEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Modal from '../components/Modal'
import { api, type BackupData, type CustomProviderSetting } from '../api/client'
import { useAuth } from '../store/auth'
import { useAi } from '../store/ai'
import { useCommands } from '../store/commands'
import { useServers } from '../store/servers'
import { useSettings, type ThemeMode } from '../store/settings'
import { BACKGROUNDS, CYCLE_ORDER, bgStyle } from '../terminal/backgrounds'
import { friendlyModelName } from '../utils/command'
import { useI18n } from '../utils/i18n'
import { isDragSelectingInside } from '../utils/selection'
import { AI_PROVIDERS, providerByBaseUrl } from '../utils/aiProviders'
import {
  AlertIcon,
  CheckCircleIcon,
  DatabaseIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  GithubIcon,
  KeyIcon,
  LayersIcon,
  LoaderIcon,
  SettingsIcon,
  ShieldIcon,
  SparklesIcon,
  TerminalIcon,
  UploadIcon,
  UserIcon,
  XCircleIcon,
} from '../components/icons'

export type SettingsTab = 'general' | 'ai' | 'data' | 'about'

function unique(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean)))
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

interface Props {
  open: boolean
  initialTab?: SettingsTab
  onClose: () => void
}

export default function SettingsModal({ open, initialTab = 'general', onClose }: Props) {
  const t = useI18n()
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [model, setModel] = useState('deepseek-chat')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [validated, setValidated] = useState(false)
  const [providerId, setProviderId] = useState('deepseek')
  const [customName, setCustomName] = useState('')
  const [liveModels, setLiveModels] = useState<string[]>([])
  const [customProviders, setCustomProviders] = useState<CustomProviderSetting[]>([])
  const [providerKeys, setProviderKeys] = useState<Record<string, boolean>>({})
  const [modelManual, setModelManual] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsMsg, setModelsMsg] = useState('')
  const [modelsOk, setModelsOk] = useState(false)
  const [busy, setBusy] = useState(false)

  // 账户
  const user = useAuth((s) => s.user)
  const setUsername = useAuth((s) => s.setUsername)
  const [username, setUsernameInput] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accountBusy, setAccountBusy] = useState(false)
  const [pwdVerified, setPwdVerified] = useState(false)
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [showOldPwd, setShowOldPwd] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [showConfirmPwd, setShowConfirmPwd] = useState(false)
  // 修改登录密码弹窗
  const [pwdChangeOpen, setPwdChangeOpen] = useState(false)
  const pwdBoxRef = useRef<HTMLDivElement>(null)

  // 悬浮提示（2 秒自动消失），替代内联成功/错误提示
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ type, msg })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2000)
  }

  // 备份
  const importRef = useRef<HTMLInputElement>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  // 备份密码弹窗：export=导出，import=导入
  const [pwdModal, setPwdModal] = useState<'export' | 'import' | null>(null)
  const [pwd, setPwd] = useState('')
  const [pwdConfirm, setPwdConfirm] = useState('')
  const [pwdBusy, setPwdBusy] = useState(false)
  const pwdModalRef = useRef<HTMLDivElement>(null)
  const [pendingImportData, setPendingImportData] = useState<string | null>(null)

  const replaceCommands = useCommands((s) => s.replace)
  const loadServers = useServers((s) => s.load)
  const refreshAi = useAi((s) => s.refresh)

  // 通用设置
  const theme = useSettings((s) => s.theme)
  const english = useSettings((s) => s.english)
  const setTheme = useSettings((s) => s.setTheme)
  const setEnglish = useSettings((s) => s.setEnglish)
  const termBg = useSettings((s) => s.termBg)
  const termBgImage = useSettings((s) => s.termBgImage)
  const setTermBg = useSettings((s) => s.setTermBg)
  const setTermBgImage = useSettings((s) => s.setTermBgImage)
  const resetTermBg = useSettings((s) => s.resetTermBg)
  const bgUploadRef = useRef<HTMLInputElement>(null)

  const provider = useMemo(() => AI_PROVIDERS.find((p) => p.id === providerId), [providerId])

  // 切换厂商（baseUrl 变化）时，按该厂商已存的密钥状态更新「已配置」标识
  useEffect(() => {
    if (!open) return
    setHasKey(providerKeys[normalizeBaseUrl(baseUrl)] ?? false)
  }, [baseUrl, providerKeys, open])

  // 外部指定初始子菜单时同步
  useEffect(() => {
    if (open) {
      setTab(initialTab)
      setPwdVerified(false)
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }, [open, initialTab])

  useEffect(() => {
    if (!open) return
    api
      .getAiSettings()
      .then((s) => {
        setBaseUrl(s.base_url)
        setModel(s.model)
        setHasKey(s.has_api_key)
        setProviderKeys(s.provider_keys ?? {})
        setValidated(s.validated)
        setCustomProviders(s.custom_providers ?? [])
        const p = providerByBaseUrl(s.base_url)
        const saved = (s.custom_providers ?? []).find((c) => c.base_url.trim().replace(/\/+$/, '') === s.base_url.trim().replace(/\/+$/, ''))
        if (p) {
          setProviderId(p.id)
          setModelManual(false)
        } else if (saved) {
          setCustomName(saved.name)
          setProviderId(`custom:${saved.name}`)
          setModelManual(true)
        } else {
          setProviderId('custom')
          setModelManual(true)
        }
      })
      .catch((err) => showToast(err instanceof Error ? err.message : '读取设置失败', 'err'))
  }, [open])

  useEffect(() => {
    setUsernameInput(user ?? '')
  }, [user])

  const providerOptions = useMemo(() => {
    const builtin = AI_PROVIDERS.map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl, models: p.models }))
    const saved = customProviders.map((c) => ({
      id: `custom:${c.name}`,
      name: `${c.name}`,
      baseUrl: c.base_url,
      models: c.model ? [c.model] : [],
    }))
    return [...builtin, ...saved]
  }, [customProviders])

  function selectProvider(id: string) {
    modelsSeq.current++
    setProviderId(id)
    setLiveModels([])
    setModelsMsg('')
    setModelsOk(false)
    setModelsLoading(false)
    if (id.startsWith('custom:')) {
      const c = customProviders.find((x) => x.name === id.slice('custom:'.length))
      if (c) {
        setCustomName(c.name)
        setBaseUrl(c.base_url)
        if (c.model) setModel(c.model)
      }
      setModelManual(true)
      return
    }
    const p = AI_PROVIDERS.find((x) => x.id === id)
    if (p) {
      setBaseUrl(p.baseUrl)
      setCustomName('')
      setModelManual(id === 'custom')
    }
  }

  const modelsSeq = useRef(0)

  async function fetchModels() {
    const seq = ++modelsSeq.current
    setModelsLoading(true)
    setModelsMsg('')
    setModelsOk(false)
    try {
      const res = await api.listModels(baseUrl.trim(), apiKey.trim())
      if (seq !== modelsSeq.current) return
      if (res.models.length === 0) {
        setLiveModels([])
        setModelsOk(false)
        setModelsMsg('接口未返回可用模型，请检查 API Key 或接口地址')
      } else {
        setLiveModels(res.models)
        setModelsOk(true)
        setModelManual(false)
        setModelsMsg(`获取到 ${res.models.length} 个可用模型`)
      }
    } catch (err) {
      if (seq !== modelsSeq.current) return
      setLiveModels([])
      setModelsOk(false)
      if (err instanceof DOMException && err.name === 'AbortError') {
        setModelsMsg('获取模型超时，请检查接口地址与网络')
        return
      }
      const raw = err instanceof Error ? err.message.replace(/^获取模型列表失败：/, '') : '获取模型列表失败'
      setModelsMsg(raw.replace(/\*\*\*\*[A-Za-z0-9_-]*\*\*\*\*/g, '（推测为密钥无效）') || '获取模型列表失败')
    } finally {
      if (seq === modelsSeq.current) setModelsLoading(false)
    }
  }

  // 输入 API Key（或切换厂商/接口地址，本地 Ollama 无需密钥，或该厂商已存密钥）后自动拉取模型
  useEffect(() => {
    if (!baseUrl.trim()) return
    const hasStoredKey = providerKeys[normalizeBaseUrl(baseUrl)] ?? false
    if (!apiKey.trim() && !hasStoredKey && provider?.id !== 'ollama') return
    const t = setTimeout(() => {
      fetchModels()
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, baseUrl, providerId, providerKeys])

  const modelOptions = useMemo(() => unique([...liveModels, model]), [liveModels, model])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const providerIdToSave = providerId.startsWith('custom:') ? 'custom' : providerId
      const customNameToSave = providerIdToSave === 'custom' ? customName.trim() : ''
      const res = await api.saveAiSettings({
        base_url: baseUrl.trim(),
        model: model.trim(),
        api_key: apiKey.trim(),
        provider_id: providerIdToSave,
        custom_name: customNameToSave,
      })
      setHasKey(Boolean(apiKey.trim()) || hasKey)
      setApiKey('')
      setValidated(res.validated)
      if (res.validated) {
        showToast('设置已保存，密钥验证通过')
        if (apiKey.trim()) {
          setProviderKeys((prev) => ({ ...prev, [normalizeBaseUrl(baseUrl)]: true }))
        }
        if (customNameToSave) {
          setCustomName(customNameToSave)
          const updated = await api.getAiSettings()
          setCustomProviders(updated.custom_providers ?? [])
          setProviderKeys(updated.provider_keys ?? {})
          setProviderId(`custom:${customNameToSave}`)
        }
      } else {
        const noKey = !hasKey && !apiKey.trim()
        showToast(
          noKey
            ? '尚未配置 API Key，请填写后保存以启用 AI'
            : res.error || '密钥未通过验证，请检查 API Key / 接口地址 / 模型',
          'err',
        )
      }
      await refreshAi()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function handleUsername(e: FormEvent) {
    e.preventDefault()
    const name = username.trim()
    if (!name) {
      showToast('用户名不能为空', 'err')
      return
    }
    setAccountBusy(true)
    try {
      const res = await api.changeUsername(name)
      setUsername(res.username)
      showToast('用户名已更新，下次登录请使用新用户名')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '修改失败', 'err')
    } finally {
      setAccountBusy(false)
    }
  }

  async function handlePassword(e: FormEvent) {
    e.preventDefault()
    if (newPassword.length < 6) {
      showToast('新密码至少 6 位', 'err')
      return
    }
    if (newPassword !== confirmPassword) {
      showToast('两次输入的新密码不一致', 'err')
      return
    }
    setAccountBusy(true)
    try {
      await api.changePassword(oldPassword, newPassword)
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showToast('密码已更新')
      setPwdChangeOpen(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '修改失败', 'err')
    } finally {
      setAccountBusy(false)
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault()
    if (!oldPassword) {
      showToast('请输入当前密码', 'err')
      return
    }
    setVerifyBusy(true)
    try {
      await api.verifyPassword(oldPassword)
      setPwdVerified(true)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '当前密码错误', 'err')
    } finally {
      setVerifyBusy(false)
    }
  }

  async function handleExport() {
    setPwd('')
    setPwdConfirm('')
    setPwdModal('export')
  }

  async function confirmExport() {
    if (pwd.length < 6) {
      showToast('备份密码至少 6 位', 'err')
      return
    }
    if (pwd !== pwdConfirm) {
      showToast('两次输入的密码不一致', 'err')
      return
    }
    setPwdBusy(true)
    try {
      const res = await api.exportBackup(pwd)
      const blob = new Blob([JSON.stringify(res)], { type: 'application/json' })
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
      setPwdModal(null)
      showToast('备份已导出（已用密码加密，请妥善保管密码）')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导出失败', 'err')
    } finally {
      setPwdBusy(false)
    }
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return
    setBackupBusy(true)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as BackupData | { data: string }
      // 加密备份：data 为密文
      if (parsed && typeof (parsed as { data?: string }).data === 'string' && (parsed as { data: string }).data) {
        setPendingImportData((parsed as { data: string }).data)
        setPwd('')
        setPwdModal('import')
        return
      }
      const data = parsed as BackupData
      if (!data || data.version !== 1 || !Array.isArray(data.servers)) {
        throw new Error('不是有效的 Mook 备份文件')
      }
      await restoreLegacy(data)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入失败', 'err')
    } finally {
      setBackupBusy(false)
      if (importRef.current) importRef.current.value = ''
    }
  }

  async function confirmImport() {
    if (!pendingImportData) return
    if (pwd.length < 6) {
      showToast('请输入备份密码（至少 6 位）', 'err')
      return
    }
    setPwdBusy(true)
    try {
      const res = await api.restoreBackup({ password: pwd, data: pendingImportData })
      await Promise.all([loadServers(), refreshAi()])
      setPwdModal(null)
      setPendingImportData(null)
      showToast(`还原成功：${res.servers_restored} 台服务器、AI 设置与常用命令已恢复`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '还原失败', 'err')
    } finally {
      setPwdBusy(false)
      if (importRef.current) importRef.current.value = ''
    }
  }

  async function restoreLegacy(data: BackupData) {
    const res = await api.restoreBackup({
      version: data.version,
      servers: data.servers,
      settings: data.settings ?? {},
    })
    if (Array.isArray(data.common_commands)) {
      const raw = data.common_commands as unknown as Array<Record<string, unknown>>
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
    showToast(
      `还原成功：${res.servers_restored} 台服务器、AI 设置${cmdCount > 0 ? `、${cmdCount} 条常用命令` : ''}已恢复`,
    )
  }

  const menu: { key: SettingsTab; label: string; icon: typeof SparklesIcon }[] = [
    { key: 'general', label: t('general'), icon: SettingsIcon },
    { key: 'ai', label: t('ai'), icon: SparklesIcon },
    { key: 'data', label: t('data'), icon: DatabaseIcon },
    { key: 'about', label: t('about'), icon: TerminalIcon },
  ]

  return (
    <>
    <Modal
      open={open}
      title="设置"
      onClose={onClose}
      width="lg"
      height="h-[600px]"
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
                title={item.label}
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
                    {providerOptions.map((p) => (
                      <option key={p.id} value={p.id} className="bg-panel text-ink">
                        {p.name}
                        {p.id.startsWith('custom:') ? '（自定义）' : ''}
                      </option>
                    ))}
                  </select>
                  {(providerId === 'custom' || providerId.startsWith('custom:')) && (
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
                </label>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="label">模型</span>
                    <button
                      type="button"
                      onClick={fetchModels}
                      disabled={modelsLoading}
                      title="从当前 AI 服务获取可用模型列表"
                      className="cursor-pointer text-[11px] font-medium text-accent-bright hover:text-accent disabled:opacity-50"
                    >
                      {modelsLoading ? '获取中…' : '获取可用模型'}
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
                  <div className="mt-1.5 flex items-center justify-end gap-2">
                    <span
                      className={`text-[11px] ${
                        modelsLoading
                          ? 'text-faint'
                          : modelsMsg
                            ? modelsOk
                              ? 'text-accent-bright'
                              : 'text-danger'
                            : 'text-faint'
                      }`}
                    >
                      {modelsLoading
                        ? '获取模型列表中…'
                        : modelsMsg ||
                          (liveModels.length > 0
                            ? `${liveModels.length} 个可用模型`
                            : '填写 API Key 后自动获取该密钥支持的模型')}
                    </span>
                  </div>
                </div>

                {(liveModels.length > 0 || (hasKey && !apiKey.trim())) && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={busy || modelsLoading}
                      className="btn-primary"
                      title="保存 AI 设置并验证连接"
                    >
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

          {tab === 'general' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-line bg-panel-2 p-3.5">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                  <ShieldIcon size={14} className="text-accent" /> 账户安全
                </p>
                <div className="mt-3 space-y-3">
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
                    <button
                      type="submit"
                      disabled={accountBusy}
                      className="btn-primary flex-none"
                      title="保存新的用户名"
                    >
                      保存用户名
                    </button>
                  </div>
                </label>
              </form>
                <button
                  type="button"
                  onClick={() => {
                    setPwdChangeOpen(true)
                    setPwdVerified(false)
                    setOldPassword('')
                    setNewPassword('')
                    setConfirmPassword('')
                  }}
                  className="btn-danger w-full flex-none"
                  title="通过弹窗验证当前密码后设置新密码"
                >
                  修改登录密码
                </button>
                </div>

              </div>

              {/* 外观 */}
              <div className="rounded-lg border border-line bg-panel-2 p-3.5">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                  <SettingsIcon size={14} className="text-accent" /> {t('appearance')}
                </p>

                <div className="mt-3">
                  <span className="label">{t('theme')}</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { value: 'dark', label: t('themeDark') },
                        { value: 'light', label: t('themeLight') },
                        { value: 'system', label: t('themeSystem') },
                      ] as { value: ThemeMode; label: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setTheme(opt.value)}
                        title={`切换到${opt.label}主题`}
                        className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-1.5 text-[13px] transition-colors duration-150 ${
                          theme === opt.value
                            ? 'border-accent/40 bg-accent-dim text-accent-bright'
                            : 'border-line bg-canvas/40 text-soft hover:border-line-strong hover:text-ink'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3.5">
                  <span className="label">{t('language')}</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEnglish(false)}
                      title="切换为简体中文界面"
                      className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[13px] transition-colors duration-150 ${
                        !english
                          ? 'border-accent/40 bg-accent-dim text-accent-bright'
                          : 'border-line bg-canvas/40 text-soft hover:border-line-strong hover:text-ink'
                      }`}
                    >
                      简体中文
                    </button>
                    <button
                      type="button"
                      onClick={() => setEnglish(true)}
                      title="Switch to English"
                      className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[13px] transition-colors duration-150 ${
                        english
                          ? 'border-accent/40 bg-accent-dim text-accent-bright'
                          : 'border-line bg-canvas/40 text-soft hover:border-line-strong hover:text-ink'
                      }`}
                    >
                      English
                    </button>
                  </div>
                </div>
              </div>

              {/* 终端背景 */}
              <div className="rounded-lg border border-line bg-panel-2 p-3.5">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                  <LayersIcon size={14} className="text-accent" /> 终端背景
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {CYCLE_ORDER.map((id) => {
                    const p = BACKGROUNDS[id]
                    const active = termBg === id
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setTermBg(id)}
                        title={`使用「${p.name}」作为终端背景`}
                        className={`cursor-pointer rounded-lg border p-1.5 transition-colors duration-150 ${
                          active
                            ? 'border-accent/50 ring-1 ring-accent/30'
                            : 'border-line hover:border-line-strong'
                        }`}
                      >
                        <span
                          className="block h-14 w-full rounded-md border border-line"
                          style={bgStyle(id)}
                        />
                        <span className="mt-1.5 block truncate text-center text-[11px] text-soft">
                          {p.name}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => bgUploadRef.current?.click()}
                    title="上传自定义终端背景图片"
                    className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors duration-150 ${
                      termBg === 'image'
                        ? 'border-accent/50 bg-accent-dim text-accent-bright'
                        : 'border-line bg-canvas/40 text-soft hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    <UploadIcon size={13} />
                    {termBgImage ? '更换背景图片' : '上传背景图片'}
                  </button>
                  {termBgImage && (
                    <button
                      type="button"
                      onClick={resetTermBg}
                      title="恢复默认终端背景"
                      className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-canvas/40 px-3 py-1.5 text-xs text-soft transition-colors duration-150 hover:border-danger/40 hover:text-danger"
                    >
                      恢复默认
                    </button>
                  )}
                  <span className="ml-auto text-[11px] text-faint">支持 JPG / PNG / WebP</span>
                </div>
                <input
                  ref={bgUploadRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      const reader = new FileReader()
                      reader.onload = () => {
                        if (typeof reader.result === 'string') setTermBgImage(reader.result)
                      }
                      reader.readAsDataURL(file)
                    }
                    e.target.value = ''
                  }}
/>
              </div>
            </div>
          )}

          {tab === 'data' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleExport}
                  disabled={backupBusy}
                  className="btn-primary px-5 py-2.5 text-sm"
                  title="导出数据备份文件（密码加密，服务器、AI 设置与常用命令）"
                >
                  {backupBusy ? (
                    <>
                      <LoaderIcon size={16} className="animate-spin" /> 处理中…
                    </>
                  ) : (
                    <>
                      <UploadIcon size={16} /> 导出数据
                    </>
                  )}
                </button>
                <button
                  onClick={() => importRef.current?.click()}
                  disabled={backupBusy}
                  className="btn-ghost px-5 py-2.5 text-sm"
                  title="从备份文件导入数据"
                >
                  <DownloadIcon size={16} /> 导入数据
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => handleImportFile(e.target.files?.[0])}
                />
              </div>

              <div className="rounded-lg border border-line bg-panel-2 p-3.5">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                  <DatabaseIcon size={14} className="text-accent" /> 包含内容
                </p>
                <ul className="mt-3 space-y-1.5 text-[13px] text-soft">
                  <li>· 常用命令</li>
                  <li>· 服务器配置（含凭据密文）</li>
                  <li>· AI 相关设置（各厂商密钥独立保存）</li>
                </ul>
                <p className="mt-2.5 text-[12px] text-faint">
                  导出会使用你设置的<strong className="text-soft">备份密码</strong>对整份文件加密，导入时需输入同一密码还原。
                  导入会<strong className="text-soft">覆盖</strong>当前全部服务器与 AI 设置（常用命令也会被替换）。
                  请妥善保管备份密码，忘记密码将无法解密。
                </p>
              </div>
            </div>
          )}

          {tab === 'about' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel-2 text-accent">
                    <TerminalIcon size={17} />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Mook</h2>
                    <p className="text-[11px] text-faint">AI 驱动的自托管 SSH 终端</p>
                  </div>
                </div>
                <a
                  href="https://github.com/NikoYomi/mook"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Mook 开源项目地址"
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-soft transition-colors duration-150 hover:text-ink"
                >
                  <GithubIcon size={15} />
                  v0.2.7
                </a>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                <div className="flex items-center gap-2.5 text-[12px] text-soft">
                  <TerminalIcon size={15} className="shrink-0 text-accent" /> 支持多标签 SSH 终端
                </div>
                <div className="flex items-center gap-2.5 text-[12px] text-soft">
                  <SparklesIcon size={15} className="shrink-0 text-accent" /> 支持常用指令
                </div>
                <div className="flex items-center gap-2.5 text-[12px] text-soft">
                  <KeyIcon size={15} className="shrink-0 text-accent" /> 支持自定义 AI 助手
                </div>
                <div className="flex items-center gap-2.5 text-[12px] text-soft">
                  <ShieldIcon size={15} className="shrink-0 text-accent" /> 支持备份与还原
                </div>
              </div>

              <div className="border-t border-line pt-3">
                <p className="text-center text-xs font-medium text-ink">支持作者</p>
                <p className="mt-0.5 text-center text-[11px] text-faint">
                  如果Mook对你有帮助，欢迎投喂作者呀！
                </p>
                <div className="mt-4 grid grid-cols-2 gap-6">
                  <div className="flex flex-col items-center gap-1.5">
                    <img
                      src="/wechat-qr.png"
                      alt="微信赞赏码"
                      className="w-40 rounded-md border border-line bg-canvas/40 p-2"
                    />
                    <p className="text-[11px] text-soft">微信</p>
                  </div>
                  <div className="flex flex-col items-center gap-1.5">
                    <img
                      src="/alipay-qr.png"
                      alt="支付宝收款码"
                      className="w-40 rounded-md border border-line bg-canvas/40 p-2"
                    />
                    <p className="text-[11px] text-soft">支付宝</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 备份密码弹窗 */}
      {pwdModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target !== e.currentTarget || pwdBusy) return
            // 框选拖拽保护：输入框内选中文字拖到弹窗外松开时不关闭
            if (isDragSelectingInside(pwdModalRef.current)) return
            setPwdModal(null)
          }}
          role="dialog"
          aria-modal="true"
          aria-label={pwdModal === 'export' ? '设置备份密码' : '输入备份密码'}
        >
          <div
            ref={pwdModalRef}
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-line px-5 py-4">
              <h3 className="text-[15px] font-semibold text-ink">
                {pwdModal === 'export' ? '设置备份密码' : '输入备份密码'}
              </h3>
              <p className="mt-0.5 text-xs text-soft">
                {pwdModal === 'export'
                  ? '导出文件将使用该密码加密，请妥善保管'
                  : '该备份文件已加密，请输入导出时设置的密码'}
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (pwdModal === 'export') confirmExport()
                else confirmImport()
              }}
              className="space-y-3 px-5 py-4"
            >
              <label className="block">
                <span className="label">{pwdModal === 'export' ? '备份密码（至少 6 位）' : '备份密码'}</span>
                <input
                  type="password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  className="input font-mono"
                  autoComplete="new-password"
                  autoFocus
                />
              </label>
              {pwdModal === 'export' && (
                <label className="block">
                  <span className="label">确认密码</span>
                  <input
                    type="password"
                    value={pwdConfirm}
                    onChange={(e) => setPwdConfirm(e.target.value)}
                    className="input font-mono"
                    autoComplete="new-password"
                  />
                </label>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setPwdModal(null)} disabled={pwdBusy} className="btn-ghost">
                  取消
                </button>
                <button type="submit" disabled={pwdBusy} className="btn-primary">
                  {pwdBusy ? (
                    <>
                      <LoaderIcon size={14} className="animate-spin" /> 处理中…
                    </>
                  ) : pwdModal === 'export' ? (
                    '导出并加密'
                  ) : (
                    '解密并还原'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 修改登录密码弹窗（单层，portal 到 body，避免嵌套 modal） */}
      {pwdChangeOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target !== e.currentTarget || verifyBusy || accountBusy) return
              // 框选拖拽保护：输入框内选中文字拖到弹窗外松开时不关闭
              if (isDragSelectingInside(pwdBoxRef.current)) return
              setPwdChangeOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="修改登录密码"
          >
            <div
              ref={pwdBoxRef}
              className="w-full max-w-sm overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/50"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pb-2 pt-6">
                <h3 className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-ink">
                  <ShieldIcon size={15} className="shrink-0 text-accent" /> 修改登录密码
                </h3>
                <p className="mt-1 text-sm text-soft">
                  {pwdVerified ? '已验证身份，请设置新密码。' : '为了保护账户安全，请验证当前密码。'}
                </p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (pwdVerified) handlePassword(e)
                  else handleVerify(e)
                }}
                className="space-y-4 px-6 pt-4"
              >
                {!pwdVerified ? (
                  <label className="block">
                    <span className="label">当前密码</span>
                    <div className="relative">
                      <input
                        type={showOldPwd ? 'text' : 'password'}
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        className="input pr-10"
                        autoComplete="current-password"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowOldPwd((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-faint transition-colors duration-150 hover:text-ink"
                        title={showOldPwd ? '隐藏密码' : '显示密码'}
                        aria-label={showOldPwd ? '隐藏密码' : '显示密码'}
                      >
                        {showOldPwd ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                      </button>
                    </div>
                  </label>
                ) : (
                  <>
                    <label className="block">
                      <span className="label">新密码（至少 6 位）</span>
                      <div className="relative">
                        <input
                          type={showNewPwd ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="input pr-10"
                          autoComplete="new-password"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPwd((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-faint transition-colors duration-150 hover:text-ink"
                          title={showNewPwd ? '隐藏密码' : '显示密码'}
                          aria-label={showNewPwd ? '隐藏密码' : '显示密码'}
                        >
                          {showNewPwd ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                        </button>
                      </div>
                    </label>
                    <label className="block">
                      <span className="label">确认新密码</span>
                      <div className="relative">
                        <input
                          type={showConfirmPwd ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="input pr-10"
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPwd((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-faint transition-colors duration-150 hover:text-ink"
                          title={showConfirmPwd ? '隐藏密码' : '显示密码'}
                          aria-label={showConfirmPwd ? '隐藏密码' : '显示密码'}
                        >
                          {showConfirmPwd ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                        </button>
                      </div>
                    </label>
                  </>
                )}
                <div className="flex justify-end gap-2 border-t border-line pb-6 pt-4">
                  <button
                    type="button"
                    onClick={() => setPwdChangeOpen(false)}
                    disabled={verifyBusy || accountBusy}
                    className="btn-ghost"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={verifyBusy || accountBusy}
                    className="btn-primary"
                  >
                    {verifyBusy || accountBusy ? (
                      <>
                        <LoaderIcon size={14} className="animate-spin" /> 处理中…
                      </>
                    ) : (
                      '确认修改'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </Modal>

      {/* 悬浮提示（2 秒自动消失） */}
      {toast &&
        createPortal(
          <div className="pointer-events-none fixed left-1/2 top-4 z-[80] -translate-x-1/2">
            <div
              className={`flex max-w-md items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] shadow-xl shadow-black/40 backdrop-blur ${
                toast.type === 'ok'
                  ? 'border-accent/25 bg-panel/95 text-ink'
                  : 'border-danger/30 bg-danger-dim/95 text-danger'
              }`}
            >
              {toast.type === 'ok' ? (
                <CheckCircleIcon size={15} className="shrink-0 text-accent" />
              ) : (
                <AlertIcon size={15} className="shrink-0 text-danger" />
              )}
              <span className="min-w-0 break-all">{toast.msg}</span>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
