import { useRef, useEffect, useState, useCallback } from 'react'
import { useSubtitleStore } from '../../stores/subtitleStore'
import { usePlayerStore } from '../../stores/playerStore'
import { formatTime } from '../../lib/time'
import { ChevronUp, ChevronDown, ScrollText, Clock } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

export function TranscriptPanel() {
  const subtitles = useSubtitleStore((s) => s.subtitles)
  const currentCueIndex = useSubtitleStore((s) => s.currentCueIndex)
  const seek = usePlayerStore((s) => s.seek)
  const [collapsed, setCollapsed] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const { t } = useI18n()

  useEffect(() => {
    if (currentCueIndex < 0 || !listRef.current) return
    const item = listRef.current.querySelector(`[data-cue-index="${currentCueIndex}"]`)
    if (item) {
      item.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentCueIndex])

  const handleClick = useCallback((startTime: number) => seek(startTime), [seek])

  // Empty state
  if (subtitles.length === 0) {
    return (
      <div className="border-t border-border/30 bg-card/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 h-10 gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
            <ScrollText size={14} />
            <span className="font-medium">{t('transcript.noTranscript')}</span>
          </div>
          {/* OCR 区域已并入右侧工具栏 (#4) */}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`border-t border-border/30 bg-card/80 backdrop-blur-sm transition-all duration-300 flex flex-col ${
        collapsed ? 'h-10' : 'h-52'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-10 shrink-0 gap-3">
        <div className="flex items-center gap-2">
          <ScrollText size={14} className="text-primary/70" />
          <span className="text-[0.6875rem] font-semibold text-foreground/80">{t('transcript.transcript')}</span>
          <span className="text-[0.625rem] font-medium text-muted-foreground/40 bg-secondary/50 px-1.5 py-0.5 rounded-full">
            {subtitles.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* OCR 区域已并入右侧工具栏 (#4) */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded-lg hover:bg-secondary transition-colors cursor-pointer text-muted-foreground"
          >
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Transcript list */}
      {!collapsed && (
        <div ref={listRef} className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {subtitles.map((cue, index) => {
            const isCurrent = index === currentCueIndex
            const isNearby = Math.abs(index - currentCueIndex) <= 1

            return (
              <div
                key={cue.id}
                data-cue-index={index}
                onClick={() => handleClick(cue.startTime)}
                className={`group flex gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150
                  ${isCurrent
                    ? 'bg-primary/10 border-l-[3px] border-primary shadow-sm'
                    : 'border-l-[3px] border-transparent hover:bg-secondary/50'}
                `}
              >
                {/* Timestamp */}
                <span
                  className={`text-[0.625rem] font-mono font-medium shrink-0 w-11 text-right select-none mt-0.5
                    ${isCurrent ? 'text-primary' : isNearby ? 'text-muted-foreground/50' : 'text-muted-foreground/30'}
                  `}
                >
                  {isCurrent || isNearby ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Clock size={8} />
                      {formatTime(cue.startTime)}
                    </span>
                  ) : ''}
                </span>

                {/* Text */}
                <span
                  className={`text-[0.6875rem] leading-relaxed select-none transition-colors duration-150
                    ${isCurrent
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground group-hover:text-foreground/70'}
                  `}
                >
                  {cue.text}
                </span>

                {/* Current indicator dot */}
                {isCurrent && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0 animate-pulse-soft" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
