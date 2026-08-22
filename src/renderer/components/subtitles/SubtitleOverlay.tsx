import { useSubtitleStore, type SubtitleDisplayMode } from '../../stores/subtitleStore'
import { classifySubtitleLine } from '../../services/language-detector'
import { useSettingsStore, type SubtitleSize } from '../../stores/settingsStore'

/** 字幕字号三档（与设置页预览一致）。 */
const SUBTITLE_FONT: Record<SubtitleSize, string> = {
  sm: 'clamp(13px, 2.2vw, 20px)',
  md: 'clamp(15px, 2.8vw, 24px)',
  lg: 'clamp(18px, 3.4vw, 30px)',
}

/**
 * 根据显示模式决定一行字幕是否渲染。
 * - bilingual：全部显示
 * - english：仅英文行（中文行隐藏；中英混合行保留英文部分）
 * - chinese：仅中文行（英文行隐藏；中英混合行保留中文部分）
 */
function filterLines(lines: string[], mode: SubtitleDisplayMode): string[] {
  if (mode === 'bilingual') return lines
  const targetChinese = mode === 'chinese'
  const out: string[] = []
  for (const line of lines) {
    const lang = classifySubtitleLine(line)
    if (lang === 'chinese' || lang === 'english') {
      // 纯中文/纯英文：按模式决定去留
      if ((lang === 'chinese') === targetChinese) out.push(line)
    } else if (lang === 'mixed') {
      // 中英混合行：提取目标语言部分
      const extracted = extractLanguagePart(line, targetChinese)
      if (extracted) out.push(extracted)
    }
    // 'other'（符号/数字等）在单语模式下跟随主语言显示，避免整行消失
  }
  return out
}

/**
 * 从中英混合行中提取目标语言的片段。
 * 英文片段按拉丁字母+数字+常见符号连续段取；中文片段取 CJK 连续段。
 * 结果去除首尾空白，避免字幕渲染出多余空格。
 */
function extractLanguagePart(line: string, wantChinese: boolean): string {
  if (wantChinese) {
    const m = line.match(/[一-鿿㐀-䶿][一-鿿㐀-䶿・·，。！？、；：""''（）《》…—\s]*/g)
    return m ? m.join(' ').trim() : ''
  }
  const m = line.match(/[a-zA-Z0-9][a-zA-Z0-9'’\-.,!?;:()%&$#@\/\s]*/g)
  return m ? m.join(' ').trim() : ''
}

export function SubtitleOverlay() {
  const subtitles = useSubtitleStore((s) => s.subtitles)
  const currentCueIndex = useSubtitleStore((s) => s.currentCueIndex)
  const displayMode = useSubtitleStore((s) => s.displayMode)
  const subtitleSize = useSettingsStore((s) => s.subtitleSize)

  // 无字幕模式：完全不渲染
  if (displayMode === 'none') return null
  if (subtitles.length === 0 || currentCueIndex < 0) return null
  const cue = subtitles[currentCueIndex]
  if (!cue) return null

  const lines = filterLines(cue.text.split('\n'), displayMode)
  if (lines.length === 0) return null

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
