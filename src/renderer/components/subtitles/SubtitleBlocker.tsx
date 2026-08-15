import { useRef, useState, useCallback } from 'react'
import { useSubtitleStore } from '../../stores/subtitleStore'
import { useI18n } from '../../i18n/useI18n'

type DragMode = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-w' | 'resize-e' | null

export function SubtitleBlocker() {
  const { t } = useI18n()
  const blockerRef = useRef<HTMLDivElement>(null)
  const visible = useSubtitleStore((s) => s.blockerVisible)
  const locked = useSubtitleStore((s) => s.blockerLocked)
  const opacity = useSubtitleStore((s) => s.blockerOpacity)
  const effect = useSubtitleStore((s) => s.blockerEffect)
  const config = useSubtitleStore((s) => s.blockerConfig)
  const updateConfig = useSubtitleStore((s) => s.updateBlockerConfig)

  const [dragMode, setDragMode] = useState<DragMode>(null)
  const dragStart = useRef({ x: 0, y: 0, config })

  const getContainerRect = useCallback(() => {
    if (blockerRef.current?.parentElement) return blockerRef.current.parentElement.getBoundingClientRect()
    return { width: 1, height: 1 }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent, mode: DragMode) => {
    if (locked) return
    e.preventDefault(); e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDragMode(mode)
    dragStart.current = { x: e.clientX, y: e.clientY, config: { ...useSubtitleStore.getState().blockerConfig } }
  }, [locked])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragMode || locked) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    const rect = getContainerRect()
    const dpX = (dx / rect.width) * 100
    const dpY = (dy / rect.height) * 100
    const start = dragStart.current.config
    let newConfig = { ...start }

    switch (dragMode) {
      case 'move':
        newConfig.xPercent = Math.max(0, Math.min(100 - start.widthPercent, start.xPercent + dpX))
        newConfig.yPercent = Math.max(0, Math.min(100 - start.heightPercent, start.yPercent + dpY))
        break
      case 'resize-se':
        newConfig.widthPercent = Math.max(5, Math.min(100 - start.xPercent, start.widthPercent + dpX))
        newConfig.heightPercent = Math.max(2, Math.min(100 - start.yPercent, start.heightPercent + dpY))
        break
      case 'resize-sw':
        newConfig.xPercent = Math.max(0, start.xPercent + dpX)
        newConfig.widthPercent = Math.max(5, start.widthPercent - dpX)
        newConfig.heightPercent = Math.max(2, Math.min(100 - start.yPercent, start.heightPercent + dpY))
        break
      case 'resize-ne':
        newConfig.widthPercent = Math.max(5, Math.min(100 - start.xPercent, start.widthPercent + dpX))
        newConfig.yPercent = Math.max(0, start.yPercent + dpY)
        newConfig.heightPercent = Math.max(2, start.heightPercent - dpY)
        break
      case 'resize-nw':
        newConfig.xPercent = Math.max(0, start.xPercent + dpX)
        newConfig.widthPercent = Math.max(5, start.widthPercent - dpX)
        newConfig.yPercent = Math.max(0, start.yPercent + dpY)
        newConfig.heightPercent = Math.max(2, start.heightPercent - dpY)
        break
      case 'resize-n': newConfig.yPercent = Math.max(0, start.yPercent + dpY); newConfig.heightPercent = Math.max(2, start.heightPercent - dpY); break
      case 'resize-s': newConfig.heightPercent = Math.max(2, Math.min(100 - start.yPercent, start.heightPercent + dpY)); break
      case 'resize-w': newConfig.xPercent = Math.max(0, start.xPercent + dpX); newConfig.widthPercent = Math.max(5, start.widthPercent - dpX); break
      case 'resize-e': newConfig.widthPercent = Math.max(5, Math.min(100 - start.xPercent, start.widthPercent + dpX)); break
    }
    updateConfig(newConfig)
  }, [dragMode, locked, getContainerRect, updateConfig])

  const handlePointerUp = useCallback(() => setDragMode(null), [])

  if (!visible) return null

  // Solid: an opaque-ish panel that hides the subtitles behind it.
  // Blur: a frosted glass that blurs the text while keeping the video visible.
  const isBlur = effect === 'blur'
  const bodyClasses = isBlur
    ? `bg-background/10 backdrop-blur-2xl border ${locked ? 'border-success/30 shadow-lg shadow-success/5' : 'border-white/15'}`
    : `bg-background/90 backdrop-blur-sm border-2 ${locked ? 'border-success/30 shadow-lg shadow-success/5' : 'border-primary/40 hover:border-primary/60 shadow-xl shadow-primary/5'}`

  return (
    <div
      ref={blockerRef}
      data-testid="subtitle-blocker"
      className={`absolute z-40 select-none touch-none ${locked ? 'pointer-events-none' : ''}`}
      style={{ left: `${config.xPercent}%`, top: `${config.yPercent}%`, width: `${config.widthPercent}%`, height: `${config.heightPercent}%` }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Blocker body */}
      <div
        className={`w-full h-full rounded-lg transition-all duration-200 ${bodyClasses}
          ${dragMode ? 'border-primary shadow-2xl shadow-primary/10' : ''}`}
        style={{ opacity }}
        onPointerDown={(e) => handlePointerDown(e, 'move')}
      >
        {locked && (
          <div className="absolute top-1.5 left-2.5 text-[0.625rem] text-success/80 font-mono font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            {t('blocker.locked')}
          </div>
        )}
        {!locked && !dragMode && (
          <div className="absolute inset-0 flex items-center justify-center text-foreground/10 text-[0.625rem] font-medium select-none pointer-events-none">
            {t('blocker.dragHint')}
          </div>
        )}
      </div>

      {/* Resize handles */}
      {!locked && (
        <>
          {(['nw','ne','sw','se','n','s','w','e'] as const).map((pos) => {
            const posMap: Record<string, string> = {
              nw: 'top-0 left-0', ne: 'top-0 right-0', sw: 'bottom-0 left-0', se: 'bottom-0 right-0',
              n: 'top-0 left-1/2 -translate-x-1/2', s: 'bottom-0 left-1/2 -translate-x-1/2',
              w: 'left-0 top-1/2 -translate-y-1/2', e: 'right-0 top-1/2 -translate-y-1/2',
            }
            const cursorMap: Record<string, string> = {
              nw: 'nw-resize', ne: 'ne-resize', sw: 'sw-resize', se: 'se-resize',
              n: 'n-resize', s: 's-resize', w: 'w-resize', e: 'e-resize',
            }
            return (
              <div
                key={pos}
                className={`absolute w-3.5 h-3.5 bg-primary/80 border-2 border-white/20 rounded-full
                            opacity-0 hover:opacity-100 transition-all duration-150 z-30
                            hover:scale-125 shadow-lg ${posMap[pos]}`}
                style={{ cursor: cursorMap[pos], margin: '-6px' }}
                onPointerDown={(e) => handlePointerDown(e, `resize-${pos}` as DragMode)}
              />
            )
          })}
        </>
      )}
    </div>
  )
}
