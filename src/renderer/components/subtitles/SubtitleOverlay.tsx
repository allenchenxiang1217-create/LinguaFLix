import { useSubtitleStore } from '../../stores/subtitleStore'
import { classifySubtitleLine } from '../../services/language-detector'
import { useSettingsStore, type SubtitleSize } from '../../stores/settingsStore'

/** 字幕字号三档（与设置页预览一致）。 */
const SUBTITLE_FONT: Record<SubtitleSize, string> = {
  sm: 'clamp(13px, 2.2vw, 20px)',
  md: 'clamp(15px, 2.8vw, 24px)',
  lg: 'clamp(18px, 3.4vw, 30px)',
}

export function SubtitleOverlay() {
  const subtitles = useSubtitleStore((s) => s.subtitles)
  const currentCueIndex = useSubtitleStore((s) => s.currentCueIndex)
  const subtitleSize = useSettingsStore((s) => s.subtitleSize)

  if (subtitles.length === 0 || currentCueIndex < 0) return null
  const cue = subtitles[currentCueIndex]
  if (!cue) return null

  const lines = cue.text.split('\n')

  return (
    <div className="absolute bottom-20 left-0 right-0 flex flex-col items-center pointer-events-none z-10 px-4">
      {lines.map((line, i) => {
        const lang = classifySubtitleLine(line)
        const isChinese = lang === 'chinese'

        return (
          <span
            key={i}
            className={`px-4 py-1 rounded-lg text-center leading-relaxed font-medium tracking-wide
                       ${isChinese
                         ? 'text-amber-300/90 bg-black/70'
                         : 'text-white bg-black/60'}
                       backdrop-blur-sm`}
            style={{
              fontSize: SUBTITLE_FONT[subtitleSize],
              textShadow: '0 1px 3px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.5)',
            }}
          >
            {line}
          </span>
        )
      })}
    </div>
  )
}
