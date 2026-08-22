import type { SubtitleCue } from '@shared/types'

/**
 * Parse SRT or VTT subtitle file content into SubtitleCue array.
 * Handles basic SRT and WebVTT formats.
 */
export function parseSubtitleFile(content: string, fileName?: string): SubtitleCue[] {
  const ext = fileName?.split('.').pop()?.toLowerCase()
  const cues = ext === 'vtt' || content.trimStart().startsWith('WEBVTT')
    ? parseVtt(content)
    : parseSrt(content)
  return mergeOverlappingCues(cues)
}

/**
 * 合并同一时间段的多条字幕（常见于「双语字幕」文件：英文与中文各自成块，
 * 但时间戳完全一致）。合并后 text 用换行拼接，供显示层按语言过滤。
 *
 * 匹配规则：
 *   - startTime 相差 ≤ 0.3s（容差，吸收毫秒级舍入差异）
 *   - 且两者时间区间重叠（endTime ≥ 对方 startTime）
 * 合并后保留最早 start、最晚 end，text 按「英文行在前、中文行在后」重排，
 * 方便显示层区分主语言。
 */
function mergeOverlappingCues(cues: SubtitleCue[]): SubtitleCue[] {
  const sorted = [...cues].sort((a, b) => a.startTime - b.startTime || a.id - b.id)
  const merged: SubtitleCue[] = []

  for (const cue of sorted) {
    const prev = merged[merged.length - 1]
    const timeOverlap =
      prev && Math.abs(cue.startTime - prev.startTime) <= 0.3 && cue.endTime >= prev.startTime

    if (timeOverlap) {
      // 合并：同一时刻的两条字幕拼成多行
      const combined = prev.text.split('\n').concat(cue.text.split('\n'))
      // 去重（同语言同文本），并按「英文行在前、中文行在后」排序
      const uniq: string[] = []
      for (const line of combined) {
        const t = line.trim()
        if (t && !uniq.includes(t)) uniq.push(t)
      }
      const isZh = (s: string) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s)
      uniq.sort((a, b) => {
        const aZh = isZh(a), bZh = isZh(b)
        if (aZh !== bZh) return aZh ? 1 : -1 // 英文在前
        return 0
      })
      prev.text = uniq.join('\n')
      prev.endTime = Math.max(prev.endTime, cue.endTime)
      // 保留原 id 中较小的
      prev.id = Math.min(prev.id, cue.id)
    } else {
      merged.push({ ...cue })
    }
  }
  return merged
}

/** Parse SRT format */
function parseSrt(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const blocks = content.trim().split(/\n\s*\n/)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue

    // Line 0: index (can be any number)
    const indexLine = parseInt(lines[0])
    if (isNaN(indexLine)) continue

    // Line 1: timestamp --> 00:01:23,456 --> 00:01:25,789
    const timeMatch = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
    )
    if (!timeMatch) continue

    const startTime =
      parseInt(timeMatch[1]) * 3600 +
      parseInt(timeMatch[2]) * 60 +
      parseInt(timeMatch[3]) +
      parseInt(timeMatch[4]) / 1000

    const endTime =
      parseInt(timeMatch[5]) * 3600 +
      parseInt(timeMatch[6]) * 60 +
      parseInt(timeMatch[7]) +
      parseInt(timeMatch[8]) / 1000

    // Lines 2+: text (may contain HTML-like tags, strip them)
    const text = lines
      .slice(2)
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim()

    if (text) {
      cues.push({ id: indexLine, startTime, endTime, text })
    }
  }

  return cues.sort((a, b) => a.startTime - b.startTime)
}

/** Parse WebVTT format */
function parseVtt(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  // Remove WEBVTT header
  const body = content.replace(/^WEBVTT.*\n/, '').trim()
  const blocks = body.split(/\n\s*\n/)

  let id = 0
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    // First line might be an optional cue identifier (non-timestamp)
    let timeLineIndex = 0
    if (!lines[0].includes('-->')) {
      timeLineIndex = 1
      if (lines.length < timeLineIndex + 1) continue
    }

    // Timestamp line
    const timeMatch = lines[timeLineIndex].match(
      /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/,
    )
    if (!timeMatch) continue

    const startTime =
      parseInt(timeMatch[1]) * 3600 +
      parseInt(timeMatch[2]) * 60 +
      parseInt(timeMatch[3]) +
      parseInt(timeMatch[4]) / 1000

    const endTime =
      parseInt(timeMatch[5]) * 3600 +
      parseInt(timeMatch[6]) * 60 +
      parseInt(timeMatch[7]) +
      parseInt(timeMatch[8]) / 1000

    // Remaining lines: text (strip VTT tags and HTML)
    const text = lines
      .slice(timeLineIndex + 1)
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim()

    if (text) {
      cues.push({ id: id++, startTime, endTime, text })
    }
  }

  return cues.sort((a, b) => a.startTime - b.startTime)
}
