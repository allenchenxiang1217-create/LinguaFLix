import { VideoPlayer } from '../player/VideoPlayer'
import { SourceInput } from '../player/SourceInput'
import { TranscriptPanel } from '../transcript/TranscriptPanel'
import { usePlayerStore } from '../../stores/playerStore'
import { ArrowLeft } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

interface VideoPanelProps {
  onBack: () => void
}

export function VideoPanel({ onBack }: VideoPanelProps) {
  const { t } = useI18n()
  const videoSrc = usePlayerStore((s) => s.videoSrc)

  return (
    <div className={`flex-1 flex flex-col min-h-0 relative ${videoSrc ? 'bg-black' : 'bg-background'}`}>
      {/* Back to dashboard */}
      <button
        onClick={onBack}
        className={`absolute top-3 left-3 z-30 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium
                   rounded-lg border transition-all duration-200 cursor-pointer ${
          videoSrc
            ? 'bg-black/50 hover:bg-black/70 border-white/10 text-white/70 hover:text-white'
            : 'bg-foreground/10 hover:bg-foreground/20 border-border text-foreground/70 hover:text-foreground'
        }`}
      >
        <ArrowLeft size={12} />
        <span className="hidden sm:inline">{t('layout.back')}</span>
      </button>

      {/* Video Source Input: centered welcome page when empty, top overlay when loaded */}
      {videoSrc ? (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
          <SourceInput />
        </div>
      ) : (
        <div className="absolute inset-0 z-20 flex items-center justify-center px-6 overflow-y-auto">
          <SourceInput />
        </div>
      )}

      {/* Video Player fills the main space */}
      <div className="flex-1 flex items-center justify-center min-h-0">
        <VideoPlayer />
      </div>

      {/* Transcript panel at bottom */}
      <TranscriptPanel />
    </div>
  )
}
