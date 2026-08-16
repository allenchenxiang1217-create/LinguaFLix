import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePlayerStore } from '../../stores/playerStore'
import { useSubtitleStore } from '../../stores/subtitleStore'
import { Eye, EyeOff, SquareDashed, Gauge, Volume2, VolumeX } from 'lucide-react'
import { BlockerPanel } from '../subtitles/BlockerSettings'
import { OcrRegionButton } from '../transcript/OcrRegionButton'
import { useI18n } from '../../i18n/useI18n'
import { portalTarget } from '../../lib/portal'

/**
 * #4 右侧工具栏：把倍速、音量、挡块调节与 OCR 区域收敛到视频右侧一条纵向工具条，
 * 底部控制条（VideoControls）相应精简。
 */
type PanelKind = 'blocker' | 'speed' | 'volume' | null

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** 通用悬浮卡：portal 保证不被视频/控制条 z-index 覆盖。 */
function ToolCard({ top, left, width = 232, onClose, children }: {
  top: number; left: number; width?: number; onClose: () => void; children: React.ReactNode
}) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        className="fixed z-[61] rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur-md
                       shadow-2xl shadow-black/60 p-3 animate-fade-in"
        style={{ top, left, width }}
      >
        {children}
      </div>
    </>,
    portalTarget(),
  )
}

export function PlayerToolRail() {
  const { t } = useI18n()
  const [panel, setPanel] = useState<PanelKind>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const lastBtnRef = useRef<HTMLButtonElement | null>(null)

  const blockerVisible = useSubtitleStore((s) => s.blockerVisible)
  const setBlockerVisible = useSubtitleStore((s) => s.setBlockerVisible)
  const playbackRate = usePlayerStore((s) => s.playbackRate)
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate)
  const volume = usePlayerStore((s) => s.volume)
  const setVolume = usePlayerStore((s) => s.setVolume)

  const openPanel = (kind: Exclude<PanelKind, null>, e: React.MouseEvent<HTMLButtonElement>) => {
    if (panel === kind) { setPanel(null); return }
    lastBtnRef.current = e.currentTarget
    const r = e.currentTarget.getBoundingClientRect()
    // 面板向左展开，垂直对准按钮中部。
    setPos({ top: r.top + r.height / 2 - 18, left: Math.max(8, r.right - 268) })
    setPanel(kind)
  }

  // Close on Escape
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel])

  const railBtn = 'w-9 h-9 rounded-xl border backdrop-blur-sm grid place-items-center transition-colors cursor-pointer'

  return (
    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-1.5">
      {/* 挡块显示/隐藏 */}
      <button
        data-testid="blocker-visibility-btn"
        onClick={() => setBlockerVisible(!blockerVisible)}
        title={blockerVisible ? t('toolrail.blockerHide') : t('toolrail.blockerShow')}
        className={`${railBtn} ${
          blockerVisible
            ? 'bg-black/40 border-white/10 text-white/70 hover:text-white hover:bg-black/60'
            : 'bg-primary/25 border-primary/40 text-primary'
        }`}
      >
        {blockerVisible ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>

      {/* 挡块设置 */}
      <button
        data-testid="blocker-settings-btn"
        onClick={(e) => openPanel('blocker', e)}
        title={t('blocker.settingsHint')}
        className={`${railBtn} ${panel === 'blocker'
          ? 'bg-primary/25 border-primary/40 text-primary'
          : 'bg-black/40 border-white/10 text-white/70 hover:text-white hover:bg-black/60'}`}
      >
        <SquareDashed size={15} />
      </button>

      {/* OCR 区域 */}
      <OcrRegionButton variant="icon" />

      {/* 倍速 */}
      <button
        data-testid="speed-btn"
        onClick={(e) => openPanel('speed', e)}
        title={t('toolrail.speed')}
        className={`${railBtn} relative ${
          panel === 'speed' || playbackRate !== 1
            ? 'bg-primary/25 border-primary/40 text-primary'
            : 'bg-black/40 border-white/10 text-white/70 hover:text-white hover:bg-black/60'
        }`}
      >
        <Gauge size={15} />
        {playbackRate !== 1 && (
          <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground
                           text-[0.5rem] font-bold grid place-items-center leading-none">
            {playbackRate}
          </span>
        )}
      </button>

      {/* 音量 */}
      <button
        data-testid="volume-btn"
        onClick={(e) => openPanel('volume', e)}
        title={t('toolrail.volume')}
        className={`${railBtn} ${
          panel === 'volume' || volume === 0
            ? volume === 0 ? 'bg-destructive/25 border-destructive/40 text-destructive' : 'bg-primary/25 border-primary/40 text-primary'
            : 'bg-black/40 border-white/10 text-white/70 hover:text-white hover:bg-black/60'
        }`}
      >
        {volume > 0 ? <Volume2 size={15} /> : <VolumeX size={15} />}
      </button>

      {/* 面板 */}
      {panel === 'blocker' && pos && (
        <BlockerPanel top={pos.top} left={pos.left} onClose={() => setPanel(null)} />
      )}

      {panel === 'speed' && pos && (
        <ToolCard top={pos.top} left={pos.left} onClose={() => setPanel(null)}>
          <div className="grid grid-cols-3 gap-1">
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                onClick={() => { setPlaybackRate(speed); setPanel(null) }}
                className={`h-8 rounded-lg text-[0.6875rem] font-medium transition-colors cursor-pointer ${
                  playbackRate === speed
                    ? 'bg-primary/25 text-primary'
                    : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                {speed}×
              </button>
            ))}
          </div>
        </ToolCard>
      )}

      {panel === 'volume' && pos && (
        <ToolCard top={pos.top} left={pos.left} width={200} onClose={() => setPanel(null)}>
          <div className="flex items-center gap-2">
            {volume > 0 ? <Volume2 size={13} className="text-white/60 shrink-0" /> : <VolumeX size={13} className="text-white/60 shrink-0" />}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-full h-1 bg-white/15 rounded-full appearance-none cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3
                         [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full
                         [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-lg"
            />
          </div>
          <button
            onClick={() => setVolume(volume > 0 ? 0 : 1)}
            className="mt-2 w-full py-1.5 rounded-lg text-[0.6875rem] font-medium bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            {volume > 0 ? t('toolrail.mute') : t('toolrail.unmute')}
          </button>
        </ToolCard>
      )}
    </div>
  )
}
