/**
 * Detect whether a string contains Chinese characters.
 * Checks for CJK Unified Ideographs (U+4E00-U+9FFF) and
 * CJK Extension A (U+3400-U+4DBF).
 */
export function containsChinese(text: string): boolean {
  return /[一-鿿㐀-䶿]/.test(text)
}

/**
 * Detect if text contains English alphabet characters.
 */
export function containsEnglish(text: string): boolean {
  return /[a-zA-Z]{2,}/.test(text)
}

/**
 * Classify a subtitle line as Chinese, English, or mixed.
 */
export type SubtitleLang = 'chinese' | 'english' | 'mixed' | 'other'

export function classifySubtitleLine(text: string): SubtitleLang {
  const hasChinese = containsChinese(text)
  const hasEnglish = containsEnglish(text)

  if (hasChinese && hasEnglish) return 'mixed'
  if (hasChinese) return 'chinese'
  if (hasEnglish) return 'english'
  return 'other'
}
