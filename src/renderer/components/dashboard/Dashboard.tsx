import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UsageTutorial } from './UsageTutorial'
import { useAppStore } from '../../stores/appStore'
import { usePlayerStore } from '../../stores/playerStore'
import { loadNotebook, getNotebookCounts, VideoOcrRegionStorage } from '../../services/storage-service'
import { toMediaUrl, resolveReplayableMedia } from '../../services/stream-resolver'
import { useNoteStore } from '../../stores/noteStore'
import { useSubtitleStore } from '../../stores/subtitleStore'
import { useReviewStore } from '../../stores/reviewStore'
import { useVocabularyStore } from '../../stores/vocabularyStore'
import { useWordGlosses } from '../../services/dict-gloss'
import type { VocabWord } from '@shared/types'
import { formatTime } from '../../lib/time'
import { LogoMark, Wordmark } from '../Logo'
import { SettingsPage } from './SettingsPage'
import { ReviewQueue } from '../review/ReviewQueue'
import { AutoClipSection } from './AutoClipSection'
import { useI18n } from '../../i18n/useI18n'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  Play, BookOpen, Plus, Clock, BookMarked, Film,
  Trash2, AlertCircle, Search, Library, HelpCircle, Flame, Settings,
  NotebookPen, BookOpenText, Moon, Sun, Scissors, Pencil
} from 'lucide-react'
import { RenameInline } from './RenameInline'

// 六种影片标题卡式氛围底，按视频 hash 稳定映射，保证同一视频每次打开缩略图颜色一致。
const THUMBS = ['thumb-nature', 'thumb-movie', 'thumb-conversation', 'thumb-space', 'thumb-animation', 'thumb-city']
function thumbClass(hash: string): string {
  let n = 0
  for (let i = 0; i < hash.length; i++) n = (n + hash.charCodeAt(i)) % THUMBS.length
  return THUMBS[n]
}

export function Dashboard() {
  const {
    videos,
    lastVideoHash,
    streak,
    totalWords,
    todayReviewCount,
    refreshStats,
    setAppPhase,
    removeVideo,
    renameVideo,
    markOpened,
    dashboardReturnView,
    setDashboardReturnView,
  } = useAppStore()
  const loadVideo = usePlayerStore((s) => s.loadVideo)
  const loadNotebookStore = useNoteStore((s) => s.loadNotebook)
  const loadVideoOcrRegion = useNoteStore((s) => s.loadVideoOcrRegion)
  const words = useVocabularyStore((s) => s.words)
  const { t, language } = useI18n()
  const [deleteConfirmHash, setDeleteConfirmHash] = useState<string | null>(null)
  const [renameHash, setRenameHash] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [navView, setNavView] = useState<'library' | 'recent' | 'review' | 'clip' | 'settings' | 'tutorial'>('library')
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setSetting)
  const continueRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    refreshStats()
  }, [refreshStats])

  // Restore the dashboard view that opened the player. Flashcard review has its
  // own return marker and takes precedence over a normal video navigation.
  useEffect(() => {
    if (useReviewStore.getState().returnToReview) {
      setNavView('review')
      useReviewStore.getState().setReturnToReview(false)
      setDashboardReturnView('library')
      return
    }
    if (dashboardReturnView !== 'library') {
      setNavView(dashboardReturnView)
      setDashboardReturnView('library')
    }
  }, [dashboardReturnView, setDashboardReturnView])

  // Shared open path for "Continue" and clicking a video card. Before handing a
  // stored record to the player, verify it can still be played: records whose
  // filePath is a dead blob:/data: URL (file import, killed by a page reload) or
  // a /media URL for a deleted file must not reach the <video> element.
  const openVideo = useCallback(async (hash: string) => {
    const video = videos[hash]
    if (!video) return
    setLoadError(null)
    setDeleteConfirmHash(null) // 打开视频时取消任何待确认的删除
    let status: Awaited<ReturnType<typeof resolveReplayableMedia>>
    const notebookHash = video.isReviewClip && video.reviewSourceHash ? video.reviewSourceHash : hash
    const returnView = navView === 'recent' || navView === 'review' || navView === 'clip' ? navView : 'library'
    try {
      status = await resolveReplayableMedia(video)
    } catch {
      const notes = await loadNotebook(notebookHash)
      loadNotebookStore(notes, notebookHash)
      loadVideoOcrRegion(VideoOcrRegionStorage.load(notebookHash))
      loadVideo(toMediaUrl(video.filePath), video.hash)
      markOpened(hash)
      setDashboardReturnView(returnView)
      setAppPhase('player')
      return
    }
    if (!status.ok) {
      setLoadError(
        status.reason === 'needs-reimport'
          ? t('dashboard.error.needsReimport', { name: video.fileName })
          : t('dashboard.error.missingFile', { name: video.fileName }),
      )
      return
    }
    const notes = await loadNotebook(notebookHash)
    loadNotebookStore(notes, notebookHash)
    loadVideoOcrRegion(VideoOcrRegionStorage.load(notebookHash))
    loadVideo(status.src, video.hash)
    markOpened(hash)
    setDashboardReturnView(returnView)
    setAppPhase('player')
  }, [videos, navView, loadNotebook, loadNotebookStore, loadVideo, loadVideoOcrRegion, markOpened, setDashboardReturnView, setAppPhase, t])

  const handleContinue = () => {
    if (!lastVideo) return
    openVideo(lastVideo.hash)
  }

  const handleNewVideo = () => {
    usePlayerStore.getState().clearVideo()
    useNoteStore.getState().clearNotebook()
    useSubtitleStore.getState().clearSubtitles()
    setAppPhase('player')
  }

  // 从「待复习生词」跳到单词所在视频的时间戳：先记下要 seek 的位置，
  // 再走 openVideo 加载——播放器就绪后（避开缩略图 capture 的 seek）再应用。
  const openVideoAt = useCallback((hash: string, ts: number) => {
    usePlayerStore.getState().setPendingSeekTime(Math.max(0, ts - 3))
    openVideo(hash)
  }, [openVideo])

  // 空词库「去笔记看看」：有观看历史回到上次视频，否则进入新的导入/笔记流程。
  const handleGoToNotes = () => {
    if (lastVideo) openVideo(lastVideo.hash)
    else handleNewVideo()
  }

  const handleDeleteVideo = (hash: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (deleteConfirmHash === hash) {
      removeVideo(hash)
      setDeleteConfirmHash(null)
    } else {
      setDeleteConfirmHash(hash)
    }
  }

  // 进入重命名编辑态（同时关闭删除确认态）
  const startRename = (hash: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteConfirmHash(null)
    setRenameHash(hash)
  }

  const handleRenameSave = (hash: string, name: string) => {
    renameVideo(hash, name)
    setRenameHash(null)
  }

  const cancelRename = () => setRenameHash(null)

  // 复习视频只在「复习视频」页面管理，不作为普通视频出现在视频库/最近学习。
  const libraryVideos = Object.values(videos).filter((v) => !v.isReviewClip)
  const hasHistory = libraryVideos.length > 0
  const lastVideo = lastVideoHash && !videos[lastVideoHash]?.isReviewClip
    ? videos[lastVideoHash]
    : libraryVideos
      .filter((v) => v.lastOpenedAt > 0)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0] ?? null

  const searchQuery = search.trim().toLowerCase()
  // Library 视图按文件名排序；Recent 视图按最近打开时间倒序（lastOpenedAt 为 0 的旧记录排除在外）。
  const allVideos = libraryVideos.filter(
    (v) => !searchQuery || v.fileName.toLowerCase().includes(searchQuery),
  )
  const filteredVideos = navView === 'recent'
    ? allVideos.filter((v) => v.lastOpenedAt > 0).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    : [...allVideos].sort((a, b) => a.fileName.localeCompare(b.fileName))

  // #22 泛搜索：搜索词同时命中生词库（word / 释义）。释义走 useWordGlosses（离线段义 + 缓存），
  // 与单词本列表一致。同一词在同一视频重复出现时去重，每条点击跳转到该词被标记的视频时间戳。
  const wordKeys = useMemo(() => words.map((w) => w.word), [words])
  const glosses = useWordGlosses(wordKeys)
  const matchingWords = useMemo(() => {
    if (!searchQuery) return [] as VocabWord[]
    const seen = new Set<string>()
    const out: VocabWord[] = []
    for (const w of words) {
      const gloss = glosses[w.word.toLowerCase()] ?? ''
      if (!w.word.toLowerCase().includes(searchQuery) && !gloss.toLowerCase().includes(searchQuery)) continue
      const key = `${w.word.toLowerCase()}|${w.videoHash}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(w)
    }
    return out
  }, [words, searchQuery, glosses])

  // 笔记数/生词数按「可见视频的 hash 集合」memo 化：搜索输入、删除确认等重渲染不重复读 localStorage。
  // 仅最近学习视图需要这些计数；视频库网格不读。
  const recentHashKey = filteredVideos.map((v) => v.hash).join('|')
  const notebookCounts = useMemo(() => {
    if (navView !== 'recent') return {}
    const map: Record<string, { notes: number; words: number }> = {}
    for (const v of filteredVideos) map[v.hash] = getNotebookCounts(v.hash)
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentHashKey, navView])

  const videoCount = libraryVideos.length

  const formatRelative = (ts: number) => {
    const days = Math.floor((Date.now() - ts) / 86400000)
    if (days <= 0) return t('dashboard.recent.today')
    if (days === 1) return t('dashboard.recent.yesterday')
    if (days < 7) return t('dashboard.recent.daysAgo', { n: days })
    if (days < 30) return t('dashboard.recent.weeksAgo', { n: Math.floor(days / 7) })
    // 超过 30 天显示绝对日期，语言跟随应用设置（而非操作系统），与上方相对文案保持一致
    return new Date(ts).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const navBase = 'flex items-center gap-3 h-10 px-3 rounded-[10px] text-sm font-medium transition-colors cursor-pointer'

  return (
    <div className="h-screen w-screen bg-background overflow-hidden flex">
      {/* ── 侧栏 ── */}
      <aside className="w-56 shrink-0 glass-deep border-r border-border/60 flex flex-col z-20">
        <div className="flex items-center gap-2.5 px-4 h-14">
          <LogoMark size={18} className="text-foreground" />
          <span className="text-[0.9375rem] font-semibold tracking-tight">
            <Wordmark />
          </span>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-1">
          <button
            onClick={() => { setDeleteConfirmHash(null); setNavView('library') }}
            className={`${navBase} ${navView === 'library' ? 'bg-foreground/9 text-foreground font-semibold' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'}`}
          >
            <Library size={16} className="opacity-70" />
            {t('dashboard.nav.library')}
          </button>
          <button
            onClick={() => { setDeleteConfirmHash(null); setNavView('recent') }}
            className={`${navBase} ${navView === 'recent' ? 'bg-foreground/9 text-foreground font-semibold' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'}`}
          >
            <Clock size={16} className="opacity-70" />
            {t('dashboard.nav.recent')}
          </button>
          <button
            onClick={() => { setDeleteConfirmHash(null); setSearch(''); setNavView('review') }}
            className={`${navBase} ${navView === 'review' ? 'bg-foreground/9 text-foreground font-semibold' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'}`}
          >
            <BookMarked size={16} className="opacity-70" />
            {t('dashboard.nav.review')}
            {todayReviewCount > 0 && (
              <span className="ml-auto text-[0.6875rem] font-semibold text-primary bg-primary/10 rounded-full px-2 py-0.5">
                {todayReviewCount}
              </span>
            )}
          </button>
          <button
            onClick={() => { setDeleteConfirmHash(null); setSearch(''); setNavView('clip') }}
            className={`${navBase} ${navView === 'clip' ? 'bg-foreground/9 text-foreground font-semibold' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'}`}
          >
            <Scissors size={16} className="opacity-70" />
            {t('dashboard.nav.clip')}
          </button>
        </nav>

        <div className="px-3 py-3 border-t border-border/60 space-y-1">
          {/* 深浅色快捷切换：不进设置页，一键换白天/黑夜 */}
          <button
            onClick={() => setThemeMode('themeMode', themeMode === 'dark' ? 'light' : 'dark')}
            title={themeMode === 'dark' ? t('settings.appearance.light') : t('settings.appearance.dark')}
            aria-label={themeMode === 'dark' ? t('settings.appearance.light') : t('settings.appearance.dark')}
            className={`${navBase} text-muted-foreground hover:bg-foreground/5 hover:text-foreground`}
          >
            {themeMode === 'dark' ? <Moon size={16} className="opacity-70" /> : <Sun size={16} className="opacity-70" />}
            {themeMode === 'dark' ? t('settings.appearance.dark') : t('settings.appearance.light')}
          </button>
          <button
            onClick={() => { setDeleteConfirmHash(null); setSearch(''); setNavView('settings') }}
            className={`${navBase} ${navView === 'settings' ? 'bg-foreground/9 text-foreground font-semibold' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'}`}
          >
            <Settings size={16} className="opacity-70" />
            {t('dashboard.nav.settings')}
          </button>
          <button
            onClick={() => { setDeleteConfirmHash(null); setSearch(''); setNavView('tutorial') }}
            className={`${navBase} ${navView === 'tutorial' ? 'bg-foreground/9 text-foreground font-semibold' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'}`}
          >
            <HelpCircle size={16} className="opacity-70" />
            {t('dashboard.nav.tutorial')}
          </button>
        </div>
      </aside>

      {/* ── 主区 ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* 页头 */}
        <header className="h-14 shrink-0 flex items-center gap-3 px-6 border-b border-border/40">
          <h1 className="text-[1.0625rem] font-semibold tracking-tight">
            {navView === 'recent'
              ? t('dashboard.recent.title')
              : navView === 'review'
                ? t('dashboard.nav.review')
                : navView === 'clip'
                  ? t('dashboard.nav.clip')
                  : navView === 'settings'
                    ? t('dashboard.nav.settings')
                    : navView === 'tutorial'
                    ? t('dashboard.nav.tutorial')
                    : t('dashboard.header.title')}
          </h1>
          <div className="flex-1" />
          {navView !== 'settings' && navView !== 'clip' && navView !== 'tutorial' && (
            <div className="relative hidden sm:block">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={navView === 'review' ? t('review.searchPlaceholder') : t('dashboard.header.search')}
                className="h-9 w-56 pl-9 pr-3 rounded-[10px] bg-foreground/5 border border-border/60 text-sm
                           text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-colors"
              />
            </div>
          )}
          <button
            onClick={handleNewVideo}
            className="h-9 px-4 rounded-[10px] bg-primary hover:bg-primary-hover active:scale-[0.98] text-white text-sm font-semibold
                       transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Plus size={16} />
            {t('dashboard.header.import')}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
            {/* 错误提示 */}
            {loadError && (
              <div className="flex items-start gap-2 p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-sm text-destructive">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">{loadError}</div>
                <button
                  onClick={() => setLoadError(null)}
                  className="shrink-0 px-1.5 rounded-md text-destructive/60 hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                  aria-label={t('dashboard.close')}
                >
                  ✕
                </button>
              </div>
            )}

            {/* 视频库视图：统计四格 + 继续学习 + 视频库网格（最近学习视图与设计稿一致，仅列表） */}
            {navView === 'library' && (
              <>
                {/* 统计四格 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: t('dashboard.stats.dueToday'), value: todayReviewCount, icon: BookMarked },
                { label: t('dashboard.stats.streak'), value: streak, icon: Flame },
                { label: t('dashboard.stats.vocab'), value: totalWords, icon: BookOpen },
                { label: t('dashboard.stats.library'), value: videoCount, icon: Film },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-2xl border border-border/50 bg-card/60 p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Icon size={14} className="text-primary/70" />
                    <span className="text-xs">{label}</span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
                </div>
              ))}
            </div>

            {/* 继续学习 大卡片（横向 feature card） */}
            <div ref={continueRef}>
              {lastVideo ? (
                <div
                  className="group flex rounded-2xl border border-border/50 bg-card/60 overflow-hidden
                             hover:border-primary/40 transition-colors cursor-pointer"
                  onClick={handleContinue}
                >
                  <div className={`thumb w-[280px] min-h-[180px] shrink-0 ${thumbClass(lastVideo.hash)}`}>
                    <span className="grain" />
                    {lastVideo.thumbnailDataUrl && (
                      <img src={lastVideo.thumbnailDataUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="w-12 h-12 rounded-full bg-white/90 text-black flex items-center justify-center
                                       transition-transform group-hover:scale-105">
                        <Play size={18} />
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 p-5 sm:p-6">
                    <p className="text-[0.625rem] font-semibold tracking-[0.08em] uppercase text-muted-foreground">{t('dashboard.continue.label')}</p>
                    <h3 className="mt-1.5 text-lg font-semibold leading-snug text-foreground truncate">{lastVideo.fileName}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('dashboard.continue.lastOpened')} · {new Date(lastVideo.lastOpenedAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US')}
                    </p>
                    <span className="mt-5 inline-flex h-10 px-4 rounded-[10px] bg-primary hover:bg-primary-hover active:scale-[0.98]
                                     text-white text-sm font-semibold transition-all cursor-pointer items-center gap-1.5">
                      <Play size={15} />
                      {t('dashboard.continue.watch')}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center">
                  <p className="text-sm text-muted-foreground">{t('dashboard.continue.empty')}</p>
                  <button
                    onClick={handleNewVideo}
                    className="mt-4 h-9 px-4 rounded-[10px] bg-primary hover:bg-primary-hover text-white text-sm font-semibold
                               transition-all cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Plus size={16} />
                    {t('dashboard.continue.import')}
                  </button>
                </div>
              )}
            </div>
            </>
            )}

            {/* 最近学习 · 表格式竖排列表（与设计稿一致，仅列表 + 空状态） */}
            {navView === 'recent' && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground/60">
                  {t('dashboard.list.meta', { n: filteredVideos.length, m: totalWords })}
                </p>
                {filteredVideos.length > 0 ? (
                  <>
                    {/* 列头 */}
                    <div className="flex items-center gap-4 px-4 text-xs font-medium text-muted-foreground/70">
                      <span className="w-[120px] lg:w-36 shrink-0">{t('dashboard.list.thumb')}</span>
                      <span className="flex-1 min-w-0">{t('dashboard.list.title')}</span>
                      <span className="hidden lg:block w-[88px] shrink-0">{t('dashboard.list.notes')}</span>
                      <span className="hidden lg:block w-[88px] shrink-0">{t('dashboard.list.words')}</span>
                      <span className="w-[92px] shrink-0 text-right">{t('dashboard.list.lastOpened')}</span>
                      <span className="w-8 shrink-0" />
                    </div>

                    {/* 数据行 */}
                    <div className="space-y-2.5">
                      {filteredVideos.map((video) => {
                        const { notes, words } = notebookCounts[video.hash] ?? { notes: 0, words: 0 }
                        const minutes = video.duration > 0 ? Math.max(1, Math.round(video.duration / 60)) : 0
                        // 外层用 div role=button：行内嵌套删除按钮在 HTML 规范里不合法、也污染无障碍树；
                        // 删除按钮用 stopPropagation 阻断冒泡，行本身用 Enter/Space 触发打开。
                        return (
                          <div
                            key={video.hash}
                            role="button"
                            tabIndex={0}
                            aria-label={video.fileName}
                            onClick={() => openVideo(video.hash)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                openVideo(video.hash)
                              }
                            }}
                            className="group flex items-center gap-4 rounded-2xl border border-border/40 bg-card/40
                                       px-4 py-3.5 hover:border-white/30 hover:shadow-[0_16px_48px_rgba(0,0,0,0.5)]
                                       hover:-translate-y-0.5 transition-all cursor-pointer text-left w-full
                                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            <div className={`thumb w-[120px] lg:w-36 aspect-video shrink-0 rounded-[10px] ${thumbClass(video.hash)}`}>
                              <span className="grain" />
                              {video.thumbnailDataUrl && (
                                <img src={video.thumbnailDataUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                              )}
                              <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="w-9 h-9 rounded-full bg-white/90 text-black flex items-center justify-center">
                                  <Play size={14} />
                                </span>
                              </span>
                            </div>

                            <div className="flex-1 min-w-0">
                              {renameHash === video.hash ? (
                                <RenameInline
                                  initial={video.fileName}
                                  onSave={(name) => handleRenameSave(video.hash, name)}
                                  onCancel={cancelRename}
                                />
                              ) : (
                                <>
                                  <p className="text-sm font-semibold leading-snug text-foreground truncate">{video.fileName}</p>
                                  <p className="mt-0.5 text-xs text-muted-foreground truncate">
                                    {minutes > 0 ? t('dashboard.list.minutes', { n: minutes }) : ' '}
                                  </p>
                                </>
                              )}
                            </div>

                            <span className="hidden lg:flex w-[88px] shrink-0 items-center gap-1.5 text-muted-foreground">
                              <NotebookPen size={14} className="opacity-70" />
                              <span className="text-sm tabular-nums text-foreground/80">{notes}</span>
                            </span>

                            <span className="hidden lg:flex w-[88px] shrink-0 items-center gap-1.5 text-muted-foreground">
                              <BookOpenText size={14} className="opacity-70" />
                              <span className="text-sm tabular-nums text-foreground/80">{words}</span>
                            </span>

                            <span className="w-[92px] shrink-0 text-right text-xs text-muted-foreground whitespace-nowrap">
                              {formatRelative(video.lastOpenedAt)}
                            </span>

                            <button
                              onClick={(e) => startRename(video.hash, e)}
                              onKeyDown={(e) => e.stopPropagation()}
                              aria-label={t('dashboard.rename.label')}
                              title={t('dashboard.rename.label')}
                              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-all cursor-pointer
                                         text-muted-foreground/60 hover:text-primary hover:bg-primary/10
                                         opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            >
                              <Pencil size={13} />
                            </button>

                            <button
                              onClick={(e) => handleDeleteVideo(video.hash, e)}
                              onKeyDown={(e) => e.stopPropagation()}
                              aria-pressed={deleteConfirmHash === video.hash}
                              aria-label={deleteConfirmHash === video.hash ? t('dashboard.delete.confirm') : t('dashboard.delete.label')}
                              className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-all cursor-pointer
                                ${deleteConfirmHash === video.hash
                                  ? 'bg-destructive/80 text-white'
                                  : 'text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                                }`}
                              title={deleteConfirmHash === video.hash ? t('dashboard.delete.confirm') : t('dashboard.delete.label')}
                            >
                              {deleteConfirmHash === video.hash ? <AlertCircle size={13} /> : <Trash2 size={13} />}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground/60 py-6 text-center">
                    {search && allVideos.length === 0
                      ? t('dashboard.all.noMatch', { q: search })
                      : t('dashboard.recent.empty')}
                  </p>
                )}
              </div>
            )}

            {/* 待复习生词：列表 + 闪卡复习（自包含组件，内部管理模式） */}
            {navView === 'review' && (
              <ReviewQueue
                search={search}
                onOpenVideoAt={openVideoAt}
                onOpenNotes={handleGoToNotes}
              />
            )}

            {/* 设置：整页视图（自包含组件，内部读改写 settingsStore） */}
            {navView === 'settings' && <SettingsPage />}

            {/* 自动剪辑复习视频：独立顶层栏目（#10） */}
            {navView === 'clip' && <AutoClipSection onOpenVideo={openVideo} />}

            {/* #22 泛搜索：搜索命中生词 → 生词结果分组（点击跳转到标记时间戳） */}
            {navView === 'library' && searchQuery && matchingWords.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <BookOpenText size={14} className="text-muted-foreground/60" />
                  <h2 className="text-sm font-semibold text-foreground/80">{t('dashboard.wordResults.title')}</h2>
                  {search && (
                    <span className="text-xs text-muted-foreground/60">· {matchingWords.length} {t('dashboard.wordResults.results')}</span>
                  )}
                </div>
                <div className="space-y-2">
                  {matchingWords.map((w) => {
                    const v = videos[w.videoHash]
                    return (
                      <button
                        key={w.id}
                        onClick={() => openVideoAt(w.videoHash, w.videoTimestamp)}
                        className="w-full flex items-center gap-3 rounded-2xl border border-border/40 bg-card/40
                                   px-4 py-3 hover:border-primary/40 hover:-translate-y-0.5
                                   transition-all cursor-pointer text-left group"
                      >
                        <div className="w-9 h-9 rounded-[10px] bg-primary/10 border border-primary/20 grid place-items-center shrink-0">
                          <BookOpenText size={15} className="text-primary/70" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{w.word}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground truncate">{glosses[w.word.toLowerCase()] ?? w.contextSentence}</p>
                        </div>
                        <div className="shrink-0 text-right hidden sm:block">
                          <p className="text-xs text-muted-foreground truncate max-w-[160px]">{v ? v.fileName : ''}</p>
                          <p className="text-[0.625rem] font-mono text-primary/70 mt-0.5">{formatTime(w.videoTimestamp)}</p>
                        </div>
                        <span className="w-6 h-6 rounded-full bg-white/90 text-black grid place-items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play size={11} />
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 视频库网格 */}
            {navView === 'library' && hasHistory && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Film size={14} className="text-muted-foreground/60" />
                  <h2 className="text-sm font-semibold text-foreground/80">{t('dashboard.all.title')}</h2>
                  {search && (
                    <span className="text-xs text-muted-foreground/60">· {filteredVideos.length} {t('dashboard.all.results')}</span>
                  )}
                </div>
                {filteredVideos.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredVideos.map((video) => (
                      <button
                        key={video.hash}
                        onClick={() => openVideo(video.hash)}
                        className="group rounded-2xl border border-border/40 bg-card/40 overflow-hidden
                                   hover:border-border/70 hover:-translate-y-0.5 transition-all cursor-pointer relative text-left"
                      >
                        <div className={`thumb aspect-video ${thumbClass(video.hash)}`}>
                          <span className="grain" />
                          {video.thumbnailDataUrl && (
                            <img src={video.thumbnailDataUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                          )}
                          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="w-10 h-10 rounded-full bg-white/90 text-black flex items-center justify-center">
                              <Play size={15} />
                            </span>
                          </span>
                        </div>
                        <div className="p-3.5">
                          {renameHash === video.hash ? (
                            <RenameInline
                              initial={video.fileName}
                              onSave={(name) => handleRenameSave(video.hash, name)}
                              onCancel={cancelRename}
                            />
                          ) : (
                            <>
                              <p className="text-sm font-semibold leading-snug text-foreground truncate">{video.fileName}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {video.lastOpenedAt > 0
                                  ? `${t('dashboard.continue.lastOpened')} · ${new Date(video.lastOpenedAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US')}`
                                  : t('dashboard.all.neverOpened')}
                              </p>
                            </>
                          )}
                        </div>
                        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => startRename(video.hash, e)}
                            aria-label={t('dashboard.rename.label')}
                            title={t('dashboard.rename.label')}
                            className="p-1.5 rounded-lg bg-black/40 text-white/80 hover:bg-primary/70 hover:text-white transition-all cursor-pointer"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={(e) => handleDeleteVideo(video.hash, e)}
                            className={`p-1.5 rounded-lg transition-all cursor-pointer
                              ${deleteConfirmHash === video.hash
                                ? 'bg-destructive/80 text-white'
                                : 'bg-black/40 text-white/80 hover:bg-destructive/80 hover:text-white'
                              }`}
                            title={deleteConfirmHash === video.hash ? t('dashboard.delete.confirm') : t('dashboard.delete.label')}
                          >
                            {deleteConfirmHash === video.hash ? <AlertCircle size={12} /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground/60 py-6 text-center">{t('dashboard.all.noMatch', { q: search })}</p>
                )}
              </div>
            )}

            {/* 使用教程：与 设置/待复习 同级的一级页面（非弹层） */}
            {navView === 'tutorial' && <UsageTutorial defaultOpen />}

          </div>
        </div>
      </div>
    </div>
  )
}
