import { useState, useCallback, useRef, useEffect } from 'react'
import { usePlayerStore } from '../../stores/playerStore'
import { useAppStore } from '../../stores/appStore'
import { useNoteStore } from '../../stores/noteStore'
import { useToastStore } from '../../stores/toastStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useI18n } from '../../i18n/useI18n'
import { useSubtitle } from '../../hooks/useSubtitle'
import { loadNotebook, VideoOcrRegionStorage } from '../../services/storage-service'
import { OCRService } from '../../services/ocr-service'
import {
  resolveStreamUrl, isPlatformUrl, isDirectVideoUrl, extractVideoUrl,
  getPlatformName, checkYtDlpAvailable, downloadYtDlp, toMediaUrl,
  downloadVideo, onDownloadProgress, initMediaUrl,
  type DownloadProgress,
} from '../../services/stream-resolver'
import {
  Upload, Link, FileText, Film,
  Loader2, AlertCircle, Download, CheckCircle2,
} from 'lucide-react'
import { simpleHash } from '../../lib/hash'

/**
 * Upload a local video to the backend so it persists across reloads (web mode).
 * Returns the absolute path written by the backend. The registry must keep this
 * raw path rather than a blob URL or a URL containing the current web origin;
 * toMediaUrl derives a fresh playable URL whenever the video is opened.
 */
async function uploadLocalVideo(file: File): Promise<string | null> {
  try {
    const res = await fetch(`/api/upload/video?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    if (!data?.filePath) return null
    return data.filePath
  } catch {
    return null
  }
}

/**
 * Import a local video file for the current environment, returning a playable
 * src plus a persistable path. A web import is rejected when the backend cannot
 * save it; accepting a session-scoped blob URL would recreate the exact failure
 * mode where the video appears imported and then disappears after refresh.
 *
 * - Electron: webUtils.getPathForFile gives the real absolute path (same as the
 *   open-video dialog) — persist the raw path so it survives a reload.
 * - Web: upload to the backend so the file lands on disk and can be re-served.
 */
async function importLocalFile(file: File): Promise<{ src: string; persistPath: string } | null> {
  const { electronAPI } = window as any
  if (electronAPI?.getPathForFile) {
    const rawPath = electronAPI.getPathForFile(file)
    if (rawPath) {
      await initMediaUrl()
      return { src: toMediaUrl(rawPath), persistPath: rawPath }
    }
  }
  const persistedPath = await uploadLocalVideo(file)
  if (!persistedPath) return null
  return { src: toMediaUrl(persistedPath), persistPath: persistedPath }
}

type ResolveState = 'idle' | 'checking' | 'resolving' | 'resolved' | 'error'

/** 稳定哨兵：yt-dlp 未安装（区别于普通文案，用于判断显示安装按钮）。 */
const YTDLP_NOT_INSTALLED = 'yt-dlp-not-installed'

export function SourceInput() {
  const [url, setUrl] = useState('')
  const [dragover, setDragover] = useState(false)
  const videoSrc = usePlayerStore((s) => s.videoSrc)
  const videoHash = usePlayerStore((s) => s.videoHash)
  const loadVideo = usePlayerStore((s) => s.loadVideo)
  const { loadSubtitleFile } = useSubtitle()
  const registerVideo = useAppStore((s) => s.registerVideo)
  // 原始文件名（注册进 appStore 时保存），compact 顶部栏优先显示它而非 URL-encoded 的 src 段。
  const videoFileName = useAppStore((s) => (videoHash ? s.videos[videoHash]?.fileName : undefined))
  const loadNotebookStore = useNoteStore((s) => s.loadNotebook)
  const loadVideoOcrRegion = useNoteStore((s) => s.loadVideoOcrRegion)
  const createNote = useNoteStore((s) => s.createNote)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const subInputRef = useRef<HTMLInputElement>(null)
  const { t } = useI18n()

  // Stream resolution state
  const [resolveState, setResolveState] = useState<ResolveState>('idle')
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [platformName, setPlatformName] = useState<string | null>(null)
  const [ytDlpAvailable, setYtDlpAvailable] = useState<boolean | null>(null)
  const [ytDlpDownloading, setYtDlpDownloading] = useState(false)

  // Pre-resolve: start resolving as soon as a platform URL is detected (debounced)
  const preResolveTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const [preResolving, setPreResolving] = useState(false)
  const [preResolvedTitle, setPreResolvedTitle] = useState<string | null>(null)

  // Download state (for platform URLs → download to local folder)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const unsubProgressRef = useRef<(() => void) | null>(null)

  // Initialize OCR service
  const ocrInitialized = useRef(false)
  const setOCRResult = useNoteStore((s) => s.setOCRResult)
  const ocrLanguage = useSettingsStore((s) => s.ocrLanguage)

  const initOCR = useCallback(() => {
    if (ocrInitialized.current) return
    ocrInitialized.current = true
    OCRService.init((result) => {
      setOCRResult(result.snapshotId, result.text)
    }, ocrLanguage)
  }, [setOCRResult, ocrLanguage])

  // Check yt-dlp availability on mount
  useEffect(() => {
    checkYtDlpAvailable().then((status) => {
      setYtDlpAvailable(status.available)
    })
  }, [])

  // Detect platform as user types + trigger pre-resolve after debounce
  const handleUrlChange = useCallback((value: string) => {
    setUrl(value)
    setResolveError(null)
    setResolveState('idle')
    setPreResolvedTitle(null)

    const trimmed = extractVideoUrl(value)
    if (trimmed && isPlatformUrl(trimmed)) {
      setPlatformName(getPlatformName(trimmed))
    } else {
      setPlatformName(null)
      setPreResolving(false)
      if (preResolveTimerRef.current) {
        clearTimeout(preResolveTimerRef.current)
        preResolveTimerRef.current = null
      }
    }
  }, [])

  // Pre-resolve: when url changes to a platform URL, wait 600ms then resolve in background
  useEffect(() => {
    if (preResolveTimerRef.current) {
      clearTimeout(preResolveTimerRef.current)
      preResolveTimerRef.current = null
    }

    const trimmed = extractVideoUrl(url)
    if (!trimmed || !isPlatformUrl(trimmed) || isDirectVideoUrl(trimmed)) {
      setPreResolving(false)
      return
    }

    // Don't pre-resolve if yt-dlp is known to be unavailable
    if (ytDlpAvailable === false) return

    preResolveTimerRef.current = setTimeout(async () => {
      setPreResolving(true)
      try {
        const resolved = await resolveStreamUrl(trimmed)
        setPreResolvedTitle(resolved.title)
        // Result is now cached in main process — clicking Load will be instant
      } catch {
        // Silent fail — user will see error on explicit Load click
      } finally {
        setPreResolving(false)
      }
    }, 600)

    return () => {
      if (preResolveTimerRef.current) {
        clearTimeout(preResolveTimerRef.current)
        preResolveTimerRef.current = null
      }
    }
  }, [url, ytDlpAvailable])

  // Cleanup download progress listener on unmount
  useEffect(() => {
    return () => {
      if (unsubProgressRef.current) {
        unsubProgressRef.current()
        unsubProgressRef.current = null
      }
    }
  }, [])

  /**
   * Core handler: once we have a stream URL, set up the player.
   *
   * @param src          URL handed to the <video> element (may be a blob: object URL).
   * @param displayName  Human-readable file name shown in the UI and registry.
   * @param persistPath  URL to store in the registry for later re-opening. Defaults
   *                     to `src`, but a blob: URL must NOT be persisted (it dies on
   *                     reload) — pass the stable streaming URL instead.
   */
  const handleVideoLoaded = useCallback(async (src: string, displayName: string, persistPath?: string) => {
    const hash = simpleHash(displayName || src)

    // Initialize OCR
    initOCR()

    // Load or register video
    loadVideo(src, hash)
    registerVideo({
      hash,
      filePath: persistPath || src,
      fileName: displayName,
      duration: 0,
      lastPlayedTime: 0,
      lastOpenedAt: Date.now(),
    })

    // Load or create notebook
    const existingNotes = await loadNotebook(hash)
    if (existingNotes.length > 0) {
      loadNotebookStore(existingNotes, hash)
    } else {
      loadNotebookStore([], hash)
      createNote(hash, 'Default')
    }

    // Restore the per-video OCR region (if the user previously set one)
    loadVideoOcrRegion(VideoOcrRegionStorage.load(hash))
  }, [loadVideo, registerVideo, loadNotebookStore, createNote, initOCR, loadVideoOcrRegion])

  const handleOpenFile = useCallback(async () => {
    const { electronAPI } = window as any
    if (electronAPI?.openVideo) {
      const filePath = await electronAPI.openVideo()
      if (filePath) {
        const name = filePath.split(/[\\/]/).pop() || filePath
        // #9 修复：先等后端 media base 就绪，src 用可播的 media URL；但 persistPath
        // 存「原始绝对路径」而非 media URL——刷新后 resolveReplayableMedia 才能
        // 对本地路径正确回放（旧逻辑存 file:// 兜底 URL，刷新后无法回放 → 视频消失）。
        await initMediaUrl()
        handleVideoLoaded(toMediaUrl(filePath), name, filePath)
      }
    } else {
      videoInputRef.current?.click()
    }
  }, [handleVideoLoaded])

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      // Only finish the import after a stable path exists. A blob: fallback looks
      // successful but cannot survive refresh, so it must never enter the registry.
      const imported = await importLocalFile(file)
      if (!imported) {
        useToastStore.getState().showToast(t('import.unsavedToast'), 4000)
        e.target.value = ''
        return
      }
      await handleVideoLoaded(imported.src, file.name, imported.persistPath)
      e.target.value = ''
    },
    [handleVideoLoaded, t],
  )

  /** Drag-and-drop a local video file onto the import card. */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      const imported = await importLocalFile(file)
      if (!imported) {
        useToastStore.getState().showToast(t('import.unsavedToast'), 4000)
        return
      }
      await handleVideoLoaded(imported.src, file.name, imported.persistPath)
    },
    [handleVideoLoaded, t],
  )

  /** Handle URL submission — resolve platform URLs, load direct URLs directly. */
  const handleLoadUrl = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      // Bilibili/YouTube share strings often wrap the URL in a 【标题】 prefix or
      // trailing copy text — extract the actual http(s):// URL first so pasting
      // the site's share button text works exactly like a pure link.
      const trimmed = extractVideoUrl(url)
      if (!trimmed) return

      // Direct video URL: load immediately
      if (isDirectVideoUrl(trimmed)) {
        const displayName = trimmed.split('/').pop()?.split('?')[0] || trimmed
        handleVideoLoaded(trimmed, displayName)
        return
      }

      // Platform URL: download via yt-dlp with progress, then play locally
      if (isPlatformUrl(trimmed)) {
        setResolveState('checking')
        setResolveError(null)

        // Check yt-dlp availability
        const status = await checkYtDlpAvailable()
        setYtDlpAvailable(status.available)

        if (!status.available) {
          setResolveState('error')
          setResolveError(YTDLP_NOT_INSTALLED)
          return
        }

        setResolveState('resolving')

        // Subscribe to download progress
        if (unsubProgressRef.current) unsubProgressRef.current()
        unsubProgressRef.current = onDownloadProgress((p) => {
          setDownloadProgress(p)
        })

        setDownloading(true)
        setDownloadProgress(null)

        try {
          const result = await downloadVideo(trimmed)
          if (result.error) {
            throw new Error(result.error)
          }
          setResolveState('resolved')
          setDownloading(false)
          setDownloadProgress(null)
          // Ensure the backend media URL is resolved before converting the local path.
          // getMediaBaseUrl re-probes on failure, so a backend that was momentarily
          // down at page-load time is recovered here.
          await initMediaUrl()
          const mediaUrl = toMediaUrl(result.filePath!)
          if (!mediaUrl.startsWith('http://') && !mediaUrl.startsWith('https://')) {
            throw new Error(t('import.mediaServerDown'))
          }
          const fileName = result.fileName || result.filePath!

          // ── Download → import hookup ──
          // Directly-imported videos play reliably in every browser because they
          // reach the <video> element as a browser-native blob: object URL —
          // same-origin, no CORS, no media-server involvement. Do the exact same
          // thing for a freshly-downloaded file: fetch it and hand the player a
          // blob: URL. This makes downloaded playback identical to imported
          // playback, removing every server/CORS/format difference that can
          // surface as "Video failed to load". For very large files, fall back to
          // streaming the same-origin media URL instead of buffering the whole
          // file in memory. We persist the RAW absolute path (not the media URL),
          // because the media URL embeds the media server's per-launch random port
          // and dies on restart — resolveReplayableMedia rewrites the raw path to
          // the current port on re-open (same as the open-file/import paths).
          let playSrc = mediaUrl
          try {
            const res = await fetch(mediaUrl)
            if (res.ok) {
              const len = Number(res.headers.get('content-length') || 0)
              if (len > 0 && len <= 512 * 1024 * 1024) {
                const blob = await res.blob()
                playSrc = URL.createObjectURL(blob)
              } else if (len > 0) {
                // Too big to buffer — keep streaming (abort the in-flight body).
                res.body?.cancel().catch(() => {})
              }
            }
          } catch {
            // fetch failed for any reason — fall through to the streaming URL.
          }
          handleVideoLoaded(playSrc, fileName, result.filePath!)
        } catch (err: any) {
          setResolveState('error')
          setDownloading(false)
          setDownloadProgress(null)
          setResolveError(err.message || t('import.resolveFailed'))
        }
        return
      }

      // Unknown URL — try as direct
      const displayName = trimmed.split('/').pop()?.split('?')[0] || trimmed
      handleVideoLoaded(trimmed, displayName)
    },
    [url, handleVideoLoaded, t],
  )

  /** Install yt-dlp */
  const handleInstallYtDlp = useCallback(async () => {
    setYtDlpDownloading(true)
    try {
      await downloadYtDlp()
      setYtDlpAvailable(true)
      setResolveError(null)
      setResolveState('idle')
    } catch (err: any) {
      setResolveError(err.message || t('import.ytdlpDownloadFailed'))
    } finally {
      setYtDlpDownloading(false)
    }
  }, [])

  const handleOpenSubtitle = useCallback(async () => {
    const { electronAPI } = window as any
    if (electronAPI?.openSubtitle) {
      const result = await electronAPI.openSubtitle()
      if (result) loadSubtitleFile(result.content, result.fileName)
    } else {
      subInputRef.current?.click()
    }
  }, [loadSubtitleFile])

  const handleSubFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = () => loadSubtitleFile(reader.result as string, file.name)
        reader.readAsText(file)
      }
    },
    [loadSubtitleFile],
  )

  // Compact mode when a video is already loaded
  if (videoSrc) {
    return (
      <>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl glass-light">
          <Film size={13} className="text-primary/70" />
          <span className="text-[0.6875rem] text-foreground/70 truncate max-w-[180px] font-medium">
            {videoFileName ||
              (() => {
                const seg = videoSrc.split('/').pop()?.split('?')[0] || videoSrc
                try { return decodeURIComponent(seg) } catch { return seg }
              })()}
          </span>
          <div className="w-px h-3 bg-border/50" />
          <button
            onClick={handleOpenFile}
            className="text-[0.6875rem] px-2 py-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer
                       text-muted-foreground hover:text-foreground font-medium"
          >
            {t('import.change')}
          </button>
          <button
            onClick={handleOpenSubtitle}
            className="text-[0.6875rem] px-2 py-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer
                       text-muted-foreground hover:text-foreground font-medium"
          >
            {t('import.subtitles')}
          </button>
        </div>
        <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
        <input ref={subInputRef} type="file" accept=".srt,.vtt,.ass,.ssa" className="hidden" onChange={handleSubFileChange} />
      </>
    )
  }

  // ── Welcome State ──

  const isResolving = resolveState === 'checking' || resolveState === 'resolving'
  const isDownloading = downloading
  const hasError = resolveState === 'error'
  const downloadPct = downloadProgress?.percent ?? 0

  return (
    <div className="flex flex-col items-center w-full max-w-md animate-fade-in">
      {/* 标题 + 引导 */}
      <div className="text-center mb-8">
        <p className="text-[0.6875rem] font-semibold tracking-[0.08em] uppercase text-muted-foreground">LinguaFlix</p>
        <h2 className="mt-3 text-[2rem] sm:text-[2.375rem] font-semibold tracking-tight leading-[1.2] text-foreground">
          {t('import.title')}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          {t('import.subtitle1')}<br className="hidden sm:block" />
          {t('import.subtitle2')}
        </p>
      </div>

      {/* 拖拽上传大卡片 */}
      <div
        onClick={handleOpenFile}
        onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
        onDragLeave={() => setDragover(false)}
        onDrop={(e) => { setDragover(false); handleDrop(e) }}
        className={`w-full h-[200px] rounded-2xl border-2 flex flex-col items-center justify-center gap-4
                   cursor-pointer transition-colors
                   ${dragover
                     ? 'border-primary bg-primary/10'
                     : 'border-dashed border-border/70 hover:border-primary/50 bg-card/30 hover:bg-card/50'}`}
      >
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${dragover ? 'bg-primary text-white' : 'bg-primary/10 text-primary'}`}>
          <Upload size={26} />
        </div>
        <div className="text-center">
          <p className="text-[0.9375rem] font-semibold text-foreground">{dragover ? t('import.dropRelease') : t('import.dropTitle')}</p>
          <p className="text-[0.8125rem] text-muted-foreground mt-1">
            {t('import.or')} <span className="text-primary">{t('import.dropHint')}</span>
          </p>
        </div>
        <p className="text-[0.6875rem] text-muted-foreground/60">{t('import.dropFormats')}</p>
      </div>

      {/* or 分隔 */}
      <div className="flex items-center gap-3 my-6 w-full">
        <div className="flex-1 h-px bg-border/60" />
        <span className="text-xs text-muted-foreground/60 shrink-0">{t('import.divider')}</span>
        <div className="flex-1 h-px bg-border/60" />
      </div>

      {/* 粘贴链接 */}
      <form onSubmit={handleLoadUrl} className="w-full flex gap-2">
        <div className="relative flex-1">
          <Link size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder={t('import.linkPlaceholder')}
            disabled={isResolving}
            className={`h-11 w-full pl-9 pr-3 rounded-xl bg-card/60 border text-sm
                       text-foreground placeholder:text-muted-foreground/40
                       focus:outline-none focus:ring-2 transition-colors
                       disabled:opacity-50
                       ${hasError ? 'border-destructive/50 focus:ring-destructive/20' : 'border-border/60 focus:border-primary/50 focus:ring-primary/20'}
            `}
          />
        </div>
        <button
          type="submit"
          disabled={!url.trim() || isResolving}
          className="h-11 px-5 rounded-xl bg-primary hover:bg-primary-hover active:scale-[0.98] text-white text-sm font-semibold
                     transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {isResolving && <Loader2 size={14} className="animate-spin" />}
          {isResolving ? (downloading ? t('import.downloading') : t('import.resolving')) : t('import.submit')}
        </button>
      </form>

      {/* 平台识别 / 预解析状态 */}
      {platformName && (
        <div className="w-full mt-3 flex items-center gap-2 text-[0.6875rem] text-muted-foreground/70">
          {preResolving ? (
            <Loader2 size={10} className="animate-spin text-primary/70" />
          ) : preResolvedTitle ? (
            <CheckCircle2 size={10} className="text-success" />
          ) : null}
          <span className="font-medium text-foreground/60">{platformName}</span>
          {preResolvedTitle && <span className="truncate">· {preResolvedTitle}</span>}
        </div>
      )}

      {/* 下载进度 */}
      {isDownloading && (
        <div className="w-full mt-3">
          <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: downloadProgress ? `${Math.min(downloadPct, 100)}%` : '100%' }}
            />
          </div>
          <p className="text-[0.6875rem] text-muted-foreground/70 mt-1.5 text-center">
            {downloadProgress
              ? `${downloadProgress.status === 'merging' ? t('import.progress.merging') : downloadProgress.status === 'complete' ? t('import.progress.complete') : t('import.progress.downloading', { pct: Math.round(downloadPct) })}${downloadProgress.speed ? ` · ${downloadProgress.speed}` : ''}`
              : t('import.progress.init')}
          </p>
        </div>
      )}

      {/* yt-dlp 安装按钮 */}
      {hasError && resolveError === YTDLP_NOT_INSTALLED && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="text-xs text-destructive text-center">{t('import.ytdlpNotInstalled')}</p>
          <button
            onClick={handleInstallYtDlp}
            disabled={ytDlpDownloading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10
                       border border-border/60 transition-all cursor-pointer disabled:opacity-50"
          >
            {ytDlpDownloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} className="text-primary" />}
            <span className="text-sm font-medium text-foreground/80">{t('import.installYtdlp')}</span>
            <span className="text-[0.625rem] text-muted-foreground/50">{t('import.installHint')}</span>
          </button>
        </div>
      )}

      {/* 错误重试 */}
      {hasError && resolveError !== YTDLP_NOT_INSTALLED && (
        <div className="w-full mt-4 flex flex-col items-center gap-2">
          <p className="text-xs text-destructive text-center">{resolveError}</p>
          <button
            onClick={() => {
              setResolveState('idle')
              setResolveError(null)
            }}
            className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer"
          >
            {t('import.retry')}
          </button>
        </div>
      )}

      {/* 底部：字幕加载 + yt-dlp 状态 */}
      <div className="flex flex-col items-center gap-2 mt-6">
        <button
          onClick={handleOpenSubtitle}
          disabled={isResolving}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground
                     transition-colors cursor-pointer disabled:opacity-40"
        >
          <FileText size={12} />
          {t('import.loadSubtitle')}
        </button>
        {ytDlpAvailable === false && resolveState === 'idle' && !hasError && (
          <p className="text-[0.625rem] text-muted-foreground/40 flex items-center gap-1">
            <AlertCircle size={10} />
            {t('import.ytdlpMissing')}
            <button onClick={handleInstallYtDlp} className="underline hover:text-muted-foreground/70 cursor-pointer">
              {t('import.installNow')}
            </button>
          </p>
        )}
      </div>

      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
      <input ref={subInputRef} type="file" accept=".srt,.vtt,.ass,.ssa" className="hidden" onChange={handleSubFileChange} />
    </div>
  )
}
