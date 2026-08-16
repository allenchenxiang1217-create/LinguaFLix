/** LinguaFlix — Shared types for main process and renderer */

// ── Subtitle ──

export interface SubtitleCue {
  id: number
  startTime: number // seconds
  endTime: number   // seconds
  text: string
}

export interface BlockerConfig {
  xPercent: number
  yPercent: number
  widthPercent: number
  heightPercent: number
}

/** How the blocker hides the subtitles behind it. */
export type BlockerEffect = 'solid' | 'blur'

// ── OCR ──

export interface OCRRegion {
  x: number  // 0-1, percentage of image width
  y: number  // 0-1, percentage of image height
  w: number  // 0-1
  h: number  // 0-1
}

/** Per-video learned OCR corrections (see ocr-service applyCorrections/learnCorrection). */
export interface OcrCorrections {
  /** Normalized raw OCR text → corrected text (exact-match cache). */
  exact: Record<string, string>
  /** Wrong word → correct word (word-level replacement dictionary, lowercase). */
  dict: Record<string, string>
}

// ── Vocabulary Word (SM-2 spaced repetition) ──

export interface SM2State {
  interval: number     // days until next review
  repetition: number   // consecutive correct responses
  efactor: number      // easiness factor (default 2.5)
  dueDate: string      // ISO date string for next review
}

export interface VocabWord {
  id: string
  word: string
  contextSentence: string          // the full subtitle/OCR line
  snapshotId: string               // parent snapshot (primary = earliest occurrence)
  noteId: string                   // parent note
  videoHash: string                // parent video
  videoTimestamp: number           // video time in seconds
  aiAnalysis: string               // AI analysis result (generated on-demand)
  userNote: string                 // user's own notes on this word
  sm2: SM2State                    // spaced repetition state
  createdAt: number                // Date.now()
  reviewedAt: number | null
  reviewCount: number
  /** #7 同一单词在不同视频/不同帧被保存的所有出处（含主出处）。缺省时按主字段合成。 */
  occurrences?: WordOccurrence[]
  /** #7 这个单词被记录了几次（= occurrences.length）。 */
  recordCount?: number
}

/** #7 单词的一次「被记录」出处：指向某个视频的某个截图/时间点。 */
export interface WordOccurrence {
  snapshotId: string
  noteId: string
  videoHash: string
  videoTimestamp: number
  createdAt: number
}

// ── Snapshot (screenshot entry within a note) ──

export interface SnapshotEntry {
  id: string
  timestamp: number                // video time in seconds
  imageFileName: string            // e.g. "snap_001.png"
  imageDataUrl: string             // base64 for in-memory display
  thumbnailDataUrl: string         // small thumbnail
  /** Absolute path of the full-res PNG on disk (Electron IPC / web backend write). */
  filePath?: string
  ocrText: string                  // OCR result (may be user-corrected)
  ocrRawText: string               // raw OCR output before corrections, kept for feedback learning
  isCorrected: boolean             // true if user manually edited text
  ocrRegion: OCRRegion             // the region used for OCR
  userNote: string                 // user's free-text notes on this scene
  words: VocabWord[]               // words saved from this snapshot
  createdAt: number
}

// ── Note (one viewing/note-taking session for a video) ──

export interface Note {
  id: string
  title: string                    // default: creation date, user-editable
  videoHash: string
  snapshots: SnapshotEntry[]
  createdAt: number
  updatedAt: number
}

// ── Video Meta ──

export interface VideoMeta {
  hash: string                     // content hash for identity
  filePath: string                 // current file path
  fileName: string                 // display name
  duration: number                 // seconds
  lastPlayedTime: number           // seek position
  lastOpenedAt: number             // Date.now()
  thumbnailDataUrl?: string        // auto-generated from first frame
  /** #10 自动剪辑生成的「复习视频」条目（区别于普通导入/下载的视频，用于覆盖旧剪辑时识别）。 */
  isReviewClip?: boolean
}

// ── App-level data ──

export interface AppData {
  videos: Record<string, VideoMeta>  // hash → video meta
  lastVideoHash: string | null       // for "continue from last"
}

// ── Dictionary ──

export interface DictionaryResult {
  word: string
  phonetic?: string
  phonetics: Array<{ text?: string; audio?: string }>
  meanings: Array<{
    partOfSpeech: string
    definitions: Array<{
      definition: string
      example?: string
      synonyms: string[]
    }>
  }>
}

// 中英词典结果（有道 / web 兜底归一化后的形状）
export interface ZhDictResult {
  word: string
  phonetic?: string
  translations: Array<{ pos?: string; meanings: string[] }>
  examples?: Array<{ en: string; zh: string }>
}

// ── (AI + Review types removed: no longer referenced) ──
