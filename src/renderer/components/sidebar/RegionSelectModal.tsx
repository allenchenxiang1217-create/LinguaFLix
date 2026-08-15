import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { OCRRegion } from '@shared/types'
import { X, Scan, Loader2 } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

interface RegionSelectModalProps {
  imageDataUrl: string
  initialRegion: OCRRegion
  loading?: boolean
  error?: string | null
  confirmLabel?: string
  onConfirm: (region: OCRRegion) => void
  onClose: () => void
}

/** Resize handle directions, each with its position + cursor. */
type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const HANDLES: { dir: Dir; className: string }[] = [
  { dir: 'nw', className: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
  { dir: 'n', className: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize' },
  { dir: 'ne', className: 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
  { dir: 'e', className: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
  { dir: 'se', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },
  { dir: 's', className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize' },
  { dir: 'sw', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
  { dir: 'w', className: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const MIN_SIZE = 0.02

/**
 * Fullscreen modal for re-selecting the subtitle region before re-running OCR.
 *
 * Shows the snapshot's full frame large, with a draggable / resizable selection
 * box. The region is stored as fractional coords (0-1) so it maps cleanly back
 * to the stored OCRRegion regardless of display size.
 */
export function RegionSelectModal({
  imageDataUrl,
  initialRegion,
  loading,
  error,
  confirmLabel,
  onConfirm,
  onClose,
}: RegionSelectModalProps) {
  const { t } = useI18n()
  const resolvedLabel = confirmLabel || t('regionSelect.recognize')
  const [region, setRegion] = useState<OCRRegion>(initialRegion)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    mode: 'move' | 'resize'
    dir?: Dir
    startX: number
    startY: number
    startRegion: OCRRegion
  } | null>(null)

  // Size the image container to fit the screen while keeping the frame's
  // aspect ratio, so fractional coords == exact pixel positions inside it.
  const containerStyle = useCallback(() => {
    if (!imgSize) return { width: '100%', height: 'auto', aspectRatio: '16 / 9' }
    const availW = window.innerWidth * 0.92
    const availH = window.innerHeight * 0.78
    const ratio = imgSize.w / imgSize.h
    let w = availW
    let h = w / ratio
    if (h > availH) {
      h = availH
      w = h * ratio
    }
    return { width: `${Math.round(w)}px`, height: `${Math.round(h)}px` }
  }, [imgSize])

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current
    const el = containerRef.current
    if (!drag || !el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return
    const dx = (e.clientX - drag.startX) / rect.width
    const dy = (e.clientY - drag.startY) / rect.height
    const r = drag.startRegion

    // Move: shift the box, clamped to the frame bounds.
    if (drag.mode === 'move') {
      setRegion({
        x: clamp(r.x + dx, 0, 1 - r.w),
        y: clamp(r.y + dy, 0, 1 - r.h),
        w: r.w,
        h: r.h,
      })
      return
    }

    // Resize: adjust edges/corners per direction, clamped to bounds + min size.
    let { x, y, w, h } = r
    const dir = drag.dir!
    if (dir.includes('e')) w = clamp(r.w + dx, MIN_SIZE, 1 - r.x)
    if (dir.includes('s')) h = clamp(r.h + dy, MIN_SIZE, 1 - r.y)
    if (dir.includes('w')) {
      const nx = clamp(r.x + dx, 0, r.x + r.w - MIN_SIZE)
      w = r.w + (r.x - nx)
      x = nx
    }
    if (dir.includes('n')) {
      const ny = clamp(r.y + dy, 0, r.y + r.h - MIN_SIZE)
      h = r.h + (r.y - ny)
      y = ny
    }
    setRegion({ x, y, w, h })
  }, [])

  const handlePointerUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
  }, [handlePointerMove])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, mode: 'move' | 'resize', dir?: Dir) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = { mode, dir, startX: e.clientX, startY: e.clientY, startRegion: region }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [region, handlePointerMove, handlePointerUp],
  )

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/85 backdrop-blur-sm animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-xs font-medium text-white/70">
          {t('regionSelect.hint')}        </span>
        <button
          onClick={onClose}
          className="p-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors cursor-pointer"
          title={t('regionSelect.close')}
        >
          <X size={16} />
        </button>
      </div>

      {/* Image area */}
      <div className="flex-1 flex items-center justify-center min-h-0 px-4 pb-2">
        <div
          ref={containerRef}
          className="relative bg-black rounded-lg shadow-2xl shadow-black/60 select-none touch-none"
          style={containerStyle()}
        >
          <img
            src={imageDataUrl}
            alt={t('regionSelect.subtitleRegion')}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget
              setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
            }}
            className="w-full h-full object-contain pointer-events-none rounded-lg"
          />

          {/* Selection box */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'move')}
            className="absolute border-2 border-primary bg-primary/10 cursor-move"
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.w * 100}%`,
              height: `${region.h * 100}%`,
            }}
          >
            {HANDLES.map((h) => (
              <div
                key={h.dir}
                onPointerDown={(e) => handlePointerDown(e, 'resize', h.dir)}
                className={`absolute w-3 h-3 bg-primary border border-white rounded-sm shadow ${h.className}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-2 px-4 py-4 shrink-0">
        {error && <span className="text-[0.6875rem] text-destructive mr-2">{error}</span>}
        <button
          onClick={onClose}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-white/10 text-white/70 hover:bg-white/20 transition-colors cursor-pointer"
        >
          {t('regionSelect.cancel')}
        </button>
        <button
          onClick={() => onConfirm(region)}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/80 transition-colors cursor-pointer disabled:opacity-50"
        >
          {loading ? (
            <><Loader2 size={12} className="animate-spin" /> {t('regionSelect.recognizing')}</>
          ) : (
            <><Scan size={12} /> {resolvedLabel}</>
          )}
        </button>
      </div>
    </div>,
    document.body,
  )
}
