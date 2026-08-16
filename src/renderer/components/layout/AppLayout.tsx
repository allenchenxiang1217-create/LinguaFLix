import { useCallback, useEffect, useRef, useState } from 'react'
import { VideoPanel } from './VideoPanel'
import { NotesPanel } from '../sidebar/NotesPanel'
import { Toast } from '../Toast'
import { Notebook, BookOpen, X } from 'lucide-react'
import { useNoteStore } from '../../stores/noteStore'
import { usePlayerStore } from '../../stores/playerStore'
import { useAppStore } from '../../stores/appStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { SettingsPage } from '../dashboard/SettingsPage'
import { useI18n } from '../../i18n/useI18n'

export function AppLayout() {
  const { t } = useI18n()
  // #2 视频内进设置：弹层开关。打开时暂停播放器快捷键，避免设置里误触。
  const [settingsOpen, setSettingsOpen] = useState(false)
  useKeyboardShortcuts(settingsOpen)

  const sidebarMode = useNoteStore((s) => s.sidebarMode)
  const sidebarHovered = useNoteStore((s) => s.sidebarHovered)
  const sidebarTab = useNoteStore((s) => s.sidebarTab)
  const setSidebarMode = useNoteStore((s) => s.setSidebarMode)
  const setSidebarHovered = useNoteStore((s) => s.setSidebarHovered)
  const setSidebarTab = useNoteStore((s) => s.setSidebarTab)
  const activeNoteId = useNoteStore((s) => s.activeNoteId)
  const isFullscreen = usePlayerStore((s) => s.isFullscreen)
  const setAppPhase = useAppStore((s) => s.setAppPhase)
  const narrowRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number>(0)

  // Fullscreen → hidden sidebar
  useEffect(() => {
    if (isFullscreen) {
      setSidebarMode('hidden')
    } else {
      setSidebarMode('narrow')
    }
  }, [isFullscreen, setSidebarMode])

  // Clear the pending hide timer on unmount.
  useEffect(() => () => clearTimeout(hideTimerRef.current), [])

  // Hovering the narrow column (or its icons) shows the popup preview.
  const handleNarrowEnter = useCallback(() => {
    if (sidebarMode === 'narrow') {
      clearTimeout(hideTimerRef.current)
      setSidebarHovered(true)
    }
  }, [sidebarMode, setSidebarHovered])

  const handleNarrowLeave = useCallback(() => {
    // Delay to allow the mouse to reach the popup; re-entering cancels it.
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => setSidebarHovered(false), 150)
  }, [setSidebarHovered])

  const handlePopupEnter = useCallback(() => {
    clearTimeout(hideTimerRef.current)
    setSidebarHovered(true)
  }, [setSidebarHovered])

  const handlePopupLeave = useCallback(() => {
    // Delay hiding so a brief pointer exit (e.g. while dragging a text selection
    // in the OCR textarea) doesn't immediately close the preview.
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => setSidebarHovered(false), 300)
  }, [setSidebarHovered])

  /** Hovering an icon previews that tab in the popup. */
  const handleIconEnter = useCallback(
    (tab: 'notes' | 'vocab') => {
      if (sidebarMode !== 'narrow') return
      clearTimeout(hideTimerRef.current)
      setSidebarTab(tab)
      setSidebarHovered(true)
    },
    [sidebarMode, setSidebarTab, setSidebarHovered],
  )

  /** Clicking an icon opens the full sidebar on that tab. */
  const handleIconClick = useCallback(
    (tab: 'notes' | 'vocab') => {
      setSidebarTab(tab)
      setSidebarMode('full')
    },
    [setSidebarTab, setSidebarMode],
  )

  const isVisible = sidebarMode !== 'hidden'
  const isFull = sidebarMode === 'full'

  return (
    <div className="flex h-screen w-screen bg-background overflow-hidden">
      {/* Main video area */}
      <div className="flex-1 flex flex-col min-w-0">
        <VideoPanel onBack={() => setAppPhase('dashboard')} onOpenSettings={() => setSettingsOpen(true)} />
      </div>

      {/* ── Narrow column (always visible when not fullscreen) ── */}
      {isVisible && !isFull && (
        <div
          ref={narrowRef}
          onMouseEnter={handleNarrowEnter}
          onMouseLeave={handleNarrowLeave}
          className="w-9 shrink-0 glass-deep border-l border-border/60 flex flex-col items-center py-3 gap-4 z-20"
        >
          {/* Notes icon */}
          <button
            onMouseEnter={() => handleIconEnter('notes')}
            onClick={() => handleIconClick('notes')}
            className="relative p-1.5 rounded-lg hover:bg-secondary transition-colors cursor-pointer group"
            title={t('layout.notes')}
          >
            <Notebook size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
            {/* Snapshot count badge */}
            {activeNoteId && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-[0.5625rem] font-bold
                               text-primary-foreground flex items-center justify-center">
                ●
              </span>
            )}
          </button>

          {/* Vocab icon */}
          <button
            onMouseEnter={() => handleIconEnter('vocab')}
            onClick={() => handleIconClick('vocab')}
            className="relative p-1.5 rounded-lg hover:bg-secondary transition-colors cursor-pointer group"
            title={t('layout.vocab')}
          >
            <BookOpen size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </div>
      )}

      {/* ── Popup (floating panel on hover) ── */}
      {isVisible && !isFull && (
        <div
          ref={popupRef}
          onMouseEnter={handlePopupEnter}
          onMouseLeave={handlePopupLeave}
          className={`absolute right-9 top-0 bottom-0 w-80 flex flex-col glass-deep border border-border/60
                      shadow-2xl shadow-black/40 rounded-l-2xl z-50
                      transition-all duration-200 ease-out
                      ${sidebarHovered
                        ? 'translate-x-0 opacity-100'
                        : 'translate-x-4 opacity-0 pointer-events-none'
                      }`}
        >
          <NotesPanel />
        </div>
      )}

      {/* ── Full sidebar (1/3 of the screen width for comfortable operation) ── */}
      {isFull && (
        <div className="w-1/3 shrink-0 min-w-[300px] glass-deep border-l border-border/60 flex flex-col z-20">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/30">
            <span className="text-xs font-semibold text-foreground/80">
              {sidebarTab === 'vocab' ? t('layout.vocab') : t('layout.notes')}
            </span>
            <button
              onClick={() => setSidebarMode('narrow')}
              className="p-1 rounded-lg hover:bg-secondary transition-colors cursor-pointer"
            >
              <X size={14} className="text-muted-foreground" />
            </button>
          </div>
          <NotesPanel />
        </div>
      )}

      {/* Global toast */}
      <Toast />

      {/* #2 视频内进设置：全屏弹层，复用整页 SettingsPage（读写同一 settingsStore，改动即时生效）。 */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="relative w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl glass-deep border border-border/60
                       shadow-2xl shadow-black/50 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹层头部 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 shrink-0">
              <h2 className="text-[0.9375rem] font-semibold tracking-tight text-foreground">{t('settings.title')}</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                aria-label={t('dashboard.close')}
              >
                <X size={16} />
              </button>
            </div>
            {/* 可滚动内容区 */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <SettingsPage />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
