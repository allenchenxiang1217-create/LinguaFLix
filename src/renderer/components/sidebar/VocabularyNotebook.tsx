import { useState, useMemo, useRef } from 'react'
import { useVocabularyStore } from '../../stores/vocabularyStore'
import { usePlayerStore } from '../../stores/playerStore'
import { useAppStore } from '../../stores/appStore'
import { useSubtitleStore } from '../../stores/subtitleStore'
import { formatTime } from '../../lib/time'
import { deleteWordCompletely } from '../../services/deletion'
import {
  BookOpen, Trash2, Play, ChevronRight, ChevronDown, CheckCircle2,
  ArrowDownAZ, FolderTree, Clock, RotateCcw
} from 'lucide-react'
import type { VocabWord } from '@shared/types'
import { useI18n } from '../../i18n/useI18n'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { mapSourceTimeToClip } from '../../lib/review-clip'

type SortMode = 'alpha' | 'video'
type ReviewFilter = 'all' | 'due'

interface VocabularyNotebookProps {
  /** 播放器侧栏传入当前视频 hash：只显示该视频保存的生词（#6 生词独立）。 */
  currentVideoHash?: string
}

export function VocabularyNotebook({ currentVideoHash }: VocabularyNotebookProps) {
  const allWords = useVocabularyStore((s) => s.words)
  const reviewWord = useVocabularyStore((s) => s.reviewWord)
  const seek = usePlayerStore((s) => s.seek)
  const videos = useAppStore((s) => s.videos)
  const pauseTimerRef = useRef<number>(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('alpha')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  // #1 删除生词：确认悬浮窗（删除不可撤销，级联清理快照副本 + 孤儿截图缓存）
  const [pendingDelete, setPendingDelete] = useState<VocabWord | null>(null)
  const { t } = useI18n()

  // #6 生词独立：侧栏只显示当前视频的生词；不传（或传空）则显示全部。
  const currentVideo = currentVideoHash ? videos[currentVideoHash] : null
  const sourceHash = currentVideo?.isReviewClip && currentVideo.reviewSourceHash
    ? currentVideo.reviewSourceHash
    : currentVideoHash
  const words = useMemo(
    () => (sourceHash ? allWords.filter((w) => w.videoHash === sourceHash) : allWords),
    [allWords, sourceHash],
  )
  const scopedVideoName = sourceHash ? videos[sourceHash]?.fileName : null

  // ── #1 删除生词：确认悬浮窗；级联清理快照副本 + 孤儿截图缓存 ──
  const confirmRemoveWord = () => {
    if (!pendingDelete) return
    const w = pendingDelete
    setPendingDelete(null)
    deleteWordCompletely({ id: w.id, snapshotId: w.snapshotId, videoHash: w.videoHash })
  }

  // ── Jump to video at word's timestamp ──
  const handleJumpToWord = (word: VocabWord) => {
    // #5 播放时自动隐藏字幕挡块，不遮挡画面；#4 记住原可见状态，6 秒自动暂停后还原。
    const subtitleStore = useSubtitleStore.getState()
    const wasBlockerVisible = subtitleStore.blockerVisible
    if (wasBlockerVisible) subtitleStore.setBlockerVisible(false)
    const clipTime = mapSourceTimeToClip(currentVideo, word.videoTimestamp) ?? word.videoTimestamp
    const startTime = Math.max(0, clipTime - 3)
    seek(startTime)
    usePlayerStore.getState().play()
    clearTimeout(pauseTimerRef.current)
    pauseTimerRef.current = window.setTimeout(() => {
      usePlayerStore.getState().pause()
      if (wasBlockerVisible) useSubtitleStore.getState().setBlockerVisible(true)
    }, 6000)
  }

  // ── Review with SM-2 ──
  const handleRemembered = (word: VocabWord) => {
    reviewWord(word.id, 4)  // grade 4 = correct with hesitation
  }

  const handleForgot = (word: VocabWord) => {
    reviewWord(word.id, 2)  // grade 2 = incorrect
  }

  // ── Group/sort words ──
  const grouped = useMemo(() => {
    let filtered = words
    if (reviewFilter === 'due') {
      const now = new Date().toISOString()
      filtered = words.filter((w) => w.sm2.dueDate <= now)
    }

    if (sortMode === 'alpha') {
      // Alphabetical groups
      const groups: Record<string, VocabWord[]> = {}
      const sorted = [...filtered].sort((a, b) => a.word.localeCompare(b.word))
      for (const w of sorted) {
        const letter = /^[a-zA-Z]/.test(w.word[0]) ? w.word[0].toUpperCase() : '#'
        if (!groups[letter]) groups[letter] = []
        groups[letter].push(w)
      }
      return Object.entries(groups).sort(([a], [b]) => {
        if (a === '#') return 1
        if (b === '#') return -1
        return a.localeCompare(b)
      })
    } else {
      // Video grouping
      const groups: Record<string, VocabWord[]> = {}
      for (const w of filtered) {
        const key = w.videoHash || 'Unknown'
        if (!groups[key]) groups[key] = []
        groups[key].push(w)
      }
      return Object.entries(groups).map(([hash, ws]): [string, VocabWord[]] => [
        hash,
        ws.sort((a, b) => b.createdAt - a.createdAt),
      ])
    }
  }, [words, sortMode, reviewFilter])

  const dueCount = useMemo(() => {
    const now = new Date().toISOString()
    return words.filter((w) => w.sm2.dueDate <= now).length
  }, [words])

  // ── Empty state ──
  if (words.length === 0) {
    const isScoped = Boolean(currentVideoHash)
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
          <BookOpen size={24} className="text-muted-foreground/40" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          {isScoped ? t('notes.videoNoWords') : t('notes.noSavedWords')}
        </p>
        <p className="text-xs text-muted-foreground/50 mt-1.5 leading-relaxed max-w-[200px]">
          {isScoped ? t('notes.videoNoWordsHint') : t('notes.saveHint')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
        <span className="flex items-center gap-1.5 min-w-0">
          {scopedVideoName && (
            <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded-full truncate max-w-[120px]">
              <BookOpen size={9} className="shrink-0" />
              <span className="truncate">{scopedVideoName}</span>
            </span>
          )}
          <span className="text-[0.6875rem] text-muted-foreground font-medium whitespace-nowrap">
            {t('notes.words', { n: words.length })}
            {dueCount > 0 && (
              <span className="ml-1.5 text-primary/70">{t('notes.due', { n: dueCount })}</span>
            )}
          </span>
        </span>
        <div className="flex items-center gap-1">
          {/* Review filter */}
          <button
            onClick={() => setReviewFilter(reviewFilter === 'all' ? 'due' : 'all')}
            className={`p-1.5 rounded-lg text-[0.625rem] font-medium transition-colors cursor-pointer
              ${reviewFilter === 'due' ? 'bg-primary/15 text-primary' : 'bg-secondary/30 text-muted-foreground hover:bg-secondary/50'}`}
            title={reviewFilter === 'all' ? t('notes.showAll') : t('notes.showDueOnly')}
          >
            <Clock size={11} />
          </button>

          {/* Sort mode */}
          <button
            onClick={() => setSortMode(sortMode === 'alpha' ? 'video' : 'alpha')}
            className="p-1.5 rounded-lg bg-secondary/30 text-muted-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
            title={sortMode === 'alpha' ? t('notes.alphabetical') : t('notes.byVideo')}
          >
            {sortMode === 'alpha' ? <ArrowDownAZ size={11} /> : <FolderTree size={11} />}
          </button>
        </div>
      </div>

      {/* Word list */}
      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <Clock size={24} className="text-muted-foreground/30 mb-3" />
            <p className="text-xs font-medium text-muted-foreground">
              {reviewFilter === 'due' ? t('notes.noWordsDue') : t('notes.noWordsFound')}
            </p>
            <p className="text-[0.625rem] text-muted-foreground/40 mt-1">
              {reviewFilter === 'due' ? t('notes.allUpToDate') : t('notes.saveToSee')}
            </p>
          </div>
        ) : (
          grouped.map(([groupKey, groupWords]) => (
          <div key={groupKey}>
            {/* Group header */}
            <div className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/50
                            bg-background/30 border-b border-border/10 sticky top-0">
              {sortMode === 'alpha'
                ? groupKey
                : videos[groupKey]?.fileName ?? groupKey.slice(0, 8) + '...'}
              <span className="ml-2 font-normal text-muted-foreground/30">{groupWords.length}</span>
            </div>

            {groupWords.map((word) => {
              const isExpanded = expandedId === word.id
              const isDue = word.sm2.dueDate <= new Date().toISOString()
              const isNew = word.reviewCount === 0

              return (
                <div
                  key={word.id}
                  className={`border-b border-border/10 transition-all duration-200
                    ${isExpanded ? 'bg-background/50' : 'hover:bg-secondary/20'}
                    ${isDue && !isNew ? 'border-l-2 border-l-primary/50' : ''}`}
                >
                  {/* Row */}
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : word.id)}
                    className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                  >
                    <button className="p-0.5">
                      {isExpanded ? (
                        <ChevronDown size={12} className="text-muted-foreground/40" />
                      ) : (
                        <ChevronRight size={12} className="text-muted-foreground/40" />
                      )}
                    </button>

                    <span className="text-[0.8125rem] font-semibold text-foreground/85">{word.word}</span>

                    <div className="flex-1" />

                    {/* SM-2 status */}
                    {isNew ? (
                      <span className="text-[0.5625rem] font-medium text-chart-3/60 bg-chart-3/5 px-1.5 py-0.5 rounded-full">{t('notes.new')}</span>
                    ) : isDue ? (
                      <span className="text-[0.5625rem] font-medium text-primary/70 bg-primary/5 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                        <RotateCcw size={8} /> {t('notes.reviewTag')}
                      </span>
                    ) : (
                      <span className="text-[0.5625rem] text-muted-foreground/40">
                        {new Date(word.sm2.dueDate).toLocaleDateString()}
                      </span>
                    )}

                    {word.reviewCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[0.5625rem] text-success/60">
                        <CheckCircle2 size={9} /> {word.reviewCount}
                      </span>
                    )}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 animate-fade-in">
                      {/* Context */}
                      {word.contextSentence && (
                        <div>
                          <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1">{t('notes.context')}</p>
                          <p className="text-[0.6875rem] text-muted-foreground/80 leading-relaxed italic border-l-2 border-primary/30 pl-2.5 py-0.5">
                            "{word.contextSentence}"
                          </p>
                        </div>
                      )}

                      {/* SM-2 stats */}
                      <div className="flex items-center gap-3 text-[0.625rem] text-muted-foreground/50">
                        <span>{t('notes.interval', { n: word.sm2.interval })}</span>
                        <span>{t('notes.efactor', { n: word.sm2.efactor.toFixed(1) })}</span>
                        <span>{t('notes.reps', { n: word.sm2.repetition })}</span>
                      </div>

                      {/* AI Analysis */}
                      {word.aiAnalysis && (
                        <div>
                          <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1">{t('notes.analysis')}</p>
                          <div className="text-[0.6875rem] text-foreground/80 leading-relaxed whitespace-pre-wrap max-h-28 overflow-y-auto
                                          bg-background/50 rounded-lg p-2.5">
                            {word.aiAnalysis}
                          </div>
                        </div>
                      )}

                      {/* User notes */}
                      {word.userNote && (
                        <div>
                          <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1">{t('notes.myNotes')}</p>
                          <p className="text-[0.6875rem] text-muted-foreground/70 leading-relaxed">{word.userNote}</p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleJumpToWord(word)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-[0.625rem] font-medium rounded-lg
                                     bg-secondary hover:bg-secondary/80 border border-border/50
                                     transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                        >
                          <Play size={10} /> {formatTime(mapSourceTimeToClip(currentVideo, word.videoTimestamp) ?? word.videoTimestamp)}
                        </button>

                        {/* SM-2 review buttons */}
                        <button
                          onClick={() => handleForgot(word)}
                          className="flex items-center gap-1 px-2 py-1.5 text-[0.625rem] font-medium rounded-lg
                                     bg-destructive/10 hover:bg-destructive/20 border border-destructive/20
                                     transition-colors cursor-pointer text-destructive"
                        >
                          {t('notes.forgot')}
                        </button>
                        <button
                          onClick={() => handleRemembered(word)}
                          className="flex items-center gap-1 px-2 py-1.5 text-[0.625rem] font-medium rounded-lg
                                     bg-success/10 hover:bg-success/20 border border-success/20
                                     transition-colors cursor-pointer text-success"
                        >
                          <CheckCircle2 size={10} /> {t('notes.gotIt')}
                        </button>

                        <div className="flex-1" />
                        <button
                          onClick={() => setPendingDelete(word)}
                          className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors cursor-pointer"
                          title={t('notes.deleteWordHint')}
                        >
                          <Trash2 size={11} className="text-muted-foreground/40 hover:text-destructive" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))
      )}
      </div>

      {/* 删除生词确认悬浮窗 */}
      <ConfirmDialog
        open={!!pendingDelete}
        title={t('notes.confirm.title')}
        message={t('notes.confirm.msg')}
        confirmLabel={t('notes.confirm.delete')}
        cancelLabel={t('notes.confirm.cancel')}
        onConfirm={confirmRemoveWord}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
