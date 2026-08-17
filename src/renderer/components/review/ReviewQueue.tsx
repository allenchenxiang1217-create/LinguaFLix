import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVocabularyStore, occurrencesOf } from '../../stores/vocabularyStore'
import { useReviewStore } from '../../stores/reviewStore'
import { useAppStore } from '../../stores/appStore'
import { useWordGlosses } from '../../services/dict-gloss'
import { getSnapshotImage, readSnapshotImage } from '../../services/storage-service'
import { formatTime } from '../../lib/time'
import { useI18n } from '../../i18n/useI18n'
import { BookOpen, CheckCircle2, Clock, Image as ImageIcon, Layers, Loader2, Play, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { deleteWordCompletely } from '../../services/deletion'
import { getProvider, normalizeBaseUrl } from '../../services/ai-providers'
import { streamOpenAI, streamClaude } from '../../services/ai-stream'
import { useSettingsStore } from '../../stores/settingsStore'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import type { VocabWord } from '@shared/types'

interface ReviewQueueProps {
  /** 顶栏搜索词（review 视图下过滤生词） */
  search: string
  /** 跳到生词所在视频的指定时间戳 */
  onOpenVideoAt: (hash: string, timestamp: number) => void
  /** 空状态「去笔记看看」 */
  onOpenNotes: () => void
}

/** 生词列表的列：多选框 | 截图缩略图 | 生词+释义 | 备注（可编辑） | 状态 | 下次复习 | 视频。 */
const COLS = 'grid grid-cols-[28px_60px_minmax(0,1.1fr)_minmax(0,1fr)_96px_88px_112px] items-center gap-3'
/** #8 未进入「选择」模式时不显示多选框，去掉首列 28px。 */
const COLS_NO_SELECT = 'grid grid-cols-[60px_minmax(0,1.1fr)_minmax(0,1fr)_96px_88px_112px] items-center gap-3'

/** 展开详情里的一行：左侧 label + 右侧文本（可换行）。 */
function DetailRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex gap-3 text-[0.8125rem] leading-relaxed">
      <span className="w-[64px] shrink-0 text-xs font-medium text-muted-foreground/70 pt-0.5">{label}</span>
      <p className="text-foreground/85 whitespace-pre-wrap break-words min-w-0">{text}</p>
    </div>
  )
}

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string

/** 截图放大遮罩：列表缩略图与闪卡背面缩略图共用。 */
function LightboxOverlay({
  lightbox,
  onClose,
  t,
}: {
  lightbox: { dataUrl: string; word: string } | null
  onClose: () => void
  t: TranslateFn
}) {
  if (!lightbox) return null
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm grid place-items-center p-8"
      onClick={onClose}
    >
      <div
        className="max-w-3xl w-full rounded-2xl overflow-hidden border border-border/60 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={lightbox.dataUrl}
          alt={lightbox.word}
          className="w-full max-h-[68vh] object-contain bg-black"
        />
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold text-foreground">{lightbox.word}</p>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-medium
                       text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors cursor-pointer"
          >
            <X size={14} /> {t('review.collapse')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ReviewQueue({ search, onOpenVideoAt, onOpenNotes }: ReviewQueueProps) {
  const words = useVocabularyStore((s) => s.words)
  const reviewWord = useVocabularyStore((s) => s.reviewWord)
  const updateWordNote = useVocabularyStore((s) => s.updateWordNote)
  const { t } = useI18n()

  // 复习会话状态放 reviewStore：跳到播放器（Dashboard 卸载）再返回时原样恢复。
  const mode = useReviewStore((s) => s.mode)
  const queue = useReviewStore((s) => s.queue)
  const idx = useReviewStore((s) => s.idx)
  const flipped = useReviewStore((s) => s.flipped)
  const remembered = useReviewStore((s) => s.remembered)
  const done = useReviewStore((s) => s.done)
  const setFlipped = useReviewStore((s) => s.setFlipped)

  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  // #4 闪卡 AI 分析：按下「AI 分析」按键才开始流式分析，结果写回该词。
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiAbortRef = useRef<AbortController | null>(null)

  const analyzeWord = useCallback(async (w: VocabWord) => {
    const st = useSettingsStore.getState()
    const p = getProvider(st.aiProvider)
    const ov = st.aiOverrides[p.id] ?? {}
    const apiKey = ov.apiKey ?? ''
    const baseUrl = normalizeBaseUrl(ov.baseUrl || p.baseUrl)
    if (!apiKey) { setAiError(t('ai.needKey')); return }
    if (!st.aiModel.trim()) { setAiError(t('ai.needModel')); return }

    aiAbortRef.current?.abort()
    const controller = new AbortController()
    aiAbortRef.current = controller
    setAiBusy(true); setAiError(null)

    let acc = ''
    const opts = {
      word: w.word,
      sentence: w.contextSentence || w.word,
      ctxBefore: '',
      ctxAfter: '',
      onChunk: (c: string) => {
        // 流式 delta 累积后实时写入队列快照，当前卡背面即时显示；最终落库走 vocabularyStore。
        acc += c
        useReviewStore.getState().setWordAnalysis(w.id, acc)
      },
      signal: controller.signal,
      language: st.language,
      t,
    }
    try {
      if (p.type === 'openai') await streamOpenAI(baseUrl, apiKey, st.aiModel.trim(), opts)
      else await streamClaude(baseUrl, apiKey, st.aiModel.trim(), opts)
      useVocabularyStore.getState().setWordAiAnalysis(w.id, acc)
    } catch (err: any) {
      if (err.name !== 'AbortError') setAiError(err.message || t('ai.failed'))
    } finally {
      setAiBusy(false)
      if (aiAbortRef.current === controller) aiAbortRef.current = null
    }
  }, [t])

  const now = new Date().toISOString()
  const dueCount = words.filter((w) => w.sm2.dueDate <= now).length

  // 中文释义：全部词一次性按需解析（缓存命中即时返回，未命中查询后写回）。
  const wordKeys = useMemo(() => words.map((w) => w.word), [words])
  const glosses = useWordGlosses(wordKeys)

  // 列表按下次复习时间排序：待复习（今天）在前，然后按日期递增。
  const sorted = useMemo(
    () =>
      [...words].sort(
        (a, b) => new Date(a.sm2.dueDate).getTime() - new Date(b.sm2.dueDate).getTime(),
      ),
    [words],
  )

  const q = search.trim().toLowerCase()
  const filtered = q
    ? sorted.filter(
        (w) =>
          w.word.toLowerCase().includes(q) ||
          (glosses[w.word.toLowerCase()] ?? '').toLowerCase().includes(q),
      )
    : sorted

  // 待复习/已掌握 分类过滤（all | due | mastered）
  const [reviewFilter, setReviewFilter] = useState<'all' | 'due' | 'mastered'>('all')

  // 待复习/已掌握 分类过滤：在搜索/排序之后、分组之前应用。
  const categoryFiltered =
    reviewFilter === 'due'
      ? filtered.filter((w) => w.sm2.dueDate <= now)
      : reviewFilter === 'mastered'
        ? filtered.filter((w) => (w.sm2?.repetition ?? 0) >= 3)
        : filtered

  // The flashcard session must use the currently visible category. In
  // particular, "Mastered" may contain no words that are due today.
  const reviewCandidates = categoryFiltered.filter((w) => w.sm2.dueDate <= now)

  // 顶部三统计（与列表展示同源，直接从 words 推导）
  const masteredCount = words.filter((w) => (w.sm2?.repetition ?? 0) >= 3).length
  const totalDays = useMemo(() => {
    const dates = new Set<string>()
    for (const w of words) {
      if (w.reviewedAt) dates.add(new Date(w.reviewedAt).toDateString())
    }
    return dates.size
  }, [words])

  // 按视频分组：组序按视频最近打开时间倒序，组内保持时间顺序。
  const videos = useAppStore((s) => s.videos)
  const [groupByVideo, setGroupByVideo] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ dataUrl: string; word: string } | null>(null)
  // 备注列行内编辑：记录正在编辑的词 id + 草稿。
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  // #1 删除生词：确认悬浮窗（删除不可撤销，级联清理快照副本 + 孤儿截图缓存）
  const [pendingDelete, setPendingDelete] = useState<VocabWord | null>(null)
  // #2 删除多选：勾选多个单词批量删除（选中集合 + 批量删除确认）。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false)
  // #8 多选框默认隐藏，点「选择」后才显示（勾选框不常态化显现）。
  const [selectMode, setSelectMode] = useState(false)
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }
  // #3 缩略图兜底：localStorage 缩略图缺失时，异步从磁盘读全尺寸补上（snapshotId → dataUrl）。
  const [resolvedThumbs, setResolvedThumbs] = useState<Record<string, string>>({})
  const resolvedThumbsRef = useRef<Record<string, string>>({})
  const attemptedThumbsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    // #7 合并后一个词可能跨多张截图：解析主出处 + 全部其它出处的缩略图。
    const pending: Array<{ snapshotId: string; videoHash: string }> = []
    for (const w of filtered) {
      if (w.snapshotId) pending.push({ snapshotId: w.snapshotId, videoHash: w.videoHash })
      for (const o of occurrencesOf(w)) {
        if (o.snapshotId && o.snapshotId !== w.snapshotId) {
          pending.push({ snapshotId: o.snapshotId, videoHash: o.videoHash })
        }
      }
    }
    for (const { snapshotId, videoHash } of pending) {
      if (attemptedThumbsRef.current.has(snapshotId)) continue
      attemptedThumbsRef.current.add(snapshotId)
      if (getSnapshotImage(snapshotId)) continue
      readSnapshotImage(snapshotId, videoHash).then((full) => {
        if (cancelled || !full) return
        if (resolvedThumbsRef.current[snapshotId]) return
        resolvedThumbsRef.current[snapshotId] = full
        setResolvedThumbs((prev) => ({ ...prev, [snapshotId]: full }))
      })
    }
    return () => { cancelled = true }
  }, [filtered])

  const saveNote = (id: string) => {
    updateWordNote(id, noteDraft.trim())
    setEditingNoteId(null)
  }

  /** #1 删除生词：确认悬浮窗；级联清理快照副本 + 孤儿截图缓存。 */
  const confirmDeleteWord = () => {
    if (!pendingDelete) return
    const w = pendingDelete
    setPendingDelete(null)
    deleteWordCompletely({ id: w.id, snapshotId: w.snapshotId, videoHash: w.videoHash })
  }

  // ── #2 删除多选 ──
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (prev.size === categoryFiltered.length && categoryFiltered.length > 0) return new Set<string>()
      return new Set(categoryFiltered.map((w) => w.id))
    })
  }

  const confirmBulkDelete = async () => {
    const targets = words.filter((w) => selectedIds.has(w.id))
    await Promise.all(targets.map((w) => deleteWordCompletely({ id: w.id, snapshotId: w.snapshotId, videoHash: w.videoHash })))
    setSelectedIds(new Set())
    setPendingBulkDelete(false)
  }

  const grouped = useMemo(() => {
    if (!groupByVideo) return null
    const map = new Map<string, VocabWord[]>()
    for (const w of categoryFiltered) {
      const arr = map.get(w.videoHash) ?? []
      arr.push(w)
      map.set(w.videoHash, arr)
    }
    return [...map.entries()].sort((a, b) => {
      const ta = videos[a[0]]?.lastOpenedAt ?? 0
      const tb = videos[b[0]]?.lastOpenedAt ?? 0
      return tb - ta
    })
  }, [categoryFiltered, groupByVideo, videos])

  /** 点缩略图放大：有 filePath 从磁盘读全尺寸，否则回退 localStorage 缩略图。 */
  const openLightbox = async (w: VocabWord) => {
    const full = w.snapshotId ? await readSnapshotImage(w.snapshotId, w.videoHash) : null
    if (full) setLightbox({ dataUrl: full, word: w.word })
  }

  /** 点某条出处的缩略图放大（#7 合并后一个词可跨多帧）。 */
  const openLightboxAt = async (snapshotId: string, videoHash: string, word: string) => {
    const full = snapshotId ? await readSnapshotImage(snapshotId, videoHash) : null
    if (full) setLightbox({ dataUrl: full, word })
  }

  /** #7 封面出处：最早、且视频仍存在的出处（否则回退主字段）。 */
  const coverOcc = (w: VocabWord): { snapshotId: string; videoHash: string } => {
    const occs = [...occurrencesOf(w)].sort((a, b) => a.createdAt - b.createdAt)
    for (const o of occs) {
      if (o.snapshotId && o.videoHash && videos[o.videoHash]) return o
    }
    return { snapshotId: w.snapshotId, videoHash: w.videoHash }
  }

  /** 生词行：缩略图可点放大、视频按钮醒目、点击行任意处展开完整释义/原句/AI/备注。 */
  const renderWordRows = (list: VocabWord[]) => (
    <>
      {list.map((w) => {
        const isDue = w.sm2.dueDate <= now
        const gloss = glosses[w.word.toLowerCase()] ?? ''
        // #7 合并：按记录时间排序的出处 + 被记录次数（跨视频/跨帧）。
        const occs = [...occurrencesOf(w)].sort((a, b) => a.createdAt - b.createdAt)
        const count = w.recordCount ?? occs.length
        const co = coverOcc(w)
        const thumb = co.snapshotId ? (getSnapshotImage(co.snapshotId) || resolvedThumbs[co.snapshotId] || null) : null
        const isOpen = expandedId === w.id
        return (
          <div key={w.id} className="border-t border-border/40">
            <div
              onClick={() => setExpandedId(isOpen ? null : w.id)}
              className={`${selectMode ? COLS : COLS_NO_SELECT} px-4 py-3 transition-colors hover:bg-foreground/5 cursor-pointer`}
              role="button"
              aria-expanded={isOpen}
            >
              {/* #2 多选框（#8 仅「选择」模式下显示） */}
              {selectMode && (
                <span className="justify-self-center" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(w.id)}
                    onChange={() => toggleSelect(w.id)}
                    aria-label={`${t('review.colWord')} ${w.word}`}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  />
                </span>
              )}
              {/* 截图缩略图：点按放大 */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (thumb) openLightboxAt(co.snapshotId, co.videoHash, w.word)
                }}
                className="w-[52px] h-[38px] rounded-lg overflow-hidden border border-border/40 bg-foreground/5 shrink-0 cursor-pointer"
                aria-label={`${t('review.colSnapshot')} · ${w.word}`}
              >
                {thumb ? (
                  <img src={thumb} alt={w.word} className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full grid place-items-center text-muted-foreground/40">
                    <ImageIcon size={15} />
                  </span>
                )}
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-[1.0625rem] font-semibold leading-[1.3] text-foreground truncate">
                    {w.word}
                  </p>
                  {count > 1 && (
                    <span className="shrink-0 inline-flex items-center h-[18px] px-1.5 rounded-full text-[0.625rem] font-semibold text-primary bg-primary/10">
                      {t('review.recordedTimes', { n: count })}
                    </span>
                  )}
                </div>
                <p className="text-[0.8125rem] text-muted-foreground mt-0.5 truncate">
                  {gloss || ' '}
                </p>
              </div>
              {/* 备注列：点击进入行内编辑（Enter/blur 保存，Esc 取消） */}
              <span className="min-w-0" onClick={(e) => e.stopPropagation()}>
                {editingNoteId === w.id ? (
                  <input
                    autoFocus
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onBlur={() => saveNote(w.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveNote(w.id)
                      else if (e.key === 'Escape') setEditingNoteId(null)
                    }}
                    placeholder={t('review.addNote')}
                    className="w-full h-8 px-2.5 rounded-lg bg-background/60 border border-primary/40 text-[0.8125rem]
                               text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/40"
                  />
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingNoteId(w.id); setNoteDraft(w.userNote || '') }}
                    className={`w-full max-w-full text-left h-8 px-2.5 rounded-lg border text-[0.8125rem] truncate transition-colors cursor-pointer
                      ${w.userNote
                        ? 'text-foreground/85 border-transparent hover:border-border/60 hover:bg-foreground/5'
                        : 'text-muted-foreground/45 border-dashed border-border/50 hover:text-muted-foreground hover:border-border'
                      }`}
                    title={w.userNote || t('review.addNote')}
                  >
                    {w.userNote || t('review.addNote')}
                  </button>
                )}
              </span>
              <span className="min-w-0">
                {isDue && (
                  <span className="inline-flex h-[22px] items-center px-2.5 rounded-full text-xs font-semibold
                                   bg-[#ff9f0a]/15 text-[#ff9f0a]">
                    {t('review.dueTag')}
                  </span>
                )}
              </span>
              <span
                className={`text-[0.8125rem] whitespace-nowrap ${
                  isDue ? 'font-medium text-foreground/80' : 'text-muted-foreground'
                }`}
              >
                {formatNextReview(w)}
              </span>
              <span className="justify-self-end flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openVideoFromReview(w.videoHash, w.videoTimestamp)
                  }}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary/10 text-primary
                             hover:bg-primary hover:text-white transition-colors cursor-pointer"
                  aria-label={`${t('review.watchVideo')} ${w.word}`}
                >
                  <Play size={13} />
                  <span className="text-[0.8125rem] tabular-nums font-semibold">
                    {formatTime(w.videoTimestamp)}
                  </span>
                </button>
                {/* #1 删除生词：确认悬浮窗 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingDelete(w)
                  }}
                  title={t('notes.deleteWordHint')}
                  className="inline-flex items-center justify-center w-7 h-8 rounded-lg transition-colors cursor-pointer text-muted-foreground/35 hover:text-destructive hover:bg-destructive/10"
                  aria-label={t('notes.deleteWord')}
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </div>

            {/* 展开详情：完整释义 / 原句 / AI 分析 / 我的笔记 / 多出处 */}
            {isOpen && (
              <div className="px-4 pb-4">
                <div className="pl-[60px] space-y-2.5">
                  <DetailRow label={t('review.colGloss')} text={gloss || w.contextSentence} />
                  <DetailRow label={t('review.colContext')} text={w.contextSentence} />
                  {w.aiAnalysis && <DetailRow label={t('review.colAi')} text={w.aiAnalysis} />}
                  {/* #7 多出处：同词跨视频/跨帧的记录，各自可放大截图 + 跳转 */}
                  {occs.length > 1 && (
                    <div className="pt-2.5 border-t border-border/40">
                      <p className="text-xs font-medium text-muted-foreground/70 mb-2">
                        {t('review.occurrences', { n: occs.length })}
                      </p>
                      <div className="space-y-1.5">
                        {occs.map((o, i) => {
                          const oThumb = o.snapshotId ? (getSnapshotImage(o.snapshotId) || resolvedThumbs[o.snapshotId] || null) : null
                          const oName = videos[o.videoHash]?.fileName ?? o.videoHash ?? ''
                          return (
                            <div key={`${o.snapshotId}-${o.videoTimestamp}-${i}`} className="flex items-center gap-2.5">
                              <span className="text-xs font-semibold text-muted-foreground/50 tabular-nums w-5 shrink-0">#{i + 1}</span>
                              <button
                                onClick={() => { if (oThumb) openLightboxAt(o.snapshotId, o.videoHash, w.word) }}
                                className="w-[52px] h-[34px] rounded-md overflow-hidden border border-border/40 bg-foreground/5 shrink-0 cursor-pointer"
                                aria-label={`${t('review.colSnapshot')} · ${w.word}`}
                              >
                                {oThumb ? (
                                  <img src={oThumb} alt={w.word} className="w-full h-full object-cover" />
                                ) : (
                                  <span className="w-full h-full grid place-items-center text-muted-foreground/40">
                                    <ImageIcon size={13} />
                                  </span>
                                )}
                              </button>
                              <span className="text-[0.75rem] font-mono text-muted-foreground tabular-nums shrink-0">{formatTime(o.videoTimestamp)}</span>
                              <span className="text-xs text-muted-foreground truncate min-w-0">{oName}</span>
                              <button
                                onClick={() => openVideoFromReview(o.videoHash, o.videoTimestamp)}
                                className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-white transition-colors cursor-pointer shrink-0"
                                aria-label={`${t('review.watchVideo')} ${w.word}`}
                              >
                                <Play size={12} />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </>
  )

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }

  const startReview = () => {
    const candidates = [...reviewCandidates].sort(
      (a, b) => new Date(a.sm2.dueDate).getTime() - new Date(b.sm2.dueDate).getTime(),
    )
    if (candidates.length === 0) {
      showToast(t('review.noDueToday'))
      return
    }
    useReviewStore.getState().startReview(candidates)
  }

  /** 三键评分：忘了=2、模糊=3、记住了=首次4之后5（SM-2 原样保留，不加层）。 */
  const gradeWord = (grade: 0 | 1 | 2 | 3 | 4 | 5) => {
    const st = useReviewStore.getState()
    const cur = st.queue[st.idx]
    if (!cur) return
    reviewWord(cur.id, grade)
    if (grade >= 4) st.incRemembered()
    st.next()
  }

  const exitReview = () => useReviewStore.getState().exit()

  /** 从复习界面跳视频：记录返回上下文，回到 Dashboard 时还原 review 视图。 */
  const openVideoFromReview = (hash: string, ts: number) => {
    useReviewStore.getState().setReturnToReview(true)
    onOpenVideoAt(hash, ts)
  }

  const cur = mode === 'review' ? queue[idx] ?? null : null
  const progress = done ? queue.length : Math.min(idx + 1, queue.length)

  // Never leave the UI in an empty flashcard session, including sessions
  // restored from stale state after a filter change or page reload.
  useEffect(() => {
    if (mode === 'review' && queue.length === 0) useReviewStore.getState().exit()
  }, [mode, queue.length])

  // 切词/退出时重置 AI 状态，并取消仍在进行中的请求。
  useEffect(() => {
    setAiBusy(false)
    setAiError(null)
    aiAbortRef.current?.abort()
    aiAbortRef.current = null
    return () => {
      aiAbortRef.current?.abort()
      aiAbortRef.current = null
    }
  }, [cur?.id])
  const progressPct = queue.length ? (progress / queue.length) * 100 : 0

  // 闪卡键盘评分：仅复习模式 + 已翻面时生效（← 忘了 / ↓ 模糊 / → 记住了）。
  useEffect(() => {
    if (mode !== 'review' || done || !flipped) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const st = useReviewStore.getState()
      const w = st.queue[st.idx]
      if (!w) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); gradeWord(2) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); gradeWord(3) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); gradeWord(w.reviewCount === 0 ? 4 : 5) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, done, flipped])

  const formatNextReview = (w: VocabWord) => {
    if (w.sm2.dueDate <= now) return t('review.today')
    const days = Math.max(
      1,
      Math.ceil((new Date(w.sm2.dueDate).getTime() - Date.now()) / 86400000),
    )
    return t('review.inDays', { n: days })
  }

  // ── 单词列表（默认） ──
  if (mode === 'list') {
    return (
      <div className="space-y-4">
        {/* 页头：生词本 / 标题 + 复习按钮 + meta */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
              {t('review.vocabBook')}
            </p>
            <h1 className="mt-1 text-[1.375rem] font-semibold tracking-tight text-foreground">
              {t('dashboard.nav.review')}
            </h1>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <button
              onClick={startReview}
              disabled={reviewCandidates.length === 0}
              className="h-11 px-6 rounded-full bg-primary hover:bg-primary-hover active:scale-[0.98]
                         text-white text-sm font-semibold transition-all cursor-pointer flex items-center gap-1
                         disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-primary"
            >
              {t('review.startReview')} <span className="tabular-nums">({reviewCandidates.length})</span>
            </button>
            <p className="text-xs text-muted-foreground/60">
              {t('review.meta', { n: words.length, m: dueCount })}
            </p>
          </div>
        </div>

        {/* 空状态：一个生词都没有 */}
        {words.length === 0 ? (
          <div className="rounded-2xl border border-border/50 bg-card/60 p-14 flex flex-col items-center text-center">
            <span className="w-14 h-14 rounded-full grid place-items-center bg-foreground/5">
              <BookOpen size={24} className="text-muted-foreground/60" />
            </span>
            <p className="mt-5 text-[0.9375rem] font-semibold text-foreground">
              {t('review.emptyList')}
            </p>
            <button
              onClick={onOpenNotes}
              className="mt-6 h-10 px-5 rounded-xl bg-foreground/5 hover:bg-foreground/10 border border-border/60
                         text-sm font-medium text-foreground transition-colors cursor-pointer"
            >
              {t('review.goToNotes')}
            </button>
          </div>
        ) : filtered.length === 0 ? (
          /* 搜索无结果 */
          <div className="rounded-2xl border border-border/50 bg-card/60 p-10 text-center">
            <p className="text-[0.9375rem] font-semibold text-foreground">
              {t('review.noMatch', { q: search.trim() })}
            </p>
          </div>
        ) : categoryFiltered.length === 0 ? (
          /* 分类过滤无结果 */
          <div className="rounded-2xl border border-border/50 bg-card/60 p-10 flex flex-col items-center text-center">
            <p className="text-[0.9375rem] font-semibold text-foreground">
              {t('review.noReviewCandidates')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('review.noReviewCandidatesHint')}
            </p>
            <button
              onClick={() => setReviewFilter('all')}
              className="mt-6 h-10 px-5 rounded-xl bg-foreground/5 hover:bg-foreground/10 border border-border/60
                         text-sm font-medium text-foreground transition-colors cursor-pointer"
            >
              {t('review.filterAll')}
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
            {/* 顶部三统计：待复习 / 已掌握 / 累计天数 */}
            <div className="grid grid-cols-3 gap-3 p-4 border-b border-border/40">
              {[
                { label: t('review.statDue'), value: dueCount, color: '#ff9f0a' },
                { label: t('review.statMastered'), value: masteredCount, color: '#34c759' },
                { label: t('review.statDays'), value: totalDays, color: 'var(--primary)' },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl border border-border/50 bg-foreground/[0.03] px-4 py-3"
                >
                  <p className="text-[1.75rem] font-semibold tabular-nums leading-none" style={{ color: s.color }}>
                    {s.value}
                  </p>
                  <p className="mt-1.5 text-xs font-medium text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>

            {/* 筛选切换：分类（全部/待复习/已掌握）+ 分组（时间/视频） */}
            <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
              <div className="inline-flex rounded-lg bg-foreground/5 border border-border/50 p-0.5">
                {(['all', 'due', 'mastered'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setReviewFilter(f)}
                    className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      reviewFilter === f
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {f === 'all'
                      ? t('review.filterAll')
                      : f === 'due'
                        ? t('review.filterDue')
                        : t('review.filterMastered')}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg bg-foreground/5 border border-border/50 p-0.5">
                  <button
                    onClick={() => setGroupByVideo(false)}
                    className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      !groupByVideo
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Clock size={13} /> {t('review.groupByTime')}
                  </button>
                  <button
                    onClick={() => setGroupByVideo(true)}
                    className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      groupByVideo
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Layers size={13} /> {t('review.groupByVideo')}
                  </button>
                </div>
                {/* #8 选择按钮：勾选框默认隐藏，点它进入多选模式 */}
                <button
                  onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                  className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                    selectMode
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'bg-foreground/5 border-border/50 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {selectMode ? t('review.exitSelect') : t('review.select')}
                </button>
              </div>
            </div>

            {/* #2 删除多选：选中时出现的批量操作条（#8 仅「选择」模式下显示） */}
            {selectMode && selectedIds.size > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-primary/10 border-t border-b border-primary/20">
                <span className="text-xs font-medium text-primary">
                  {t('review.selectedCount', { n: selectedIds.size })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors cursor-pointer"
                  >
                    {t('notes.confirm.cancel')}
                  </button>
                  <button
                    onClick={() => setPendingBulkDelete(true)}
                    className="h-8 px-3 rounded-lg text-xs font-medium bg-destructive hover:bg-destructive/90 text-white transition-colors cursor-pointer"
                  >
                    {t('review.deleteSelected')}
                  </button>
                </div>
              </div>
            )}

            {/* 列头 */}
            <div className={`${selectMode ? COLS : COLS_NO_SELECT} px-4 py-3 text-xs font-medium text-muted-foreground/60`}>
              {selectMode && (
                <span className="justify-self-center">
                  <input
                    type="checkbox"
                    checked={categoryFiltered.length > 0 && selectedIds.size === categoryFiltered.length}
                    onChange={toggleSelectAll}
                    aria-label={t('review.selectAll')}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  />
                </span>
              )}
              <span>{t('review.colSnapshot')}</span>
              <span>{t('review.colWord')}</span>
              <span>{t('review.colNote')}</span>
              <span>{t('review.colStatus')}</span>
              <span>{t('review.nextReview')}</span>
              <span className="text-right">{t('review.colVideo')}</span>
            </div>

            {/* 数据行：按时间顺序整表；按视频分组时每组有分隔线 + 视频文件名 */}
            {grouped ? (
              grouped.map(([hash, gw]) => {
                const videoName = videos[hash]?.fileName ?? hash
                return (
                  <div key={hash} className="border-t border-border/40">
                    <div className="flex items-center gap-2.5 px-4 py-2.5">
                      <Play size={12} className="text-muted-foreground/40 shrink-0" />
                      <p className="text-xs font-semibold text-muted-foreground truncate">{videoName}</p>
                      <span className="text-xs text-muted-foreground/50 tabular-nums shrink-0">{gw.length}</span>
                      <span className="h-px flex-1 bg-border/40" />
                    </div>
                    {renderWordRows(gw)}
                  </div>
                )
              })
            ) : (
              renderWordRows(categoryFiltered)
            )}
          </div>
        )}

        {/* 底部复习规则说明 */}
        <p className="text-xs text-muted-foreground/50">{t('review.scheduleRule')}</p>

        {toast && (
          <div className="fixed left-1/2 bottom-7 -translate-x-1/2 z-50 rounded-xl border border-border/60
                          bg-card px-4 py-2.5 text-sm text-foreground shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
            {toast}
          </div>
        )}

        {/* 截图放大：点缩略图弹出全尺寸查看（列表 / 闪卡共用组件） */}
        <LightboxOverlay lightbox={lightbox} onClose={() => setLightbox(null)} t={t} />

        {/* 删除生词确认悬浮窗（列表模式必须在这里渲染，闪卡分支另有同款） */}
        <ConfirmDialog
          open={!!pendingDelete}
          title={t('notes.confirm.title')}
          message={t('notes.confirm.msg')}
          confirmLabel={t('notes.confirm.delete')}
          cancelLabel={t('notes.confirm.cancel')}
          onConfirm={confirmDeleteWord}
          onCancel={() => setPendingDelete(null)}
        />

        {/* #2 批量删除确认悬浮窗 */}
        <ConfirmDialog
          open={pendingBulkDelete}
          title={t('notes.confirm.title')}
          message={t('notes.confirm.msg')}
          confirmLabel={t('review.deleteSelected')}
          cancelLabel={t('notes.confirm.cancel')}
          onConfirm={confirmBulkDelete}
          onCancel={() => setPendingBulkDelete(false)}
        />
      </div>
    )
  }

  // ── 闪卡复习 ──
  return (
    <div className="flex flex-col min-h-full">
      {/* 顶栏：退出 | 进度 + 进度条 */}
      <div className="grid grid-cols-[88px_1fr_88px] items-center gap-4">
        <button
          onClick={exitReview}
          className="justify-self-start inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium
                     text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors cursor-pointer"
        >
          <X size={16} /> {t('review.exit')}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-[0.8125rem] tabular-nums whitespace-nowrap">
            {progress} / {queue.length}
          </span>
          <div className="h-1 flex-1 rounded-full bg-foreground/10 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <div />
      </div>

      {/* 卡片区 */}
      <div className="flex-1 flex flex-col items-center justify-center py-8">
        {done ? (
          /* 完成态 */
          <div className="flex flex-col items-center text-center">
            <span className="w-16 h-16 rounded-full grid place-items-center bg-[#30d158]/15">
              <CheckCircle2 size={28} className="text-[#30d158]" />
            </span>
            <h2 className="mt-6 text-[1.5rem] font-semibold tracking-tight text-foreground">
              {t('review.sessionComplete')}
            </h2>
            <p className="mt-2 text-[0.9375rem] text-muted-foreground">
              {t('review.reviewedWords', { n: queue.length })} ·{' '}
              {t('review.remembered', { n: remembered })}
            </p>
            <button
              onClick={exitReview}
              className="mt-7 h-11 px-7 rounded-full bg-primary hover:bg-primary-hover active:scale-[0.98]
                         text-white text-sm font-semibold transition-all cursor-pointer"
            >
              {t('review.returnToList')}
            </button>
          </div>
        ) : cur ? (
          <>
            {/* 闪卡（3D 翻面）。key=词 id：答题切下一词时整卡重挂载、以正面直接出现，
                避免 500ms 翻转动画期间背面短暂显示下一词的答案。 */}
            <div
              key={cur.id}
              onClick={() => setFlipped(!flipped)}
              className="w-full max-w-[460px] h-[360px] cursor-pointer"
              style={{ perspective: '1400px' }}
            >
              <div
                className="relative w-full h-full transition-transform duration-500"
                style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'none' }}
              >
                {/* 正面：英文 + 点击翻面 */}
                <div
                  className="absolute inset-0 rounded-3xl border border-border/60 bg-card
                             shadow-[0_16px_48px_rgba(0,0,0,0.5)] flex flex-col"
                  style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                >
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-10">
                    <p className="text-[2.375rem] font-semibold tracking-normal text-foreground">
                      {cur.word}
                    </p>
                    <p className="mt-4 text-[0.8125rem] text-muted-foreground/60">
                      {t('review.tapToReveal')}
                    </p>
                  </div>
                </div>
                {/* 背面：中文释义 + 例句 + AI 分析 + 我的笔记 + 看视频 */}
                <div
                  className="absolute inset-0 rounded-3xl border border-border/60 bg-card
                             shadow-[0_16px_48px_rgba(0,0,0,0.5)] flex flex-col"
                  style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                >
                  <div className="flex-1 flex flex-col px-9 py-7 min-h-0 overflow-y-auto">
                    {/* #2 截图缩略图：点按放大原帧 */}
                    {(() => {
                      const backThumb = cur.snapshotId ? (getSnapshotImage(cur.snapshotId) || resolvedThumbs[cur.snapshotId] || null) : null
                      if (!backThumb) return null
                      return (
                        <button
                          onClick={(e) => { e.stopPropagation(); openLightbox(cur) }}
                          className="self-start mb-3 rounded-xl overflow-hidden border border-border/40 bg-foreground/5 cursor-pointer group shrink-0"
                          aria-label={`${t('review.colSnapshot')} · ${cur.word}`}
                        >
                          <img
                            src={backThumb}
                            alt={cur.word}
                            className="max-h-[84px] object-cover group-hover:opacity-90 transition-opacity"
                          />
                        </button>
                      )
                    })()}
                    {/* 词 + 释义同面：背面不再只有释义，顶部保留单词本体，下面紧跟中文释义 */}
                    <p className="text-[1.625rem] font-semibold tracking-tight text-foreground">
                      {cur.word}
                    </p>
                    <p className="mt-2 text-[1.125rem] font-medium leading-[1.4] text-foreground/85">
                      {glosses[cur.word.toLowerCase()] ?? ''}
                    </p>
                    {cur.contextSentence && (
                      <p className="mt-3 text-[0.9375rem] italic text-muted-foreground leading-[1.6]">
                        "{cur.contextSentence}"
                      </p>
                    )}
                    {cur.aiAnalysis ? (
                      <div className="mt-4">
                        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">
                          {t('notes.analysis')}
                        </p>
                        <p className="mt-1.5 text-[0.8125rem] text-muted-foreground leading-[1.7] whitespace-pre-wrap">
                          {cur.aiAnalysis}
                        </p>
                      </div>
                    ) : (
                      <div className="mt-4">
                        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">
                          {t('notes.analysis')}
                        </p>
                        {aiBusy ? (
                          <div className="mt-1.5 flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                            <Loader2 size={13} className="animate-spin text-primary" />
                            {t('ai.analyzing', { word: cur.word })}
                          </div>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); analyzeWord(cur) }}
                            className="mt-1.5 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg
                                       bg-gradient-to-r from-primary/20 to-chart-3/20 hover:from-primary/30 hover:to-chart-3/30
                                       border border-primary/20 text-primary text-[0.8125rem] font-semibold transition-all cursor-pointer"
                          >
                            <Sparkles size={13} /> {t('ai.analyze', { word: cur.word })}
                          </button>
                        )}
                        {aiError && <p className="mt-1.5 text-[0.75rem] text-destructive/80">{aiError}</p>}
                      </div>
                    )}
                    {cur.userNote && (
                      <div className="mt-4 pt-3 border-t border-border/40">
                        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">
                          {t('notes.myNotes')}
                        </p>
                        <p className="mt-1.5 text-[0.8125rem] text-muted-foreground leading-[1.7]">
                          {cur.userNote}
                        </p>
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); openVideoFromReview(cur.videoHash, cur.videoTimestamp) }}
                      className="mt-5 self-start inline-flex items-center gap-2 h-10 px-4 rounded-xl
                                 bg-primary hover:bg-primary-hover active:scale-[0.98]
                                 text-white text-sm font-semibold transition-all cursor-pointer"
                    >
                      <Play size={14} />
                      {t('review.watchVideo')}
                      <span className="tabular-nums text-white/80">{formatTime(cur.videoTimestamp)}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 操作按钮：翻面后出现（预留高度避免卡片跳动）。三键 = 忘了/模糊/记住了 */}
            <div className="mt-8 h-12 flex items-center justify-center gap-4">
              {flipped && (
                <>
                  <button
                    onClick={() => gradeWord(2)}
                    className="h-12 px-7 rounded-xl bg-[#ff453a] hover:brightness-110 active:scale-[0.97]
                               text-white text-base font-semibold transition-all cursor-pointer inline-flex items-center gap-2"
                  >
                    <RotateCcw size={16} /> {t('review.forgot')} <kbd className="text-white/60 text-xs">←</kbd>
                  </button>
                  <button
                    onClick={() => gradeWord(3)}
                    className="h-12 px-7 rounded-xl bg-[#ff9f0a] hover:brightness-110 active:scale-[0.97]
                               text-white text-base font-semibold transition-all cursor-pointer inline-flex items-center gap-2"
                  >
                    {t('review.fuzzy')} <kbd className="text-white/60 text-xs">↓</kbd>
                  </button>
                  <button
                    onClick={() => gradeWord(cur.reviewCount === 0 ? 4 : 5)}
                    className="h-12 px-7 rounded-xl bg-[#30d158] hover:brightness-110 active:scale-[0.97]
                               text-white text-base font-semibold transition-all cursor-pointer inline-flex items-center gap-2"
                  >
                    <CheckCircle2 size={16} /> {t('review.gotIt')} <kbd className="text-white/60 text-xs">→</kbd>
                  </button>
                </>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* #2 截图放大：闪卡背面缩略图点击后全尺寸查看 */}
      <LightboxOverlay lightbox={lightbox} onClose={() => setLightbox(null)} t={t} />

      {/* #1 删除生词确认悬浮窗 */}
      <ConfirmDialog
        open={!!pendingDelete}
        title={t('notes.confirm.title')}
        message={t('notes.confirm.msg')}
        confirmLabel={t('notes.confirm.delete')}
        cancelLabel={t('notes.confirm.cancel')}
        onConfirm={confirmDeleteWord}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
