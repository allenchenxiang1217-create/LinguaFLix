import { create } from 'zustand'
import type { VideoMeta } from '@shared/types'
import { AppStorage, deleteNotebook } from '../services/storage-service'

interface AppState {
  // Data
  videos: Record<string, VideoMeta>
  lastVideoHash: string | null

  // UI
  appPhase: 'loading' | 'dashboard' | 'player'
  dashboardReturnView: 'library' | 'recent' | 'review' | 'clip'
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
  setDashboardReturnView: (view: AppState['dashboardReturnView']) => void

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
    dashboardReturnView: 'library',
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
      // Clean up associated notebook and screenshots from localStorage + disk
      void deleteNotebook(hash)
      localStorage.removeItem(`linguaflix-screenshots-${hash}`)
      // Persist with an explicit delete: persistAppData's union-merge would
      // otherwise resurrect the removed hash from a stale copy held by another tab.
      const persisted = AppStorage.load()
      const merged = { ...(persisted.videos || {}), ...get().videos }
      delete merged[hash]
      AppStorage.save({
        videos: merged,
        lastVideoHash: get().lastVideoHash ?? persisted.lastVideoHash ?? null,
      })
    },

    setAppPhase: (phase) => set({ appPhase: phase }),

    setDashboardReturnView: (view) => set({ dashboardReturnView: view }),

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
      // Merge (union) with what is already persisted instead of blind-replacing.
      // With two tabs/windows open, each store hydrates its own in-memory snapshot;
      // a stale tab that persists later (thumbnail capture on canplay, mark-opened,
      // etc.) would otherwise overwrite videos added by the other tab — the root
      // cause of "new video disappears after refresh". Unioning means a stale tab
      // can only add/update entries, never drop one it doesn't know about.
      const persisted = AppStorage.load()
      const merged = { ...(persisted.videos || {}), ...videos }
      AppStorage.save({
        videos: merged,
        lastVideoHash: lastVideoHash ?? persisted.lastVideoHash ?? null,
      })
    },
  }
})

// ── Cross-tab sync ──
// When another tab/window writes the app data (adds/removes a video), refresh
// this store's in-memory copy so it stays in sync. Without this, a stale tab
// keeps its old snapshot and would rely on persistAppData's union-merge to avoid
// clobbering — this listener additionally makes the dashboard update live.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== AppStorage.key) return
    const data = AppStorage.load()
    useAppStore.setState({ videos: data.videos || {}, lastVideoHash: data.lastVideoHash || null })
  })
}
