import { useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useVocabularyStore } from '../../stores/vocabularyStore'
import { useI18n } from '../../i18n/useI18n'
import { simpleHash } from '../../lib/hash'
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
 * - 显示「最近播放」视频的封面 + 标题；
 * - 该视频没有生词时提示「当前没有生词哦」；
 * - 有生词时点「生成」拼接触发剪辑，成功后覆盖以前的剪辑（删除旧视频文件与旧记录）。
 */
export function AutoClipSection({ onOpenVideo }: AutoClipSectionProps) {
  const { videos, lastVideoHash, registerVideo, removeVideo, markOpened } = useAppStore()
  const words = useVocabularyStore((s) => s.words)
  const { t } = useI18n()

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 最近播放的源视频（排除剪辑产物自身；优先 lastVideoHash，否则按 lastOpenedAt 取最新）。
  const source = useMemo<VideoMeta | null>(() => {
    if (lastVideoHash) {
      const v = videos[lastVideoHash]
      if (v && !v.isReviewClip) return v
    }
    const candidates = Object.values(videos)
      .filter((v) => !v.isReviewClip && v.lastOpenedAt > 0)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    return candidates[0] ?? null
  }, [videos, lastVideoHash])

  // 该源视频下保存的生词（#7 已合并去重，一个词一条）。
  const sourceWords = useMemo(
    () => (source ? words.filter((w) => w.videoHash === source.hash) : []),
    [words, source],
  )

  // 已存在的剪辑记录（覆盖旧剪辑时识别 + 删除）。
  const existingClip = useMemo(
    () => Object.values(videos).find((v) => v.isReviewClip) ?? null,
    [videos],
  )

  const electron = !!(window as any).electronAPI

  const generate = async () => {
    if (!source) return
    if (electron) { setError(t('reviewClip.electronUnsupported')); return }
    if (sourceWords.length === 0) return

    setGenerating(true)
    setError(null)
    try {
      // 覆盖旧剪辑：先删掉磁盘上的旧文件 + 注册表里的旧记录。
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

      registerVideo({
        hash: simpleHash(data.filePath),
        filePath: data.filePath,
        fileName: `${t('reviewClip.name')} · ${source.fileName}`,
        duration: data.duration || 0,
        lastPlayedTime: 0,
        lastOpenedAt: Date.now(),
        isReviewClip: true,
      })
      // 生成剪辑不应顶掉「继续学习」目标——把 lastVideoHash 还原到源视频。
      markOpened(source.hash)
    } catch (err) {
      const msg = (err as Error)?.message
      if (msg === 'no_local_file') setError(t('reviewClip.noLocalFile'))
      else if (msg === 'no_clippable_segments') setError(t('reviewClip.noWords'))
      else setError(t('reviewClip.failed'))
    } finally {
      setGenerating(false)
    }
  }

  const hasWords = sourceWords.length > 0

  return (
    <div className="space-y-5">
      {/* 标题 */}
      <div>
        <h2 className="text-[1.125rem] font-semibold tracking-tight text-foreground">
          {t('reviewClip.title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('reviewClip.subtitle')}</p>
      </div>

      {/* 最近播放视频卡片 */}
      {source ? (
        <div className="grid gap-4 sm:grid-cols-[240px_1fr]">
          <Cover video={source} label={t('reviewClip.sourceLabel')} />
          <div className="flex flex-col justify-center min-w-0">
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
              {t('reviewClip.sourceLabel')}
            </p>
            <h3 className="mt-1.5 text-lg font-semibold leading-snug text-foreground truncate">{source.fileName}</h3>
            <div className="mt-2 flex items-center gap-2">
              <BookMarked size={14} className="text-primary/70" />
              <span className="text-sm text-muted-foreground">
                {hasWords ? t('reviewClip.wordCount', { n: sourceWords.length }) : t('reviewClip.noWords')}
              </span>
            </div>
            {/* 生成按钮：无生词时禁用并提示 */}
            <div className="mt-4">
              <button
                onClick={generate}
                disabled={generating || !hasWords || electron}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-[10px] bg-primary hover:bg-primary-hover
                           active:scale-[0.98] text-white text-sm font-semibold transition-all cursor-pointer
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? <Loader2 size={15} className="animate-spin" /> : <Scissors size={15} />}
                {generating
                  ? t('reviewClip.building')
                  : existingClip
                    ? t('reviewClip.regenerate')
                    : t('reviewClip.generate')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
          <Film size={22} className="mx-auto text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">{t('reviewClip.noVideo')}</p>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-sm text-destructive">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">{error}</div>
        </div>
      )}

      {/* 已生成的复习视频 */}
      {existingClip && (
        <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
          <div className="grid gap-4 sm:grid-cols-[240px_1fr] p-4">
            <Cover video={existingClip} label={t('reviewClip.name')} />
            <div className="flex flex-col justify-center min-w-0">
              <p className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
                {t('reviewClip.name')}
              </p>
              <h3 className="mt-1.5 text-base font-semibold leading-snug text-foreground truncate">{existingClip.fileName}</h3>
              <div className="mt-4">
                <button
                  onClick={() => onOpenVideo(existingClip.hash)}
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-[10px] bg-primary hover:bg-primary-hover
                             active:scale-[0.98] text-white text-sm font-semibold transition-all cursor-pointer"
                >
                  <Play size={15} /> {t('reviewClip.play')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
