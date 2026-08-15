import { create } from 'zustand'
import type { VideoMeta } from '@shared/types'
import { AppStorage, deleteNotebook } from '../services/storage-service'

interface AppState {
  // Data
  videos: Record<string, VideoMeta>
  lastVideoHash: string | null

  // UI
  appPhase: 'loading' | 'dashboard' | 'player'
  streak: number    // consecutive days of learning

  // Stats
  totalWords: number
  todayReviewCount: number
  masteredCount: number   // sm2.repetition >= 3（简单阈值：连续答对≥3 次视为已掌握）
  totalDays: number       // 累计学习天数（distinct reviewedAt 日期数）
}

interface AppActions {
  // Video registry
  registerVideo: (meta: VideoMeta) => void
  removeVideo: (hash: string) => void
  markOpened: (hash: string) => void
  setVideoThumbnail: (hash: string, dataUrl: string) => void

  // Navigation
  setAppPhase: (phase: 'loading' | 'dashboard' | 'player') => void

  // Stats
  refreshStats: () => void
  computeStreak: () => number

  // Persistence
  persistAppData: () => void
}

// ── Helpers ──

function getVocabularyWords(): any[] {
  try {
    const raw = localStorage.getItem('linguaflix-vocabulary-v2')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export const useAppStore = create<AppState & AppActions>((set, get) => {
  const saved = AppStorage.load()

  return {
    videos: saved.videos || {},
    lastVideoHash: saved.lastVideoHash || null,
    appPhase: 'loading',
    streak: 0,
    totalWords: 0,
    todayReviewCount: 0,
    masteredCount: 0,
    totalDays: 0,

    registerVideo: (meta) => {
      set((s) => ({
        videos: { ...s.videos, [meta.hash]: { ...meta, lastOpenedAt: Date.now() } },
        lastVideoHash: meta.hash,
      }))
      get().persistAppData()
    },

    markOpened: (hash) => {
      set((s) => {
        const v = s.videos[hash]
        if (!v) return {}
        return {
          videos: { ...s.videos, [hash]: { ...v, lastOpenedAt: Date.now() } },
          lastVideoHash: hash,
        }
      })
      get().persistAppData()
    },

    setVideoThumbnail: (hash, dataUrl) => {
      set((s) => {
        const v = s.videos[hash]
        if (!v) return {}
        return { videos: { ...s.videos, [hash]: { ...v, thumbnailDataUrl: dataUrl } } }
      })
      get().persistAppData()
    },

    removeVideo: (hash) => {
      const { lastVideoHash } = get()
      set((s) => {
        const next = { ...s.videos }
        delete next[hash]
        return {
          videos: next,
          lastVideoHash: lastVideoHash === hash ? null : lastVideoHash,
        }
      })
      // Clean up associated notebook and screenshots from localStorage
      deleteNotebook(hash)
      localStorage.removeItem(`linguaflix-screenshots-${hash}`)
      get().persistAppData()
    },

    setAppPhase: (phase) => set({ appPhase: phase }),

    refreshStats: () => {
      const words = getVocabularyWords()
      const now = new Date().toISOString()
      const reviewDates = new Set<string>()
      for (const w of words) {
        if (w.reviewedAt) reviewDates.add(new Date(w.reviewedAt).toDateString())
      }
      set({
        totalWords: words.length,
        todayReviewCount: words.filter((w: any) => w.sm2?.dueDate <= now).length,
        masteredCount: words.filter((w: any) => (w.sm2?.repetition ?? 0) >= 3).length,
        totalDays: reviewDates.size,
        streak: get().computeStreak(),
      })
    },

    computeStreak: () => {
      const words = getVocabularyWords()
      const reviewDates = new Set<string>()
      for (const w of words) {
        if (w.reviewedAt) reviewDates.add(new Date(w.reviewedAt).toDateString())
      }
      let streak = 0
      const today = new Date()
      for (let i = 0; i < 365; i++) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        if (reviewDates.has(d.toDateString())) streak++
        else break
      }
      return streak
    },

    persistAppData: () => {
      const { videos, lastVideoHash } = get()
      AppStorage.save({ videos, lastVideoHash })
    },
  }
})
