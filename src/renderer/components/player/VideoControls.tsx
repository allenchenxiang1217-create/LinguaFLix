import { usePlayerStore } from '../../stores/playerStore'
import { formatTime } from '../../lib/time'
import { Play, Pause, SkipBack, SkipForward, Camera, Maximize2, Minimize2 } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

interface VideoControlsProps {
  onSnapshot: () => void
}

export function VideoControls({ onSnapshot }: VideoControlsProps) {
  const { t } = useI18n()
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const isFullscreen = usePlayerStore((s) => s.isFullscreen)
  const play = usePlayerStore((s) => s.play)
  const pause = usePlayerStore((s) => s.pause)
  const seek = usePlayerStore((s) => s.seek)
  const toggleFullscreen = usePlayerStore((s) => s.toggleFullscreen)

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  const handleSeekBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    seek(Math.max(0, Math.min(duration, ratio * duration)))
  }

  return (
    <div
      className="absolute bottom-0 left-0 right-0 px-4 pb-3 pt-12 z-20
                 bg-gradient-to-t from-black/90 via-black/40 to-transparent
                 opacity-0 group-hover:opacity-100 transition-opacity duration-300
                 pointer-events-none group-hover:pointer-events-auto"
    >
      {/* Seek bar */}
      <div
        className="relative h-1 bg-white/10 rounded-full cursor-pointer mb-3 group/seekbar
                   hover:h-1.5 transition-all duration-150"
        onClick={handleSeekBarClick}
      >
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary to-chart-3 rounded-full
                     transition-[width] duration-75"
          style={{ width: `${progress}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full
                          opacity-0 group-hover/seekbar:opacity-100 transition-all shadow-lg shadow-primary/30
                          scale-75 group-hover/seekbar:scale-100" />
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-1.5">
        {/* Play/Pause */}
        <button
          onClick={() => (isPlaying ? pause() : play())}
          className="p-2 rounded-full hover:bg-white/10 transition-all duration-150 cursor-pointer
                     text-white active:scale-90"
          title={isPlaying ? t('video.pause') : t('video.play')}
        >
          {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>

        {/* Skip back */}
        <button
          onClick={() => seek(Math.max(0, currentTime - 5))}
          className="p-2 rounded-full hover:bg-white/10 transition-all duration-150 cursor-pointer
                     text-white/70 hover:text-white active:scale-90"
          title={t('video.back5')}
        >
          <SkipBack size={16} fill="currentColor" />
        </button>

        {/* Skip forward */}
        <button
          onClick={() => seek(Math.min(duration, currentTime + 5))}
          className="p-2 rounded-full hover:bg-white/10 transition-all duration-150 cursor-pointer
                     text-white/70 hover:text-white active:scale-90"
          title={t('video.forward5')}
        >
          <SkipForward size={16} fill="currentColor" />
        </button>

        {/* Time */}
        <span className="text-[0.6875rem] text-white/60 font-mono ml-2 tabular-nums select-none">
          <span className="text-white/90">{formatTime(currentTime)}</span>
          <span className="mx-1 text-white/30">/</span>
          <span>{formatTime(duration)}</span>
        </span>

        <div className="flex-1" />

        {/* Fullscreen (#3) — 倍速/音量已迁至右侧工具栏 */}
        <button
          onClick={() => toggleFullscreen()}
          className="p-2 rounded-full hover:bg-white/10 transition-all duration-150 cursor-pointer
                     text-white/70 hover:text-white active:scale-90"
          title={isFullscreen ? t('video.exitFullscreen') : t('video.fullscreen')}
        >
          {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>

        {/* Snapshot */}
        <button
          onClick={onSnapshot}
          className="ml-1 p-2 rounded-full hover:bg-primary/20 transition-all duration-150 cursor-pointer
                     text-white/70 hover:text-primary active:scale-90"
          title={t('video.takeSnapshot')}
        >
          <Camera size={16} />
        </button>
      </div>
    </div>
  )
}
