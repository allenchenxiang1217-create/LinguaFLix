import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { SnapshotEntry, VocabWord, OCRRegion } from '@shared/types'
import { usePlayerStore } from '../../stores/playerStore'
import { useAppStore } from '../../stores/appStore'
import { useNoteStore } from '../../stores/noteStore'
import { useVocabularyStore } from '../../stores/vocabularyStore'
import { useSubtitleStore } from '../../stores/subtitleStore'
import { DictionaryLookup } from '../dictionary/DictionaryLookup'
import { AIVocabAnalysis } from '../dictionary/AIVocabAnalysis'
import { RegionSelectModal } from './RegionSelectModal'
import { formatTime } from '../../lib/time'
import { useI18n } from '../../i18n/useI18n'
import { OCRService } from '../../services/ocr-service'
import { deleteSnapshotCompletely, deleteWordOccurrenceFromSnapshot } from '../../services/deletion'
import { findPhrases } from '../../lib/phrases'
import { portalTarget } from '../../lib/portal'
import { mapSourceTimeToClip } from '../../lib/review-clip'
import {
  Clock, Play, Pencil, Check, X, Scan, StickyNote, ChevronDown, ChevronRight,
  Sparkles, BookmarkPlus, Loader2, ZoomIn, Trash2, AlertCircle
} from 'lucide-react'

/** #3 选词交互：不再用「底色涂鸦」，改用下划线高亮——所有可点词带淡色点状下划线
 *  提示「可以交互」；已保存的生词用橙色实线下划线；选中的词加粗 + 主色实线下划线。 */

interface NoteSnapshotCardProps {
  snapshot: SnapshotEntry
  noteId: string
  readOnly?: boolean
}

export function NoteSnapshotCard({ snapshot, noteId, readOnly = false }: NoteSnapshotCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [editingText, setEditingText] = useState(false)
  const [editValue, setEditValue] = useState(snapshot.ocrText)
  const [showFullImage, setShowFullImage] = useState(false)
  const [showReOCR, setShowReOCR] = useState(false)
  const [reOCRLoading, setReOCRLoading] = useState(false)
  const [reOCRError, setReOCRError] = useState<string | null>(null)
  const [selectedWord, setSelectedWord] = useState<string>('')
  const [showAI, setShowAI] = useState(false)
  const [editingWordNote, setEditingWordNote] = useState(false)
  const [wordNoteDraft, setWordNoteDraft] = useState('')
  // #10 删除这张截图：两步确认，级联清理截图缓存 + 该截图的生词
  const [deleteConfirming, setDeleteConfirming] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)
  const seek = usePlayerStore((s) => s.seek)
  const play = usePlayerStore((s) => s.play)
  const pause = usePlayerStore((s) => s.pause)
  const videoHash = usePlayerStore((s) => s.videoHash)
  const currentVideo = useAppStore((s) => (videoHash ? s.videos[videoHash] : undefined))
  const subtitles = useSubtitleStore((s) => s.subtitles)
  const { updateSnapshotText, updateSnapshotRegion, setOCRResult, addWordToSnapshot, updateSnapshotWordNote } = useNoteStore()
  const addWord = useVocabularyStore((s) => s.addWord)
  const updateWordNote = useVocabularyStore((s) => s.updateWordNote)
  const vocabWords = useVocabularyStore((s) => s.words)
  const isOCRPending = useNoteStore((s) => s.ocrPending[snapshot.id])
  const pauseTimerRef = useRef<number>(0)
  const { t } = useI18n()

  // Get subtitle context for this snapshot's timestamp
  const transcriptContext = useMemo(() => {
    if (subtitles.length === 0) return null
    const ts = snapshot.timestamp
    let idx = -1
    for (let i = 0; i < subtitles.length; i++) {
      if (ts >= subtitles[i].startTime && ts <= subtitles[i].endTime) { idx = i; break }
    }
    if (idx < 0) return null
    return {
      currentText: subtitles[idx].text,
      contextBefore: idx > 0 ? subtitles[idx - 1].text : '',
      contextAfter: idx < subtitles.length - 1 ? subtitles[idx + 1].text : '',
    }
  }, [snapshot.timestamp, subtitles])

  const displaySentence = transcriptContext?.currentText || snapshot.ocrText || ''

  // #9 生词第二色：已保存进单词本的词在句子里用固定橙色标出（单一数据源=vocabularyStore）。
  const savedWordSet = useMemo(() => {
    const set = new Set<string>()
    for (const w of vocabWords) set.add(w.word.toLowerCase())
    return set
  }, [vocabWords])

  // #5 词组识别：句子先切成「单词/词组」段，固定搭配渲染成单个可点击 chip（give up / in order to …）。
  const sentenceSegments = useMemo(() => findPhrases(displaySentence), [displaySentence])

  // #2 自动上滑：把卡片滚到侧栏滚动区上 1/3，醒目且避免被底部工具条/边框遮挡。
  const scrollToUpperThird = useCallback(() => {
    const el = cardRef.current
    if (!el) return
    const container = el.closest('.overflow-y-auto')
    if (!container) return
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    container.scrollTo({ top: Math.max(0, top - container.clientHeight / 3), behavior: 'smooth' })
  }, [])

  // 点击卡片头部：展开/收起；展开时自动上滑到上 1/3。
  const handleHeaderClick = () => {
    const next = !expanded
    setExpanded(next)
    // 必须在 React 提交展开之后才能算目标：折叠时列表 max scroll 还没长高，
    // 直接 scrollTo 的目标会超出当前 max 被 clamp 回原位，动画形同虚设。
    if (next) requestAnimationFrame(() => requestAnimationFrame(() => scrollToUpperThird()))
  }

  // Jump to video: play from t-3s to t+3s
  const handleJumpToTime = () => {
    // #3 点播放键展开笔记：即便折叠中也能看到内容。
    setExpanded(true)
    // #5 播放时自动隐藏字幕挡块，不遮挡画面；#4 记住原可见状态，6 秒自动暂停后还原。
    const subtitleStore = useSubtitleStore.getState()
    const wasBlockerVisible = subtitleStore.blockerVisible
    if (wasBlockerVisible) subtitleStore.setBlockerVisible(false)
    // #2 点击笔记自动上滑：把卡片滚到侧栏滚动区上 1/3，避免被底部工具条遮挡。
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToUpperThird()))
    const clipTime = mapSourceTimeToClip(currentVideo, snapshot.timestamp) ?? snapshot.timestamp
    const startTime = Math.max(0, clipTime - 3)
    seek(startTime)
    play()
    // Auto-pause after 6 seconds (3 before + 3 after)
    clearTimeout(pauseTimerRef.current)
    pauseTimerRef.current = window.setTimeout(() => {
      pause()
      if (wasBlockerVisible) useSubtitleStore.getState().setBlockerVisible(true)
    }, 6000)
  }

  // Save edited OCR text
  const handleSaveText = () => {
    updateSnapshotText(snapshot.id, editValue, true)
    setEditingText(false)
  }

  // Re-OCR with a newly selected region (from the fullscreen region modal)
  const handleReOCR = async (region: OCRRegion) => {
    setReOCRLoading(true)
    setReOCRError(null)
    try {
      const text = await OCRService.recognize(snapshot.imageDataUrl, region)
      setOCRResult(snapshot.id, text)
      updateSnapshotRegion(snapshot.id, region)
      setShowReOCR(false)
    } catch (err) {
      setReOCRError(err instanceof Error ? err.message : t('notes.ocrFailed'))
    } finally {
      setReOCRLoading(false)
    }
  }

  // Full-image lightbox closes on Escape
  useEffect(() => {
    if (!showFullImage) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFullImage(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showFullImage])

  // Word click → dictionary + optional AI
  const handleWordClick = (word: string) => {
    if (selectedWord === word) {
      setSelectedWord('')
      setShowAI(false)
    } else {
      setSelectedWord(word)
      setShowAI(false)
    }
  }

  // Save word to vocabulary
  const handleSaveWord = (word: string) => {
    const vocabWord: VocabWord = {
      id: crypto.randomUUID(),
      word,
      contextSentence: displaySentence,
      snapshotId: snapshot.id,
      noteId,
      videoHash: currentVideo?.isReviewClip && currentVideo.reviewSourceHash
        ? currentVideo.reviewSourceHash
        : videoHash || '',
      videoTimestamp: snapshot.timestamp,
      aiAnalysis: '',
      userNote: '',
      sm2: { interval: 0, repetition: 0, efactor: 2.5, dueDate: new Date().toISOString() },
      createdAt: Date.now(),
      reviewedAt: null,
      reviewCount: 0,
    }
    // addWord 返回落库条目（真实 id，且 #7 同词合并后返回已存在的条目）；
    // 快照副本用同一个 id，单词级批注才能同步。
    const stored = addWord(vocabWord)
    addWordToSnapshot(snapshot.id, stored)
  }

  // #7 内联删除：只删掉该词在本截图里的那条出处（其它截图/视频里的保留）。
  const handleDeleteSavedWord = (w: VocabWord) => {
    deleteWordOccurrenceFromSnapshot(w, snapshot.id)
  }

  // #10 单词级批注：写入单词本条目 + 快照副本（同 id），闪卡/单词本同步显示。
  const handleSaveWordNote = () => {
    if (!selectedWord) return
    const saved = snapshot.words.find((x) => x.word.toLowerCase() === selectedWord.toLowerCase())
    if (!saved) return
    updateWordNote(saved.id, wordNoteDraft)
    updateSnapshotWordNote(snapshot.id, saved.id, wordNoteDraft)
    setEditingWordNote(false)
  }

  // #10 删除这张截图：两步确认；级联清理截图缓存 + 该截图保存的生词（删除后卡片卸载）。
  const handleDeleteSnapshot = () => {
    if (!deleteConfirming) {
      setDeleteConfirming(true)
      return
    }
    deleteSnapshotCompletely(noteId, snapshot)
  }

  return (
    <div
      ref={cardRef}
      className={`rounded-xl border transition-all duration-200 overflow-hidden
      ${expanded ? 'border-primary/20 bg-background/50' : 'border-border/30 bg-secondary/20 hover:bg-secondary/30'}`}
    >
      {/* Header: thumbnail + timestamp — clicking anywhere in the header expands/collapses */}
      <div
        onClick={handleHeaderClick}
        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer"
      >
        {/* Thumbnail — click to view the full frame */}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(true); setShowFullImage(true) }}
          title={t('notes.viewFullImage')}
          className="relative w-14 h-9 rounded-lg bg-black/50 border border-border/30 overflow-hidden shrink-0 cursor-pointer group"
        >
          {snapshot.thumbnailDataUrl || snapshot.imageDataUrl ? (
            <img
              src={snapshot.thumbnailDataUrl || snapshot.imageDataUrl}
              alt=""
              className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Scan size={10} className="text-muted-foreground/30" />
            </div>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
            <ZoomIn size={12} className="text-white/0 group-hover:text-white transition-colors" />
          </span>
        </button>

        {/* Timestamp — clickable */}
        <button
          onClick={(e) => { e.stopPropagation(); handleJumpToTime() }}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary/20
                     transition-colors cursor-pointer group shrink-0"
          title={t('notes.playFrom')}
        >
          <Clock size={10} className="text-primary/70" />
          <span className="text-[0.6875rem] font-mono font-semibold text-primary">
            {formatTime(mapSourceTimeToClip(currentVideo, snapshot.timestamp) ?? snapshot.timestamp)}
          </span>
          <Play size={9} className="text-primary/50 group-hover:text-primary/80 transition-colors" />
        </button>

        {/* OCR pending indicator */}
        {isOCRPending && (
          <div className="flex items-center gap-1 text-[0.625rem] text-muted-foreground/60">
            <Loader2 size={10} className="animate-spin" />
            <span>{t('notes.waitingOcr')}</span>
          </div>
        )}

        <div className="flex-1" />

        {/* Expand/collapse */}
        <button
          onClick={(e) => { e.stopPropagation(); handleHeaderClick() }}
          className="p-1 rounded-lg hover:bg-secondary transition-colors cursor-pointer"
        >
          {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 animate-fade-in">
          {/* OCR Text (editable) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/50">{t('notes.subtitle')}</span>
              <div className="flex items-center gap-1">
                {snapshot.isCorrected && (
                  <span className="text-[0.5625rem] text-success/60 bg-success/5 px-1.5 py-0.5 rounded-full">{t('notes.edited')}</span>
                )}
                {!readOnly && !editingText && (
                  <button
                    onClick={() => { setEditValue(snapshot.ocrText); setEditingText(true) }}
                    className="p-1 rounded hover:bg-secondary transition-colors cursor-pointer"
                  >
                    <Pencil size={10} className="text-muted-foreground/50" />
                  </button>
                )}
              </div>
            </div>

            {editingText ? (
              <div className="flex gap-1">
                <textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 px-2 py-1.5 text-[0.8125rem] rounded-lg bg-background border border-border/50
                             text-foreground resize-none focus:outline-none focus:border-primary/50"
                  rows={2}
                />
                <div className="flex flex-col gap-1">
                  <button onClick={handleSaveText} className="p-1 rounded bg-success/10 text-success hover:bg-success/20 cursor-pointer">
                    <Check size={11} />
                  </button>
                  <button onClick={() => setEditingText(false)} className="p-1 rounded bg-secondary text-muted-foreground hover:bg-secondary/80 cursor-pointer">
                    <X size={11} />
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[0.8125rem] text-foreground/75 leading-relaxed bg-background/50 rounded-lg px-2.5 py-1.5 min-h-[1.5rem]">
                {snapshot.ocrText || (
                  <span className="text-muted-foreground/30 italic">{t('notes.waitingOcr')}</span>
                )}
              </p>
            )}

            {/* Re-OCR button — opens the fullscreen region selector */}
            {!readOnly && (
              <button
                onClick={() => { setShowReOCR(true); setReOCRError(null) }}
                className="mt-1 flex items-center gap-1 text-[0.625rem] text-muted-foreground/50 hover:text-primary/70 transition-colors cursor-pointer"
              >
                <Scan size={10} />
                {t('notes.reRecognize')}
              </button>
            )}
          </div>

          {/* Clickable words for dictionary/AI */}
          {displaySentence && (
            <div>
              <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/50 block mb-1">
                {t('notes.clickWord')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {sentenceSegments.map((seg, i) => {
                  // 单字符 token 保持纯文本（a / I / 连字符等），不做 chip。
                  if (seg.type === 'word' && seg.text.length <= 1) {
                    return <span key={i} className="text-[0.9375rem] text-foreground/70 py-0.5">{seg.raw} </span>
                  }
                  const isPhrase = seg.type === 'phrase'
                  const isSel = selectedWord === seg.text
                  const isSaved = savedWordSet.has(seg.text.toLowerCase())
                  return (
                    <span
                      key={i}
                      onClick={() => handleWordClick(seg.text)}
                      title={isPhrase ? seg.text : undefined}
                      className={`rounded px-1 py-0.5 text-[0.9375rem] leading-[1.35] font-medium
                        transition-all duration-150 cursor-pointer underline underline-offset-[3px]
                        ${isSel
                          ? 'font-semibold text-primary decoration-solid decoration-primary decoration-2'
                          : isSaved
                            ? 'text-[#b37400] decoration-solid decoration-[#ff9f0a] decoration-2'
                            : isPhrase
                              ? 'text-foreground/85 decoration-solid decoration-primary/40 decoration-1'
                              : 'text-foreground/80 decoration-dotted decoration-foreground/25 hover:opacity-85'}`}
                    >
                      {seg.raw}
                    </span>
                  )
                })}
              </div>

              {/* Word actions */}
              {selectedWord && (
                <div className="mt-2 space-y-2 animate-fade-in">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">{selectedWord}</span>
                    {!readOnly && <button
                      onClick={() => handleSaveWord(selectedWord)}
                      disabled={savedWordSet.has(selectedWord.toLowerCase())}
                      className={`flex items-center gap-1 px-2 py-0.5 text-[0.625rem] font-semibold rounded-lg transition-all cursor-pointer
                        ${savedWordSet.has(selectedWord.toLowerCase())
                          ? 'bg-success/15 text-success'
                          : 'bg-primary/15 text-primary hover:bg-primary/25'
                        } disabled:cursor-default`}
                    >
                      {savedWordSet.has(selectedWord.toLowerCase()) ? (
                        <><Check size={9} /> {t('notes.saved')}</>
                      ) : (
                        <><BookmarkPlus size={9} /> {t('notes.save')}</>
                      )}
                    </button>}
                    {!readOnly && (
                      <button
                        onClick={() => setShowAI(!showAI)}
                        className="flex items-center gap-1 px-2 py-0.5 text-[0.625rem] font-semibold rounded-lg
                                   bg-chart-3/10 text-chart-3 hover:bg-chart-3/20 transition-all cursor-pointer"
                      >
                        <Sparkles size={9} /> AI
                      </button>
                    )}
                  </div>

                  {/* Dictionary */}
                  <DictionaryLookup word={selectedWord} />

                  {/* AI Analysis */}
                  {showAI && (
                    <AIVocabAnalysis
                      word={selectedWord}
                      sentence={displaySentence}
                      contextBefore={transcriptContext?.contextBefore || ''}
                      contextAfter={transcriptContext?.contextAfter || ''}
                      snapshotId={snapshot.id}
                      noteId={noteId}
                      videoTimestamp={snapshot.timestamp}
                      onClose={() => setShowAI(false)}
                    />
                  )}

                  {/* #10 单词级批注：已保存的生词可单独写备注，同步到单词本/闪卡 */}
                  {(() => {
                    const saved = snapshot.words.find((x) => x.word.toLowerCase() === selectedWord.toLowerCase())
                    if (!saved) return null
                    // #8 备注单一数据源：以单词本（vocabularyStore）为准，单词本里的编辑能实时反映到视频侧。
                    const live = vocabWords.find((w) => w.id === saved.id)
                    const note = live?.userNote ?? saved.userNote
                    return (
                      <div className="pt-1 border-t border-border/20">
                        <div className="flex items-center justify-between mb-1">
                          <span className="flex items-center gap-1 text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/50">
                            <StickyNote size={10} /> {t('notes.myNotes')} · {selectedWord}
                          </span>
                          {!readOnly && !editingWordNote && (
                            <button
                              onClick={() => { setWordNoteDraft(note || ''); setEditingWordNote(true) }}
                              className="p-1 rounded hover:bg-secondary transition-colors cursor-pointer"
                            >
                              <Pencil size={10} className="text-muted-foreground/50" />
                            </button>
                          )}
                        </div>
                        {editingWordNote ? (
                          <div className="flex gap-1">
                            <textarea
                              value={wordNoteDraft}
                              onChange={(e) => setWordNoteDraft(e.target.value)}
                              placeholder={t('notes.addThoughts')}
                              rows={2}
                              className="flex-1 px-2 py-1.5 text-[0.8125rem] rounded-lg bg-background border border-border/50
                                         text-foreground resize-none focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/30"
                            />
                            <div className="flex flex-col gap-1">
                              <button onClick={handleSaveWordNote} className="p-1 rounded bg-success/10 text-success hover:bg-success/20 cursor-pointer">
                                <Check size={11} />
                              </button>
                              <button onClick={() => setEditingWordNote(false)} className="p-1 rounded bg-secondary text-muted-foreground hover:bg-secondary/80 cursor-pointer">
                                <X size={11} />
                              </button>
                            </div>
                          </div>
                        ) : note ? (
                          <p className="text-[0.8125rem] text-muted-foreground/70 leading-relaxed bg-background/50 rounded-lg px-2.5 py-1.5">
                            {note}
                          </p>
                        ) : (
                          <p className="text-[0.625rem] text-muted-foreground/30 italic">{t('notes.noNotes')}</p>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Saved words from this snapshot (带内联删除) */}
          {snapshot.words.length > 0 && (
            <div>
              <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/50 block mb-1">
                {t('notes.savedWords')}
              </span>
              <div className="flex flex-wrap gap-1">
                {snapshot.words.map((w) => (
                  <span key={w.id} className="inline-flex items-center gap-1 px-2 py-0.5 text-[0.6875rem] font-medium rounded-full
                                               bg-primary/10 text-primary/80">
                    {w.word}
                    {!readOnly && (
                      <button
                        onClick={() => handleDeleteSavedWord(w)}
                        title={t('notes.deleteWordHint')}
                        aria-label={`${t('notes.deleteWord')} ${w.word}`}
                        className="p-0.5 rounded-full text-primary/50 hover:text-destructive hover:bg-destructive/15 transition-colors cursor-pointer"
                      >
                        <X size={9} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* #10 删除这张截图（两步确认） */}
          {!readOnly && <button
            onClick={handleDeleteSnapshot}
            className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[0.625rem] font-medium
                        border transition-colors cursor-pointer ${
                          deleteConfirming
                            ? 'bg-destructive/15 border-destructive/40 text-destructive'
                            : 'border-border/40 text-muted-foreground/50 hover:text-destructive hover:border-destructive/30 hover:bg-destructive/5'
                        }`}
            title={deleteConfirming ? t('notes.confirmDelete') : t('notes.deleteSnapshotHint')}
          >
            {deleteConfirming ? (
              <><AlertCircle size={11} /> {t('notes.confirmDelete')}</>
            ) : (
              <><Trash2 size={11} /> {t('notes.deleteSnapshot')}</>
            )}
          </button>}
        </div>
      )}

      {/* ── Full-image lightbox (portal) ── */}
      {showFullImage &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setShowFullImage(false)}
          >
            <button
              onClick={() => setShowFullImage(false)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors cursor-pointer"
              title={t('notes.close')}
            >
              <X size={18} />
            </button>
            <img
              src={snapshot.imageDataUrl}
              alt={t('notes.fullFrame')}
              onClick={(e) => e.stopPropagation()}
              className="max-w-[96vw] max-h-[92vh] w-auto h-auto object-contain rounded-lg shadow-2xl shadow-black/60"
              style={{ width: 'auto', height: 'auto' }}
            />
          </div>,
          portalTarget(),
        )}

      {/* ── Fullscreen region re-select modal ── */}
      {showReOCR && (
        <RegionSelectModal
          imageDataUrl={snapshot.imageDataUrl}
          initialRegion={snapshot.ocrRegion}
          loading={reOCRLoading}
          error={reOCRError}
          onConfirm={handleReOCR}
          onClose={() => setShowReOCR(false)}
        />
      )}
    </div>
  )
}
