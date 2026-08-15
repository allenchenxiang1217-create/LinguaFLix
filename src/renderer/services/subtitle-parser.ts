import type { SubtitleCue } from '@shared/types'

/**
 * Parse SRT or VTT subtitle file content into SubtitleCue array.
 * Handles basic SRT and WebVTT formats.
 */
export function parseSubtitleFile(content: string, fileName?: string): SubtitleCue[] {
  const ext = fileName?.split('.').pop()?.toLowerCase()
  if (ext === 'vtt' || content.trimStart().startsWith('WEBVTT')) {
    return parseVtt(content)
  }
  return parseSrt(content)
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
