import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SubtitleCue, BlockerConfig, BlockerEffect } from '@shared/types'

const DEFAULT_BLOCKER: BlockerConfig = {
  xPercent: 5,
  yPercent: 85,
  widthPercent: 90,
  heightPercent: 12,
}

/** localStorage key for the blocker's persisted appearance. */
const BLOCKER_STORAGE_KEY = 'linguaflix-blocker-v1'

/** Sanitize a persisted blocker config so stale/corrupt data can't break layout. */
function sanitizeConfig(value: unknown): BlockerConfig | null {
  if (!value || typeof value !== 'object') return null
  const { xPercent, yPercent, widthPercent, heightPercent } = value as Record<string, unknown>
  const [x, y, w, h] = [xPercent, yPercent, widthPercent, heightPercent].map(Number)
  if ([x, y, w, h].some((n) => !Number.isFinite(n))) return null
  return {
    xPercent: Math.min(100, Math.max(0, x)),
    yPercent: Math.min(100, Math.max(0, y)),
    widthPercent: Math.min(100, Math.max(5, w)),
    heightPercent: Math.min(100, Math.max(2, h)),
  }
}

interface SubtitleState {
  subtitles: SubtitleCue[]
  subtitleFileName: string | null
  currentCueIndex: number
  blockerVisible: boolean
  blockerLocked: boolean
  blockerOpacity: number
  blockerEffect: BlockerEffect
  blockerConfig: BlockerConfig
}

interface SubtitleActions {
  loadSubtitles: (cues: SubtitleCue[], fileName?: string) => void
  clearSubtitles: () => void
  setCurrentCueIndex: (index: number) => void
  toggleBlocker: () => void
  setBlockerVisible: (visible: boolean) => void
  setBlockerLocked: (locked: boolean) => void
  setBlockerOpacity: (opacity: number) => void
  setBlockerEffect: (effect: BlockerEffect) => void
  updateBlockerConfig: (config: Partial<BlockerConfig>) => void
  /** Restore position/size/opacity/effect to defaults. */
  resetBlocker: () => void
}

export const useSubtitleStore = create<SubtitleState & SubtitleActions>()(
  persist(
    (set) => ({
      subtitles: [],
      subtitleFileName: null,
      currentCueIndex: -1,
      blockerVisible: true,
      blockerLocked: false,
      blockerOpacity: 1,
      blockerEffect: 'solid',
      blockerConfig: { ...DEFAULT_BLOCKER },

      loadSubtitles: (cues, fileName) =>
        set({ subtitles: cues, subtitleFileName: fileName || null, currentCueIndex: -1 }),

      clearSubtitles: () => set({ subtitles: [], subtitleFileName: null, currentCueIndex: -1 }),

      setCurrentCueIndex: (index) => set({ currentCueIndex: index }),

      toggleBlocker: () => set((s) => ({ blockerVisible: !s.blockerVisible })),

      setBlockerVisible: (visible) => set({ blockerVisible: visible }),

      setBlockerLocked: (locked) => set({ blockerLocked: locked }),

      setBlockerOpacity: (opacity) => set({ blockerOpacity: opacity }),

      setBlockerEffect: (effect) => set({ blockerEffect: effect }),

      updateBlockerConfig: (config) =>
        set((s) => ({ blockerConfig: { ...s.blockerConfig, ...config } })),

      resetBlocker: () =>
        set({ blockerConfig: { ...DEFAULT_BLOCKER }, blockerOpacity: 1, blockerEffect: 'solid' }),
    }),
    {
      // Persist the blocker's appearance so it keeps the last-adjust position,
      // size, opacity and effect across sessions. Transient state (visibility,
      // lock) is intentionally not persisted.
      name: BLOCKER_STORAGE_KEY,
      partialize: (s) => ({
        blockerConfig: s.blockerConfig,
        blockerOpacity: s.blockerOpacity,
        blockerEffect: s.blockerEffect,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SubtitleState>
        const next: SubtitleState & SubtitleActions = { ...current }
        const cfg = sanitizeConfig(p.blockerConfig)
        if (cfg) next.blockerConfig = cfg
        if (typeof p.blockerOpacity === 'number' && p.blockerOpacity >= 0 && p.blockerOpacity <= 1) {
          next.blockerOpacity = p.blockerOpacity
        }
        if (p.blockerEffect === 'solid' || p.blockerEffect === 'blur') next.blockerEffect = p.blockerEffect
        return next
      },
    },
  ),
)
