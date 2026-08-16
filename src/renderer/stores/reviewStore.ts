import { create } from 'zustand'
import type { VocabWord } from '@shared/types'

export type ReviewMode = 'list' | 'review'

/**
 * 复习会话状态。
 *
 * 为什么放在 store：ReviewQueue 挂在 Dashboard 上，跳到播放器时整个 Dashboard
 * 卸载（appPhase 切换），本地 useState 会全丢。放在 zustand store 里，同一页面
 * 会话内跨 appPhase 存活，从闪卡/列表「看视频」再返回时能原样恢复进度与视图。
 */
interface ReviewState {
  mode: ReviewMode
  queue: VocabWord[]      // 进入复习时的 due 快照
  idx: number
  flipped: boolean
  remembered: number
  done: boolean
  /** 从复习界面跳视频 → 返回时 navView 应回到 review（而非 library） */
  returnToReview: boolean
}

interface ReviewActions {
  startReview: (queue: VocabWord[]) => void
  /** 答题后前进：翻回正面并切到下一词；到末尾则置 done。 */
  next: () => void
  exit: () => void
  setFlipped: (flipped: boolean) => void
  incRemembered: () => void
  setReturnToReview: (v: boolean) => void
  reset: () => void
  /** #4 闪卡 AI 分析：把流式结果写回队列快照，当前卡实时显示（不持久化，落库走 vocabularyStore）。 */
  setWordAnalysis: (id: string, aiAnalysis: string) => void
}

export const useReviewStore = create<ReviewState & ReviewActions>((set) => ({
  mode: 'list',
  queue: [],
  idx: 0,
  flipped: false,
  remembered: 0,
  done: false,
  returnToReview: false,

  startReview: (queue) =>
    set({ mode: 'review', queue, idx: 0, flipped: false, remembered: 0, done: false }),

  next: () =>
    set((s) =>
      s.idx + 1 < s.queue.length
        ? { flipped: false, idx: s.idx + 1 }
        : { flipped: false, done: true },
    ),

  exit: () =>
    set({ mode: 'list', queue: [], idx: 0, flipped: false, remembered: 0, done: false }),

  setFlipped: (flipped) => set({ flipped }),
  incRemembered: () => set((s) => ({ remembered: s.remembered + 1 })),
  setReturnToReview: (returnToReview) => set({ returnToReview }),
  setWordAnalysis: (id, aiAnalysis) =>
    set((s) => ({ queue: s.queue.map((w) => (w.id === id ? { ...w, aiAnalysis } : w)) })),
  reset: () => set({ mode: 'list', queue: [], idx: 0, flipped: false, remembered: 0, done: false, returnToReview: false }),
}))
