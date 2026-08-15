import { create } from 'zustand'
import type { VocabWord, SM2State } from '@shared/types'
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

// ── Store ──

interface VocabState {
  words: VocabWord[]
}

interface VocabActions {
  /** 保存生词，返回落库后的完整条目（含真正落地的 id）——调用方应把返回值写进快照副本，
   *  保证「单词本条目」与「快照内副本」共享同一 id，单词级批注才能同步。 */
  addWord: (word: Omit<VocabWord, 'id' | 'sm2' | 'createdAt' | 'reviewedAt' | 'reviewCount' | 'userNote'> & { userNote?: string }) => VocabWord
  removeWord: (id: string) => void
  /** Review a word with SM-2 grading (0-5) */
  reviewWord: (id: string, grade: 0 | 1 | 2 | 3 | 4 | 5) => void
  /** #10 单词级批注：更新单词本中该词的 userNote（闪卡/单词本同步显示）。 */
  updateWordNote: (id: string, userNote: string) => void
}

function loadWords(): VocabWord[] {
  try {
    const data = localStorage.getItem('linguaflix-vocabulary-v2')
    if (data) return JSON.parse(data)
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
    const entry: VocabWord = {
      ...word,
      id: crypto.randomUUID(),
      userNote: word.userNote || '',
      sm2: defaultSM2(),
      createdAt: Date.now(),
      reviewedAt: null,
      reviewCount: 0,
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

  removeWord: (id) => {
    set((s) => ({
      words: s.words.filter((w) => w.id !== id),
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
