import { useCallback, useRef } from 'react'
import { useSubtitleStore } from '../stores/subtitleStore'
import { parseSubtitleFile } from '../services/subtitle-parser'

export function useSubtitle() {
  const store = useSubtitleStore()
  const lastCheckRef = useRef(0)

  /** Load subtitle file content */
  const loadSubtitleFile = useCallback(
    async (content: string, fileName?: string) => {
      const cues = parseSubtitleFile(content, fileName)
      store.loadSubtitles(cues, fileName)
    },
    [store],
  )

  /** Sync current subtitle cue index based on video time (called on timeupdate) */
  const syncCueIndex = useCallback(
    (currentTime: number) => {
      // Throttle to ~5fps to avoid excessive computation
      const now = performance.now()
      if (now - lastCheckRef.current < 200) return
      lastCheckRef.current = now

      const { subtitles, currentCueIndex } = useSubtitleStore.getState()
      if (subtitles.length === 0) return

      // Binary search for the cue that contains currentTime
      let lo = 0
      let hi = subtitles.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const cue = subtitles[mid]
        if (currentTime < cue.startTime) {
          hi = mid - 1
        } else if (currentTime > cue.endTime) {
          lo = mid + 1
        } else {
          // Found the active cue
          if (mid !== currentCueIndex) {
            store.setCurrentCueIndex(mid)
          }
          return
        }
      }
      // No active cue
      if (currentCueIndex !== -1) {
        store.setCurrentCueIndex(-1)
      }
    },
    [store],
  )

  return {
    loadSubtitleFile,
    syncCueIndex,
    subtitles: store.subtitles,
    currentCueIndex: store.currentCueIndex,
    subtitleFileName: store.subtitleFileName,
  }
}
