import { useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useVocabularyStore } from '../../stores/vocabularyStore'
import { useI18n } from '../../i18n/useI18n'
import { simpleHash } from '../../lib/hash'
import { VideoOcrRegionStorage } from '../../services/storage-service'
import { Play, Loader2, Scissors, Film, BookMarked, AlertCircle } from 'lucide-react'
import type { VideoMeta } from '@shared/types'

// 与 Dashboard 一致的氛围底映射，按视频 hash 稳定取色。
const THUMBS = ['thumb-nature', 'thumb-movie', 'thumb-conversation', 'thumb-space', 'thumb-animation', 'thumb-city']
function thumbClass(hash: string): string {
  let n = 0
  for (let i = 0; i < hash.length; i++) n = (n + hash.charCodeAt(i)) % THUMBS.length
  return THUMBS[n]
}

/** 封面：有截图用截图，否则用氛围底色 + 播放角标。 */
function Cover({ video, label }: { video: VideoMeta; label: string }) {
  return (
    <div className={`thumb aspect-video w-full rounded-xl ${thumbClass(video.hash)}`}>
      <span className="grain" />
      {video.thumbnailDataUrl && (
        <img src={video.thumbnailDataUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="w-11 h-11 rounded-full bg-white/90 text-black flex items-center justify-center">
          <Play size={16} />
        </span>
      </span>
      <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-0.5 text-[0.625rem] font-medium text-white/85">
        {label}
      </span>
    </div>
  )
}

interface AutoClipSectionProps {
  onOpenVideo: (hash: string) => void
}

/**
 * #10 自动剪辑复习视频 —— 独立的顶层栏目（与单词本/最近学习同级别）。
 *
 * - 显示所有看过的视频，分别选择来源；
 * - 该视频没有生词时提示「当前没有生词哦」；
 * - 有生词时点「生成」拼接触发剪辑，只覆盖当前来源视频自己的旧剪辑。
 */
export function AutoClipSection({ onOpenVideo }: AutoClipSectionProps) {
  const { videos, registerVideo, removeVideo, markOpened } = useAppStore()
  const words = useVocabularyStore((s) => s.words)
  const { t } = useI18n()

  const [generatingHash, setGeneratingHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 所有看过的源视频，按最近打开时间排列。复习视频本身不作为源视频。
  const sources = useMemo(() => {
    const candidates = Object.values(videos)
      .filter((v) => !v.isReviewClip && v.lastOpenedAt > 0)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    return candidates
  }, [videos])

  const clipFor = (sourceHash: string) =>
    Object.values(videos).find((v) => v.isReviewClip && v.reviewSourceHash === sourceHash) ?? null

  const electron = !!(window as any).electronAPI

  const generate = async (source: VideoMeta) => {
    if (electron) { setError(t('reviewClip.electronUnsupported')); return }
    const sourceWords = words.filter((w) => w.videoHash === source.hash)
    if (sourceWords.length === 0) return
    const existingClip = clipFor(source.hash)

    setGeneratingHash(source.hash)
    setError(null)
    try {
      // 只覆盖当前视频自己的旧剪辑，其他源视频的复习视频保持不变。
      if (existingClip) {
        try {
          await fetch(`/api/review-clip?file=${encodeURIComponent(existingClip.filePath)}`, { method: 'DELETE' })
        } catch { /* 删除旧文件失败不阻断生成，仅提示 */ }
        removeVideo(existingClip.hash)
      }

      const res = await fetch('/api/review-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePath: source.filePath,
          // VideoMeta.duration 恒 0，交给后端按时间戳窗口抽取（临近片尾会被 ffmpeg 自然截断）。
          duration: source.duration || 0,
          segments: sourceWords.map((w) => ({ word: w.word, t: w.videoTimestamp })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.filePath) throw new Error(data.error || 'clip failed')

      const clipHash = simpleHash(data.filePath)
      registerVideo({
        hash: clipHash,
        filePath: data.filePath,
        fileName: `${t('reviewClip.name')} · ${source.fileName}`,
        duration: data.duration || 0,
        lastPlayedTime: 0,
        lastOpenedAt: Date.now(),
        isReviewClip: true,
        reviewSourceHash: source.hash,
        reviewSegments: Array.isArray(data.segments) ? data.segments : [],
      })
      // Carry the source's visual regions to the clip. The clip can then be
      // fine-tuned independently without losing the source defaults.
      const sourceOcrRegion = VideoOcrRegionStorage.load(source.hash)
      if (sourceOcrRegion) VideoOcrRegionStorage.save(clipHash, sourceOcrRegion)
      // 生成剪辑不应顶掉「继续学习」目标——把 lastVideoHash 还原到源视频。
      markOpened(source.hash)
    } catch (err) {
      const msg = (err as Error)?.message
      if (msg === 'no_local_file') setError(t('reviewClip.noLocalFile'))
      else if (msg === 'no_clippable_segments') setError(t('reviewClip.noWords'))
      else {
        // Keep the friendly label, but include the server's concrete reason so
        // local failures (missing file, FFmpeg input/codec errors, etc.) are
        // diagnosable instead of collapsing into the same generic message.
        const detail = msg && msg !== 'clip failed' ? `: ${msg}` : ''
        setError(`${t('reviewClip.failed')}${detail}`)
      }
    } finally {
      setGeneratingHash(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[1.125rem] font-semibold tracking-tight text-foreground">{t('reviewClip.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('reviewClip.subtitle')}</p>
      </div>

      {sources.length > 0 ? sources.map((source) => {
        const sourceWords = words.filter((w) => w.videoHash === source.hash)
        const existingClip = clipFor(source.hash)
        const isGenerating = generatingHash === source.hash
        const hasWords = sourceWords.length > 0
        return (
          <section key={source.hash} className="rounded-2xl border border-border/50 bg-card/40 overflow-hidden">
            {/* 原视频 */}
            <div className="grid gap-4 sm:grid-cols-[220px_1fr] p-4">
              <Cover video={source} label={t('reviewClip.sourceLabel')} />
              <div className="flex flex-col justify-center min-w-0">
                <p className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">{t('reviewClip.sourceLabel')}</p>
                <h3 className="mt-1.5 text-base font-semibold leading-snug text-foreground truncate">{source.fileName}</h3>
                <div className="mt-2 flex items-center gap-2">
                  <BookMarked size={14} className="text-primary/70" />
                  <span className="text-sm text-muted-foreground">
                    {hasWords ? t('reviewClip.wordCount', { n: sourceWords.length }) : t('reviewClip.noWords')}
                  </span>
                </div>
                <div className="mt-3">
                  <button
                    onClick={() => generate(source)}
                    disabled={!!generatingHash || !hasWords || electron}
                    className="inline-flex items-center gap-2 h-9 px-4 rounded-[10px] bg-primary hover:bg-primary-hover
                               active:scale-[0.98] text-white text-xs font-semibold transition-all cursor-pointer
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                    {isGenerating ? t('reviewClip.building') : existingClip ? t('reviewClip.regenerate') : t('reviewClip.generate')}
                  </button>
                </div>
              </div>
            </div>

            {/* 绑定的复习视频，紧跟在对应原视频下方 */}
            <div className="border-t border-border/40 bg-background/20 p-3 sm:pl-4">
              {existingClip ? (
                <div className="grid gap-3 sm:grid-cols-[120px_1fr] items-center">
                  <Cover video={existingClip} label={t('reviewClip.name')} />
                  <div className="min-w-0">
                    <p className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">{t('reviewClip.name')}</p>
                    <h4 className="mt-1 text-sm font-medium text-foreground truncate">{existingClip.fileName}</h4>
                    <button
                      onClick={() => onOpenVideo(existingClip.hash)}
                      className="mt-2 inline-flex items-center gap-1.5 h-7 px-3 rounded-lg bg-primary/90 hover:bg-primary text-white text-[0.6875rem] font-semibold transition-colors cursor-pointer"
                    >
                      <Play size={12} /> {t('reviewClip.play')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                  <Film size={14} /> {t('reviewClip.notGenerated')}
                </div>
              )}
            </div>
          </section>
        )
      }) : (
        <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
          <Film size={22} className="mx-auto text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">{t('reviewClip.noVideo')}</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-sm text-destructive">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">{error}</div>
        </div>
      )}
    </div>
  )
}
