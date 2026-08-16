import { create } from 'zustand'
import type { VocabWord, SM2State, WordOccurrence } from '@shared/types'
import { supermemo } from 'supermemo'

// ── SM-2 Helpers ──

function defaultSM2(): SM2State {
  return {
    interval: 0,
    repetition: 0,
    efactor: 2.5,
    dueDate: new Date().toISOString(),
  }
}

/** Run SM-2 on a word after user reviews it.
 *  grade: 5 = perfect, 4 = correct with hesitation, 3 = difficult, 2 = wrong, 1 = wrong, 0 = blackout */
export function applySM2(word: VocabWord, grade: 0 | 1 | 2 | 3 | 4 | 5): VocabWord {
  const result = supermemo(
    { interval: word.sm2.interval, repetition: word.sm2.repetition, efactor: word.sm2.efactor },
    grade,
  )
  return {
    ...word,
    sm2: {
      interval: result.interval,
      repetition: result.repetition,
      efactor: result.efactor,
      dueDate: new Date(Date.now() + result.interval * 86400000).toISOString(),
    },
    reviewedAt: Date.now(),
    reviewCount: word.reviewCount + 1,
  }
}

// ── #7 occurrences helpers ──

/** 取一个单词的全部出处，最早的在最前。老数据没有 occurrences 时按主字段合成。 */
export function occurrencesOf(word: VocabWord): WordOccurrence[] {
  if (word.occurrences && word.occurrences.length > 0) return word.occurrences
  return [
    {
      snapshotId: word.snapshotId,
      noteId: word.noteId,
      videoHash: word.videoHash,
      videoTimestamp: word.videoTimestamp,
      createdAt: word.createdAt,
    },
  ]
}

// ── Store ──

interface VocabState {
  words: VocabWord[]
}

interface VocabActions {
  /** 保存生词，返回落库后的完整条目（含真正落地的 id）——调用方应把返回值写进快照副本，
   *  保证「单词本条目」与「快照内副本」共享同一 id，单词级批注才能同步。
   *  #7 按单词去重：同一词（忽略大小写）已存在时合并出处（recordCount+1），
   *  返回已存在的条目而不是新建，避免单词本里出现重复单词。 */
  addWord: (word: Omit<VocabWord, 'id' | 'sm2' | 'createdAt' | 'reviewedAt' | 'reviewCount' | 'userNote' | 'occurrences' | 'recordCount'> & { userNote?: string }) => VocabWord
  removeWord: (id: string) => void
  /** #7 删除单词的某一条出处（内联删除）。删到 0 条时整个单词删除；否则只移除该出处并
   *  更新主字段（若删的是最早主出处，则顺位到次早出处）。 */
  removeWordOccurrence: (id: string, snapshotId: string, videoTimestamp: number) => void
  /** Review a word with SM-2 grading (0-5) */
  reviewWord: (id: string, grade: 0 | 1 | 2 | 3 | 4 | 5) => void
  /** #10 单词级批注：更新单词本中该词的 userNote（闪卡/单词本同步显示）。 */
  updateWordNote: (id: string, userNote: string) => void
  /** #4 闪卡 AI 分析：把分析结果写回该词（闪卡/单词本同步显示）。 */
  setWordAiAnalysis: (id: string, aiAnalysis: string) => void
}

function loadWords(): VocabWord[] {
  try {
    const data = localStorage.getItem('linguaflix-vocabulary-v2')
    if (!data) return []
    const words: VocabWord[] = JSON.parse(data)
    // #7 迁移：老数据没有 occurrences/recordCount，按主字段补一份（最早出处）。
    for (const w of words) {
      if (!w.occurrences || w.occurrences.length === 0) {
        w.occurrences = [
          {
            snapshotId: w.snapshotId,
            noteId: w.noteId,
            videoHash: w.videoHash,
            videoTimestamp: w.videoTimestamp,
            createdAt: w.createdAt,
          },
        ]
      }
      if (w.recordCount == null) w.recordCount = w.occurrences.length
    }
    return words
  } catch { /* ignore */ }
  return []
}

function persistWords(words: VocabWord[]): void {
  try {
    localStorage.setItem('linguaflix-vocabulary-v2', JSON.stringify(words))
  } catch { /* ignore */ }
}

export const useVocabularyStore = create<VocabState & VocabActions>((set, get) => ({
  words: loadWords(),

  addWord: (word) => {
    const key = word.word.trim().toLowerCase()
    const occ: WordOccurrence = {
      snapshotId: word.snapshotId,
      noteId: word.noteId,
      videoHash: word.videoHash,
      videoTimestamp: word.videoTimestamp,
      createdAt: Date.now(),
    }

    // #7 去重合并：同词已存在 → 追加出处（同一帧重复保存则跳过），不新建条目。
    const existing = get().words.find((w) => w.word.trim().toLowerCase() === key)
    if (existing) {
      const occs = occurrencesOf(existing)
      const dup = occs.some((o) => o.snapshotId === occ.snapshotId && o.videoTimestamp === occ.videoTimestamp)
      if (!dup) {
        const merged: VocabWord = {
          ...existing,
          occurrences: [...occs, occ],
          recordCount: occs.length + 1,
        }
        set((s) => ({ words: s.words.map((w) => (w.id === existing.id ? merged : w)) }))
        persistWords(get().words)
        return merged
      }
      return existing
    }

    const entry: VocabWord = {
      ...word,
      id: crypto.randomUUID(),
      userNote: word.userNote || '',
      sm2: defaultSM2(),
      createdAt: Date.now(),
      reviewedAt: null,
      reviewCount: 0,
      occurrences: [occ],
      recordCount: 1,
    }
    set((s) => ({ words: [entry, ...s.words] }))
    persistWords(get().words)
    return entry
  },

  updateWordNote: (id, userNote) => {
    set((s) => ({
      words: s.words.map((w) => (w.id === id ? { ...w, userNote } : w)),
    }))
    persistWords(get().words)
  },

  setWordAiAnalysis: (id, aiAnalysis) => {
    set((s) => ({
      words: s.words.map((w) => (w.id === id ? { ...w, aiAnalysis } : w)),
    }))
    persistWords(get().words)
  },

  removeWord: (id) => {
    set((s) => ({
      words: s.words.filter((w) => w.id !== id),
    }))
    persistWords(get().words)
  },

  removeWordOccurrence: (id, snapshotId, videoTimestamp) => {
    set((s) => ({
      words: s.words.flatMap((w) => {
        if (w.id !== id) return [w]
        const occs = occurrencesOf(w).filter(
          (o) => !(o.snapshotId === snapshotId && o.videoTimestamp === videoTimestamp),
        )
        if (occs.length === 0) return [] // 最后一条出处也没了 → 整个单词删除
        let next: VocabWord = { ...w, occurrences: occs, recordCount: occs.length }
        // 删的是最早主出处 → 顺位到次早出处作为新的主字段。
        if (w.snapshotId === snapshotId && w.videoTimestamp === videoTimestamp) {
          const earliest = occs.slice().sort((a, b) => a.createdAt - b.createdAt)[0]
          next = {
            ...next,
            snapshotId: earliest.snapshotId,
            noteId: earliest.noteId,
            videoHash: earliest.videoHash,
            videoTimestamp: earliest.videoTimestamp,
          }
        }
        return [next]
      }),
    }))
    persistWords(get().words)
  },

  reviewWord: (id, grade) => {
    set((s) => ({
      words: s.words.map((w) => (w.id === id ? applySM2(w, grade) : w)),
    }))
    persistWords(get().words)
  },

}))
