import { createPortal } from 'react-dom'
import { useSubtitleStore } from '../../stores/subtitleStore'
import { Eye, EyeOff, Lock, LockOpen, RotateCcw } from 'lucide-react'
import type { BlockerConfig, BlockerEffect } from '@shared/types'
import { useI18n } from '../../i18n/useI18n'
import { portalTarget } from '../../lib/portal'

/**
 * Quick position presets. The blocker is draggable/resizable on the video, but
 * these snap it back to a sensible spot in one click.
 */
const PRESETS: BlockerConfig[] = [
  { xPercent: 5, yPercent: 85, widthPercent: 90, heightPercent: 12 },
  { xPercent: 10, yPercent: 70, widthPercent: 80, heightPercent: 14 },
  { xPercent: 15, yPercent: 55, widthPercent: 70, heightPercent: 15 },
]
const PRESET_KEYS = ['blocker.bottom', 'blocker.midLow', 'blocker.middle'] as const

/**
 * Subtitle-blocker settings popover, rendered via a portal so it escapes the
 * player's z-index stack and can never be covered by the blocker or the
 * controls overlay. It is triggered from the player right tool rail (#4).
 */
export function BlockerPanel({ top, left, onClose }: { top: number; left: number; onClose: () => void }) {
  const { t } = useI18n()

  const visible = useSubtitleStore((s) => s.blockerVisible)
  const locked = useSubtitleStore((s) => s.blockerLocked)
  const opacity = useSubtitleStore((s) => s.blockerOpacity)
  const effect = useSubtitleStore((s) => s.blockerEffect)
  const setVisible = useSubtitleStore((s) => s.setBlockerVisible)
  const setLocked = useSubtitleStore((s) => s.setBlockerLocked)
  const setOpacity = useSubtitleStore((s) => s.setBlockerOpacity)
  const setEffect = useSubtitleStore((s) => s.setBlockerEffect)
  const updateConfig = useSubtitleStore((s) => s.updateBlockerConfig)
  const resetBlocker = useSubtitleStore((s) => s.resetBlocker)

  return createPortal(
    <>
      {/* Click-away backdrop */}
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        className="fixed z-[61] w-64 rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur-md
                       shadow-2xl shadow-black/60 p-3 animate-fade-in"
        style={{ top, left }}
      >
        {/* Opacity */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[0.6875rem] text-white/60">{t('blocker.opacity')}</span>
            <span className="text-[0.6875rem] font-mono text-white/80">{Math.round(opacity * 100)}%</span>
          </div>
          <input
            type="range"
            data-testid="blocker-opacity-slider"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
            className="w-full h-1 bg-white/15 rounded-full appearance-none cursor-pointer
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3
                       [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full
                       [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-lg"
          />
        </div>

        {/* Effect: solid cover vs blur */}
        <div className="mb-3">
          <span className="text-[0.6875rem] text-white/60 block mb-1.5">{t('blocker.effect')}</span>
          <div className="flex gap-1">
            {(['solid', 'blur'] as BlockerEffect[]).map((eff) => (
              <button
                key={eff}
                onClick={() => setEffect(eff)}
                className={`flex-1 px-1.5 py-1.5 text-[0.625rem] font-medium rounded-md transition-colors cursor-pointer
                  ${effect === eff
                    ? 'bg-primary/25 text-primary'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
              >
                {eff === 'solid' ? t('blocker.solid') : t('blocker.blur')}
              </button>
            ))}
          </div>
          {effect === 'blur' && (
            <p className="text-[0.5625rem] text-white/40 mt-1 leading-snug">
              {t('blocker.blurHint')}
            </p>
          )}
        </div>

        {/* Position presets */}
        <div className="mb-3">
          <span className="text-[0.6875rem] text-white/60 block mb-1.5">{t('blocker.position')}</span>
          <div className="flex gap-1">
            {PRESETS.map((cfg, i) => (
              <button
                key={i}
                onClick={() => updateConfig(cfg)}
                className="flex-1 px-1.5 py-1.5 text-[0.625rem] font-medium rounded-md bg-white/5
                           text-white/60 hover:bg-primary/20 hover:text-white transition-colors cursor-pointer"
              >
                {t(PRESET_KEYS[i])}
              </button>
            ))}
          </div>
        </div>

        {/* Visibility / lock / reset */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setVisible(!visible)}
            className="flex items-center gap-1.5 flex-1 justify-center px-2 py-1.5 text-[0.6875rem] rounded-md
                       bg-white/5 text-white/70 hover:bg-white/10 transition-colors cursor-pointer"
          >
            {visible ? <Eye size={12} /> : <EyeOff size={12} />}
            {visible ? t('blocker.visible') : t('blocker.hidden')}
          </button>
          <button
            onClick={() => setLocked(!locked)}
            className={`flex items-center gap-1.5 flex-1 justify-center px-2 py-1.5 text-[0.6875rem] rounded-md transition-colors cursor-pointer ${
              locked
                ? 'bg-success/20 text-success'
                : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            {locked ? <Lock size={12} /> : <LockOpen size={12} />}
            {locked ? t('blocker.locked') : t('blocker.lock')}
          </button>
          <button
            onClick={resetBlocker}
            title={t('blocker.resetHint')}
            className="flex items-center gap-1.5 flex-1 justify-center px-2 py-1.5 text-[0.6875rem] rounded-md
                       bg-white/5 text-white/70 hover:bg-white/10 transition-colors cursor-pointer"
          >
            <RotateCcw size={12} />
            {t('blocker.reset')}
          </button>
        </div>
      </div>
    </>,
    portalTarget(),
  )
}
