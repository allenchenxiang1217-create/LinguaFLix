import { useState } from 'react'
import { usePlayerStore } from '../../stores/playerStore'
import { useNoteStore, DEFAULT_OCR_REGION } from '../../stores/noteStore'
import { useToastStore } from '../../stores/toastStore'
import { RegionSelectModal } from '../sidebar/RegionSelectModal'
import { captureFrame } from '../../services/screenshot-engine'
import type { OCRRegion } from '@shared/types'
import { Scan, Check, RotateCcw } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

/**
 * "Set OCR region" control, rendered in the transcript panel header (variant
 * "full") and the player right tool rail (variant "icon").
 *
 * Lets the user pick a frame with English (hard-coded) subtitles and draw a box
 * around the subtitle area once per video. The region is saved per-video and
 * used for all subsequent screenshot OCR — a big accuracy win since a video's
 * subtitle position is basically fixed.
 */
export function OcrRegionButton({ variant = 'full' }: { variant?: 'full' | 'icon' }) {
  const [open, setOpen] = useState(false)
  const [frame, setFrame] = useState<string | null>(null)

  const videoOcrRegion = useNoteStore((s) => s.videoOcrRegion)
  const setVideoOcrRegion = useNoteStore((s) => s.setVideoOcrRegion)
  const hasCustom = !!videoOcrRegion
  const { t } = useI18n()

  const handleOpen = () => {
    const videoEl = usePlayerStore.getState().videoRef
    if (!videoEl || videoEl.readyState < 2) return

    // Freeze the frame so the captured image is stable while the user draws.
    usePlayerStore.getState().pause()

    const dataUrl = captureFrame(videoEl)
    if (!dataUrl) return
    setFrame(dataUrl)
    setOpen(true)
  }

  const handleConfirm = (region: OCRRegion) => {
    setVideoOcrRegion(region)
    setOpen(false)
    useToastStore.getState().showToast(t('transcript.ocrSaved'))
  }

  const handleReset = () => {
    setVideoOcrRegion(null)
    useToastStore.getState().showToast(t('transcript.ocrReset'))
  }

  if (variant === 'icon') {
    return (
      <>
        <button
          onClick={handleOpen}
          data-testid="ocr-region-btn"
          title={hasCustom ? t('transcript.ocrRegionSet') : t('transcript.setOcrHint')}
          className={`w-9 h-9 rounded-xl border backdrop-blur-sm grid place-items-center transition-colors cursor-pointer
            ${hasCustom
              ? 'bg-success/20 border-success/30 text-success'
              : 'bg-black/40 border-white/10 text-white/70 hover:text-white hover:bg-black/60'}`}
        >
          {hasCustom ? <Check size={15} /> : <Scan size={15} />}
        </button>

        {open && frame && (
          <RegionSelectModal
            imageDataUrl={frame}
            initialRegion={videoOcrRegion ?? DEFAULT_OCR_REGION}
            confirmLabel={t('transcript.saveRegion')}
            onConfirm={handleConfirm}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    )
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {hasCustom && (
          <button
            onClick={handleReset}
            title={t('transcript.resetOcrRegion')}
            className="flex items-center gap-1 px-1.5 py-1 text-[0.625rem] rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
          >
            <RotateCcw size={11} />
          </button>
        )}
        <button
          onClick={handleOpen}
          title={t('transcript.setOcrHint')}
          className={`flex items-center gap-1.5 px-2 py-1 text-[0.625rem] font-medium rounded-md border transition-colors cursor-pointer ${
            hasCustom
              ? 'border-success/30 bg-success/10 text-success hover:bg-success/15'
              : 'border-border/50 bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
          }`}
        >
          {hasCustom ? <Check size={11} /> : <Scan size={11} />}
          <span>{hasCustom ? t('transcript.ocrRegionSet') : t('transcript.setOcrRegion')}</span>
        </button>
      </div>

      {open && frame && (
        <RegionSelectModal
          imageDataUrl={frame}
          initialRegion={videoOcrRegion ?? DEFAULT_OCR_REGION}
          confirmLabel={t('transcript.saveRegion')}
          onConfirm={handleConfirm}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
