import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type FileEntry } from '../api/client'
import Modal from './Modal'
import {
  AlertIcon,
  DownloadIcon,
  FileIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HomeIcon,
  LoaderIcon,
  RefreshIcon,
  ServerIcon,
  TrashIcon,
  UploadIcon,
} from './icons'

function formatSize(n: number): string {
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

export default function FileManager({ serverId }: { serverId: number | null }) {
  const [dir, setDir] = useState('/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(
    async (d: string) => {
      if (serverId == null) return
      setLoading(true)
      setError('')
      try {
        const res = await api.listFiles(serverId, d)
        setEntries(res.entries)
        setDir(res.path)
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取目录失败')
      } finally {
        setLoading(false)
      }
    },
    [serverId],
  )

  useEffect(() => {
    if (serverId != null) load('/')
    else {
      setEntries([])
      setDir('/')
    }
  }, [serverId, load])

  if (serverId == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel-2 text-faint">
          <ServerIcon size={18} />
        </span>
        <p className="text-xs text-faint">打开一个终端后，可在此上传 / 下载 / 管理服务器文件</p>
      </div>
    )
  }

  const sid = serverId
  const parentDir = dir === '/' ? '/' : dir.slice(0, dir.lastIndexOf('/')) || '/'
  const folders = entries.filter((e) => e.is_dir)
  const files = entries.filter((e) => !e.is_dir)

  function enter(e: FileEntry) {
    if (e.is_dir) load(e.path)
  }

  function download(e: FileEntry) {
    const a = document.createElement('a')
    a.href = api.downloadUrl(sid, e.path)
    a.download = e.name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function remove(e: FileEntry) {
    const tip = e.is_dir
      ? `确定删除目录「${e.name}」吗？目录及其内容将被递归删除！`
      : `确定删除文件「${e.name}」吗？`
    if (!window.confirm(tip)) return
    try {
      await api.remove(sid, e.path)
      await load(dir)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  async function onPickFile(f: File | undefined) {
    if (!f) return
    setUploading(true)
    setError('')
    try {
      await api.uploadFile(sid, dir, f)
      await load(dir)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-2">
        <button className="icon-btn h-7 w-7" onClick={() => load('/')} title="根目录" aria-label="根目录">
          <HomeIcon size={14} />
        </button>
        <button
          className="icon-btn h-7 w-7"
          onClick={() => load(parentDir)}
          disabled={dir === '/'}
          title="上一级"
          aria-label="上一级"
        >
          <FolderOpenIcon size={14} className="rotate-180" />
        </button>
        <button className="icon-btn h-7 w-7" onClick={() => load(dir)} title="刷新" aria-label="刷新">
          <RefreshIcon size={14} />
        </button>
        <button
          className="icon-btn h-7 w-7"
          onClick={() => setMkdirOpen(true)}
          title="新建目录"
          aria-label="新建目录"
        >
          <FolderPlusIcon size={14} />
        </button>
        <button
          className="icon-btn h-7 w-7"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="上传文件"
          aria-label="上传文件"
        >
          {uploading ? <LoaderIcon size={14} className="animate-spin" /> : <UploadIcon size={14} />}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0])}
        />
      </div>

      {/* 当前路径 */}
      <div className="truncate border-b border-line px-3 py-1.5 font-mono text-[11px] text-faint" title={dir}>
        {dir}
      </div>

      {error && (
        <div className="flex items-start gap-1.5 border-b border-danger/20 bg-danger-dim px-3 py-1.5 text-[11px] text-danger">
          <AlertIcon size={12} className="mt-0.5 shrink-0 text-danger" />
          <span className="min-w-0 break-all">{error}</span>
        </div>
      )}

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-faint">
            <LoaderIcon size={14} className="animate-spin text-accent" />
            读取中…
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel-2 text-faint">
              <FolderOpenIcon size={18} />
            </span>
            <p className="text-xs text-faint">目录为空</p>
          </div>
        ) : (
          <div className="p-1.5">
            {[...folders, ...files].map((e) => (
              <div
                key={e.path}
                className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-raise ${
                  e.is_dir ? 'cursor-pointer' : ''
                }`}
                onClick={() => e.is_dir && enter(e)}
                onDoubleClick={() => !e.is_dir && download(e)}
              >
                {e.is_dir ? (
                  <FolderOpenIcon size={15} className="shrink-0 text-info" />
                ) : (
                  <FileIcon size={15} className="shrink-0 text-faint" />
                )}
                <span
                  className="min-w-0 flex-1 truncate text-xs text-soft"
                  title={e.name}
                >
                  {e.name}
                </span>
                {!e.is_dir && (
                  <span className="hidden shrink-0 font-mono text-[10px] text-faint sm:inline">
                    {formatSize(e.size)}
                  </span>
                )}
                <span className="hidden shrink-0 font-mono text-[10px] text-faint md:inline">
                  {e.mod_time}
                </span>
                <div className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:duration-150 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  {!e.is_dir && (
                    <button
                      className="icon-btn h-6 w-6 hover:text-accent"
                      title="下载"
                      aria-label={`下载 ${e.name}`}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        download(e)
                      }}
                    >
                      <DownloadIcon size={13} />
                    </button>
                  )}
                  <button
                    className="icon-btn h-6 w-6 hover:text-danger"
                    title="删除"
                    aria-label={`删除 ${e.name}`}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      remove(e)
                    }}
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MkdirModal
        open={mkdirOpen}
        currentDir={dir}
        onClose={() => setMkdirOpen(false)}
        onCreate={async (name) => {
          try {
            await api.mkdir(sid, dir === '/' ? `/${name}` : `${dir}/${name}`)
            await load(dir)
            setMkdirOpen(false)
          } catch (err) {
            setError(err instanceof Error ? err.message : '创建目录失败')
          }
        }}
      />
    </div>
  )
}

function MkdirModal({
  open,
  currentDir,
  onClose,
  onCreate,
}: {
  open: boolean
  currentDir: string
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setError('')
    }
  }, [open])

  async function submit() {
    const n = name.trim()
    if (!n) {
      setError('请输入目录名称')
      return
    }
    setBusy(true)
    try {
      await onCreate(n)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="新建目录" description={`当前目录：${currentDir}`} onClose={onClose}>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          className="input font-mono"
          placeholder="目录名称"
          autoFocus
        />
        {error && (
          <div className="rounded-lg border border-danger/25 bg-danger-dim px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
