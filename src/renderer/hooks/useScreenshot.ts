import { useCallback } from 'react'
import { useNoteStore, DEFAULT_OCR_REGION } from '../stores/noteStore'
import { usePlayerStore } from '../stores/playerStore'
import { useSubtitleStore } from '../stores/subtitleStore'
import { useToastStore } from '../stores/toastStore'
import { useI18n } from '../i18n/useI18n'
import { captureScreenshot } from '../services/screenshot-engine'

export function useScreenshot() {
  const addSnapshot = useNoteStore((s) => s.addSnapshot)
  const enqueueOCR = useNoteStore((s) => s.enqueueOCR)
  const { t } = useI18n()

  const takeSnapshot = useCallback(async () => {
    const videoEl = usePlayerStore.getState().videoRef
    if (!videoEl || videoEl.readyState < 2) return null

    const currentTime = videoEl.currentTime

    // Get current subtitle text for the watermark
    const { subtitles, currentCueIndex } = useSubtitleStore.getState()
    const subtitleText =
      currentCueIndex >= 0 && currentCueIndex < subtitles.length
        ? subtitles[currentCueIndex].text
        : ''

    try {
      // Capture screenshot (raw video frame + timestamp watermark + subtitle text)
      const result = await captureScreenshot(videoEl, currentTime, subtitleText)
      if (!result) return null

      // Add snapshot to current note
      const snapshotId = addSnapshot({
        timestamp: currentTime,
        imageFileName: `snap_${Date.now()}.png`,
        imageDataUrl: result.dataUrl,
        thumbnailDataUrl: result.thumbnailDataUrl,
        filePath: result.filePath,
        ocrText: '',
        createdAt: Date.now(),
      })

      // Enqueue OCR (async, background) — prefer the video's custom region if the
      // user set one, else fall back to the shared default.
      const { videoOcrRegion } = useNoteStore.getState()
      enqueueOCR({
        snapshotId,
        imageDataUrl: result.dataUrl,
        region: { ...(videoOcrRegion ?? DEFAULT_OCR_REGION) },
      })

      // Confirm to the user: the snapshot was taken and which one it is
      // (index within the active note, 1-based).
      const { notes, activeNoteId } = useNoteStore.getState()
      const activeNote = notes.find((n) => n.id === activeNoteId)
      const count = activeNote ? activeNote.snapshots.length : 0
      useToastStore.getState().showToast(t('notes.screenshotSaved', { n: count }))

      return snapshotId
    } catch (err) {
      console.error('Failed to take screenshot:', err)
      return null
    }
  }, [addSnapshot, enqueueOCR, t])

  return { takeSnapshot }
}
