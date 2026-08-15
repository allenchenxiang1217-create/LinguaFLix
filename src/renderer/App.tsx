import { useEffect, useState } from 'react'
import { useAppStore } from './stores/appStore'
import { Dashboard } from './components/dashboard/Dashboard'
import { AppLayout } from './components/layout/AppLayout'
import { LogoMark, Wordmark } from './components/Logo'
import { useI18n } from './i18n/useI18n'
import { useSettingsStore } from './stores/settingsStore'

export default function App() {
  const { t } = useI18n()
  const appPhase = useAppStore((s) => s.appPhase)
  const setAppPhase = useAppStore((s) => s.setAppPhase)
  const [showSplash, setShowSplash] = useState(true)

  // 深浅色 / accent 主色 / 字体大小：设到 <html> 上，CSS 与根字号即时生效（含 Splash 阶段）。
  // 字号用根 font-size 缩放（所有文本用 rem，随 16px×scale 等比），不再用 zoom——
  // zoom 会把 100vw/vh 布局一起放大导致溢出。
  const themeMode = useSettingsStore((s) => s.themeMode)
  const theme = useSettingsStore((s) => s.theme)
  const uiScale = useSettingsStore((s) => s.uiScale)

  useEffect(() => { document.documentElement.dataset.theme = themeMode }, [themeMode])
  useEffect(() => { document.documentElement.dataset.accent = theme }, [theme])
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale * 16}px`
  }, [uiScale])

  useEffect(() => {
    // Splash animation: 800ms then transition
    const timer = setTimeout(() => {
      setShowSplash(false)
      setAppPhase('dashboard')
    }, 800)
    return () => clearTimeout(timer)
  }, [setAppPhase])

  // Splash screen
  if (showSplash) {
    return (
      <div className="h-screen w-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-5 animate-fade-in">
          <div
            className="w-16 h-16 rounded-[18px] grid place-items-center text-foreground shadow-lg shadow-black/30
                       bg-[radial-gradient(120%_120%_at_30%_0%,var(--card),transparent_60%),linear-gradient(160deg,var(--card),var(--popover))]"
          >
            <LogoMark size={38} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            <Wordmark />
          </h1>
          <p className="text-[0.6875rem] text-muted-foreground/60 animate-pulse-soft tracking-[0.06em]">
            {t('app.tagline')}
          </p>
        </div>
      </div>
    )
  }

  // Dashboard or Player
  if (appPhase === 'dashboard') {
    return <Dashboard />
  }

  return <AppLayout />
}
