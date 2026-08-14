import { ReactElement, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './store/auth'
import { useSettings, applyTheme, resolveTheme } from './store/settings'
import Login from './pages/Login'
import Workspace from './components/Workspace'
import { LoaderIcon, TerminalIcon } from './components/icons'

function FullScreenLoader() {
  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent-dim text-accent">
          <TerminalIcon size={24} />
        </span>
        <div className="flex items-center gap-2 text-sm text-soft">
          <LoaderIcon size={15} className="animate-spin" />
          正在加载…
        </div>
      </div>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return <FullScreenLoader />
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return children
}

export default function App() {
  const init = useAuth((s) => s.init)
  useEffect(() => {
    init()
  }, [init])

  const theme = useSettings((s) => s.theme)
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => {
      document.documentElement.dataset.theme = resolveTheme(theme)
      document.documentElement.style.colorScheme = resolveTheme(theme)
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<RequireAuth><Workspace /></RequireAuth>} />
    </Routes>
  )
}