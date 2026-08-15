import { useCallback, useRef, useEffect, useState } from 'react'
import { usePlayerStore } from '../../stores/playerStore'
import { useAppStore } from '../../stores/appStore'
import { useNoteStore } from '../../stores/noteStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSubtitle } from '../../hooks/useSubtitle'
import { useScreenshot } from '../../hooks/useScreenshot'
import { OCRService } from '../../services/ocr-service'
import { captureVideoThumbnail } from '../../services/screenshot-engine'
import { VideoControls } from './VideoControls'
import { PlayerToolRail } from './PlayerToolRail'
import { SubtitleOverlay } from '../subtitles/SubtitleOverlay'
import { SubtitleBlocker } from '../subtitles/SubtitleBlocker'
import { Film } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

const ocrInitialized = { current: false }

/**
 * Turn a failed media src into an actionable message instead of the generic
 * "Video failed to load": a blob:/data: src is a file import that a page reload
 * has already killed, and a /media src points at a local file that is gone.
 */
function describeVideoError(t: (key: string) => string, src: string | null): string {
  if (src && (src.startsWith('blob:') || src.startsWith('data:'))) {
    return t('video.error.blob')
  }
  if (src && src.includes('/media/')) {
    return t('video.error.missing')
  }
  return t('video.error.generic')
}

export function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const shadowTimerRef = useRef<number>(0)
  const hoverTimerRef = useRef<number>(0)
  const thumbDoneRef = useRef<string | null>(null)
  // 缩略图 seek 是否已发起（区别于 thumbDoneRef 的「已成功取到帧」）。
  // 首个 canplay 只允许 seek 一次到取帧偏移；若首帧解码慢导致取帧失败，
  // 后续 canplay 也不再重复 seek，避免覆盖 #22/#19 的跳转目标。
  const thumbSeekRef = useRef<string | null>(null)

  const [videoReady, setVideoReady] = useState(false)
  const [videoError, setVideoError] = useState<string | null>(null)

  const { t } = useI18n()
  const videoSrc = usePlayerStore((s) => s.videoSrc)
  const setVideoRef = usePlayerStore((s) => s.setVideoRef)
  const setContainerRef = usePlayerStore((s) => s.setContainerRef)
  const { syncCueIndex } = useSubtitle()
  const { takeSnapshot } = useScreenshot()
  const setSidebarMode = useNoteStore((s) => s.setSidebarMode)
  const setOCRResult = useNoteStore((s) => s.setOCRResult)
  const ocrLanguage = useSettingsStore((s) => s.ocrLanguage)
  const defaultPlaybackRate = useSettingsStore((s) => s.defaultPlaybackRate)

  // Initialize OCR service once
  useEffect(() => {
    if (!ocrInitialized.current) {
      ocrInitialized.current = true
      OCRService.init((result) => {
        setOCRResult(result.snapshotId, result.text)
      }, ocrLanguage)
    }
    return () => {
      // Cancel pending timers on unmount
      clearTimeout(shadowTimerRef.current)
      clearTimeout(hoverTimerRef.current)
    }
  }, [setOCRResult, ocrLanguage])

  useEffect(() => {
    if (videoRef.current) setVideoRef(videoRef.current)
    return () => setVideoRef(null)
  }, [videoSrc, setVideoRef])

  // 全屏 #3：把容器 ref 交给 store（setFullscreen 对它 requestFullscreen）；
  // 并同步 native fullscreenchange，保证 Escape/失败后 isFullscreen 与真实状态一致。
  useEffect(() => {
    setContainerRef(containerRef.current)
    return () => setContainerRef(null)
  }, [setContainerRef])

  useEffect(() => {
    const onFsChange = () => usePlayerStore.getState().setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Reset ready/error state when video source changes
  useEffect(() => {
    setVideoReady(false)
    setVideoError(null)
    thumbDoneRef.current = null
    thumbSeekRef.current = null
  }, [videoSrc])

  // 从「待复习生词」「搜索生词」等入口跳到指定时间戳：等视频就绪后应用并清空。
  // 用短延迟避开自动缩略图 capture 的 seek；若媒体管线吞掉 seek（离屏/首帧未稳时偶发，
  // currentTime 未落点且未进入 seeking），200ms 后重试，最多 3 次，避免跳转静默失效。
  useEffect(() => {
    if (!videoReady) return
    const pending = usePlayerStore.getState().pendingSeekTime
    if (pending == null) return
    const el = videoRef.current
    if (!el) return

    let attempts = 0
    let timer: number | undefined

    const step = (delay: number) => {
      timer = window.setTimeout(() => {
        const st = usePlayerStore.getState()
        const target = st.pendingSeekTime
        if (target == null) return
        attempts += 1
        try { el.currentTime = target } catch { /* ignore */ }
        st.setCurrentTime(target)
        const landed = Math.abs(el.currentTime - target) <= 1.5
        if (attempts < 3 && !landed && !el.seeking) {
          step(200) // seek 被吞，稍后重试
        } else {
          st.setPendingSeekTime(null)
          st.play()
        }
      }, delay)
    }

    step(250)
    return () => { if (timer) clearTimeout(timer) }
  }, [videoReady])

  // Guard against infinite "Loading video..." — if the media never becomes
  // playable within 15s, surface an error instead of hanging silently.
  useEffect(() => {
    if (!videoSrc || videoReady) return
    const timer = window.setTimeout(() => {
      setVideoError(describeVideoError(t, videoSrc))
    }, 15000)
    return () => clearTimeout(timer)
  }, [videoSrc, videoReady, t])

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      syncCueIndex(videoRef.current.currentTime)
      usePlayerStore.getState().setCurrentTime(videoRef.current.currentTime)
    }
  }, [syncCueIndex])

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) usePlayerStore.getState().setDuration(videoRef.current.duration)
  }, [])

  const captureThumbnail = useCallback(() => {
    const el = videoRef.current
    const st = usePlayerStore.getState()
    const hash = st.videoHash
    if (!el || !hash || thumbDoneRef.current === hash) return
    // drawImage/toDataURL can throw on a tainted canvas (e.g. CORS failure) —
    // swallow it so capture is best-effort and never breaks playback.
    let dataUrl: string | null = null
    try { dataUrl = captureVideoThumbnail(el) } catch { dataUrl = null }
    if (dataUrl) {
      thumbDoneRef.current = hash
      useAppStore.getState().setVideoThumbnail(hash, dataUrl)
    }
    // Return to the start so playback begins at 0 (the capture seek was only for the frame).
    // 但不要覆盖用户的跳转目标：#22/#19 从搜索/单词本跳到时间戳时，pendingSeekTime 尚未消费，
    // 或当前时间已被跳转落位（远大于抓图偏移 ≤1s）——这两种情况都跳过归位，避免跳转被重置回 0。
    if (st.pendingSeekTime == null && el.currentTime <= 1.5) {
      try { el.currentTime = 0 } catch { /* ignore */ }
    }
  }, [])

  const handleCanPlay = useCallback(() => {
    setVideoReady(true)
    setVideoError(null)
    const st = usePlayerStore.getState()
    const el = videoRef.current
    // 应用「播放默认倍速」：每加载一个新视频套一次默认倍速（手动调速会被下次加载重置回默认）
    if (el && defaultPlaybackRate !== 1) {
      el.playbackRate = defaultPlaybackRate
      st.setPlaybackRate(defaultPlaybackRate)
    }
    // Nudge to a non-black frame so the cover isn't a blank first frame, then capture it.
    const hash = st.videoHash
    if (!el || !hash || thumbSeekRef.current === hash) return
    thumbSeekRef.current = hash
    // Duration can be NaN on some sources (blob:/streaming) — fall back to 1s so
    // we don't capture a black frame at time 0. Seeking always fires onSeeked,
    // which is what actually captures the thumbnail.
    const dur = el.duration
    const offset = Number.isFinite(dur) && dur > 0 ? Math.min(1, dur * 0.05) : 1
    try { el.currentTime = offset } catch { captureThumbnail() }
  }, [captureThumbnail, defaultPlaybackRate])

  const handleSeeked = useCallback(() => {
    captureThumbnail()
  }, [captureThumbnail])

  const handleVideoError = useCallback(() => {
    setVideoError(describeVideoError(t, videoSrc))
  }, [videoSrc, t])

  const handleSnapshot = useCallback(async () => {
    const snapshotId = await takeSnapshot()
    if (snapshotId && containerRef.current) {
      // Flash feedback
      clearTimeout(shadowTimerRef.current)
      containerRef.current.style.boxShadow = 'inset 0 0 100px rgba(129, 140, 248, 0.25)'
      shadowTimerRef.current = window.setTimeout(() => {
        if (containerRef.current) containerRef.current.style.boxShadow = ''
      }, 200)

      // Briefly show sidebar
      setSidebarMode('narrow')
      useNoteStore.getState().setSidebarHovered(true)
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = window.setTimeout(() => {
        useNoteStore.getState().setSidebarHovered(false)
      }, 2000)
    }
  }, [takeSnapshot, setSidebarMode])

  if (!videoSrc) return null

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center bg-black
                 transition-shadow duration-150 ease-out group"
    >
      {/* Loading shimmer — only shown before video is ready */}
      {!videoReady && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-b from-background via-foreground/10 to-background">
          {videoError ? (
            <div className="flex flex-col items-center gap-3 animate-fade-in max-w-sm text-center px-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-destructive/20 to-destructive/10
                              flex items-center justify-center border border-destructive/10">
                <Film size={28} className="text-destructive/60" />
              </div>
              <span className="text-xs text-muted-foreground">{videoError}</span>
              <button
                onClick={() => {
                  setVideoError(null)
                  const el = videoRef.current
                  if (el) { el.load(); el.play().catch(() => {}) }
                }}
                className="px-4 py-2 rounded-lg bg-primary/15 hover:bg-primary/25 border border-primary/20
                           text-xs text-primary font-medium transition-colors cursor-pointer"
              >
                {t('video.tryAgain')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 animate-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-chart-3/20
                              flex items-center justify-center border border-primary/10">
                <Film size={28} className="text-primary/60" />
              </div>
              <span className="text-xs text-muted-foreground animate-pulse-soft">{t('video.loading')}</span>
            </div>
          )}
        </div>
      )}

      <video
        ref={videoRef}
        src={videoSrc}
        className="max-w-full max-h-full object-contain relative z-10"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={handleCanPlay}
        onSeeked={handleSeeked}
        onError={handleVideoError}
        crossOrigin="anonymous"
        onClick={() => {
          const { isPlaying, play, pause } = usePlayerStore.getState()
          isPlaying ? pause() : play()
        }}
      />

      <SubtitleOverlay />
      <SubtitleBlocker />
      <PlayerToolRail />
      <VideoControls onSnapshot={handleSnapshot} />
    </div>
  )
}
