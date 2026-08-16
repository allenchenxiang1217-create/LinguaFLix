/**
 * Storage Service — Persistence layer for LinguaFlix.
 *
 * Web mode: localStorage for metadata + IndexedDB for large blobs (screenshots).
 * Electron mode (future): native filesystem (notebook.json + screenshots/ folder).
 *
 * Structure per video:
 *   data/{video_hash}/
 *   ├── meta.json          → video metadata
 *   ├── screenshots/       → PNG files (or blob store in web mode)
 *   └── notebook.json      → all notes + snapshots + words
 */

import type { Note, VideoMeta, AppData, OCRRegion, OcrCorrections, SnapshotEntry } from '@shared/types'
import { apiCall } from './stream-resolver'

// ── Keys ──

const APP_KEY = 'linguaflix-app'
const NOTEBOOK_PREFIX = 'linguaflix-nb-'
const META_PREFIX = 'linguaflix-meta-'
const SCREENSHOT_PREFIX = 'linguaflix-ss-'
const OCR_REGION_PREFIX = 'linguaflix-ocr-'
const OCR_CORRECTION_PREFIX = 'linguaflix-ocrfix-'

// ── Generic JSON helpers ──

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    console.warn(`Failed to write ${key} to localStorage`)
  }
}

// ── App-level ──

export const AppStorage = {
  /** localStorage key backing the video registry (exposed for cross-tab sync). */
  key: APP_KEY,

  load(): AppData {
    return readJSON<AppData>(APP_KEY) || { videos: {}, lastVideoHash: null }
  },

  save(data: AppData): void {
    writeJSON(APP_KEY, data)
  },
}

// ── Video Meta ──

const VideoMetaStorage = {
  load(hash: string): VideoMeta | null {
    return readJSON<VideoMeta>(META_PREFIX + hash)
  },

  save(hash: string, meta: VideoMeta): void {
    writeJSON(META_PREFIX + hash, meta)
  },

  remove(hash: string): void {
    localStorage.removeItem(META_PREFIX + hash)
  },
}

// ── Video OCR Region (per-video subtitle region for OCR) ──

export const VideoOcrRegionStorage = {
  load(hash: string): OCRRegion | null {
    return readJSON<OCRRegion>(OCR_REGION_PREFIX + hash)
  },

  save(hash: string, region: OCRRegion): void {
    writeJSON(OCR_REGION_PREFIX + hash, region)
  },

  remove(hash: string): void {
    localStorage.removeItem(OCR_REGION_PREFIX + hash)
  },
}

// ── Video OCR Corrections (per-video learned fixups, feedback loop) ──

export const OcrCorrectionStorage = {
  load(hash: string): OcrCorrections | null {
    return readJSON<OcrCorrections>(OCR_CORRECTION_PREFIX + hash)
  },

  save(hash: string, corrections: OcrCorrections): void {
    writeJSON(OCR_CORRECTION_PREFIX + hash, corrections)
  },

  remove(hash: string): void {
    localStorage.removeItem(OCR_CORRECTION_PREFIX + hash)
  },
}

// ── Notebook ──

export const NotebookStorage = {
  load(videoHash: string): Note[] {
    return readJSON<Note[]>(NOTEBOOK_PREFIX + videoHash) || []
  },

  save(videoHash: string, notes: Note[]): void {
    // Strip data URLs before saving to save space
    const slim = notes.map((note) => ({
      ...note,
      snapshots: note.snapshots.map((sn) => ({
        ...sn,
        imageDataUrl: '',          // don't persist base64 in JSON
        thumbnailDataUrl: '',      // don't persist base64 in JSON
      })),
    }))
    writeJSON(NOTEBOOK_PREFIX + videoHash, slim)
  },

  remove(videoHash: string): void {
    localStorage.removeItem(NOTEBOOK_PREFIX + videoHash)
  },
}

// ── Screenshots (blobs) ──

// In web mode, store screenshots as separate localStorage entries.
// In Electron mode, these would be PNG files on disk.

export const ScreenshotStorage = {
  save(snapshotId: string, dataUrl: string): void {
    try {
      localStorage.setItem(SCREENSHOT_PREFIX + snapshotId, dataUrl)
    } catch {
      // Data URL too large — fallback: keep in memory only
      console.warn(`Screenshot ${snapshotId} too large for localStorage`)
    }
  },

  load(snapshotId: string): string | null {
    return localStorage.getItem(SCREENSHOT_PREFIX + snapshotId)
  },

  remove(snapshotId: string): void {
    localStorage.removeItem(SCREENSHOT_PREFIX + snapshotId)
  },

  /** Remove all screenshots for a given video (by iterating notebook's snapshot IDs). */
  removeAll(snapshotIds: string[]): void {
    for (const id of snapshotIds) {
      localStorage.removeItem(SCREENSHOT_PREFIX + id)
    }
  },
}

// ── High-level save/load for a full notebook ──

export function saveNotebook(videoHash: string, notes: Note[]): void {
  NotebookStorage.save(videoHash, notes)
  // Save a small thumbnail per screenshot to localStorage (survives reload even
  // when the full-res PNG is too big for the quota). The full-res frame lives on
  // disk at snapshot.filePath — the single source of truth for full-size.
  for (const note of notes) {
    for (const snap of note.snapshots) {
      const small = snap.thumbnailDataUrl || snap.imageDataUrl
      if (small) {
        ScreenshotStorage.save(snap.id, small)
      }
    }
  }
}

/**
 * Read a full-res screenshot back from disk (Electron IPC) or the web backend.
 * Returns the PNG data URL, or null when the file is gone/unreadable.
 */
async function readScreenshotFromDisk(filePath: string): Promise<string | null> {
  const { electronAPI } = window as any
  if (electronAPI?.readScreenshot) {
    try {
      return await electronAPI.readScreenshot(filePath)
    } catch {
      return null
    }
  }
  // Web mode: ask the backend (port-discovered, mirrors apiCall).
  const fileName = filePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
  if (!fileName) return null
  try {
    const res = await apiCall<{ dataUrl?: string; error?: string }>(
      `/api/screenshot/read?file=${encodeURIComponent(fileName)}`,
    )
    return res.dataUrl ?? null
  } catch {
    return null
  }
}

export async function loadNotebook(videoHash: string): Promise<Note[]> {
  const notes = NotebookStorage.load(videoHash)

  const restoreSnapshot = async (snap: SnapshotEntry) => {
    // Small preview always comes back from localStorage (cheap, fits quota).
    const thumb = ScreenshotStorage.load(snap.id)
    if (thumb && !snap.thumbnailDataUrl) snap.thumbnailDataUrl = thumb
    // Full-size: keep an in-memory copy if present, else read from disk.
    if (snap.imageDataUrl) return
    if (snap.filePath) {
      const full = await readScreenshotFromDisk(snap.filePath)
      if (full) snap.imageDataUrl = full
    }
    if (!snap.imageDataUrl && thumb) snap.imageDataUrl = thumb
  }

  for (const note of notes) {
    await Promise.all(note.snapshots.map(restoreSnapshot))
  }
  return notes
}

/** 单词本列表的截图缩略图：直接读 localStorage 里的小图（saveNotebook 只存缩略图）。 */
export function getSnapshotImage(snapshotId: string): string | null {
  return ScreenshotStorage.load(snapshotId)
}

/**
 * 单词本点击缩略图放大：先按 snapshotId 在对应视频的笔记本里找到快照，
 * 有 filePath 则从磁盘读全尺寸，否则回退到 localStorage 缩略图。
 */
export async function readSnapshotImage(
  snapshotId: string,
  videoHash: string,
): Promise<string | null> {
  const thumb = ScreenshotStorage.load(snapshotId)
  const notes = NotebookStorage.load(videoHash)
  for (const note of notes) {
    const snap = note.snapshots.find((s) => s.id === snapshotId)
    if (snap?.filePath) {
      const full = await readScreenshotFromDisk(snap.filePath)
      if (full) return full
    }
  }
  return thumb
}

/** Cheap per-video counts (number of notes + distinct saved words) without
 *  restoring screenshot data URLs. Used by the dashboard's Recent list. */
export function getNotebookCounts(videoHash: string): { notes: number; words: number } {
  const notes = NotebookStorage.load(videoHash)
  const seen = new Set<string>()
  for (const note of notes) {
    // 兼容旧 schema：早期保存的快照可能没有 snapshots / words 字段
    for (const snap of note.snapshots ?? []) {
      for (const w of snap.words ?? []) seen.add(w.word)
    }
  }
  return { notes: notes.length, words: seen.size }
}

export async function deleteNotebook(videoHash: string): Promise<void> {
  const notes = NotebookStorage.load(videoHash)
  const ids = notes.flatMap((n) => n.snapshots.map((s) => s.id))
  ScreenshotStorage.removeAll(ids)
  // #7 同步删除：连同磁盘上的全尺寸 PNG 一并清理（缩略图只占 localStorage）。
  for (const n of notes) {
    for (const sn of n.snapshots) {
      if (sn.filePath) await deleteScreenshotFromDisk(sn.filePath)
    }
  }
  NotebookStorage.remove(videoHash)
  VideoMetaStorage.remove(videoHash)
}

/** 从持久化笔记本里找回某张截图的磁盘 filePath（供单词本里删除单词时用，
 *  此时播放器已退出、内存 noteStore 可能已清空）。 */
export function findSnapshotFilePath(videoHash: string, snapshotId: string): string | undefined {
  if (!videoHash || !snapshotId) return undefined
  const notes = NotebookStorage.load(videoHash)
  for (const n of notes) {
    const snap = n.snapshots.find((s) => s.id === snapshotId)
    if (snap?.filePath) return snap.filePath
  }
  return undefined
}

/** Delete a saved screenshot PNG from disk (Electron IPC / web backend). */
async function deleteScreenshotFromDisk(filePath: string): Promise<void> {
  const { electronAPI } = window as any
  if (electronAPI?.deleteScreenshot) {
    try {
      await electronAPI.deleteScreenshot(filePath)
    } catch {
      /* best-effort */
    }
    return
  }
  // Web mode: same-origin /api proxy (mirrors readScreenshotFromDisk).
  const fileName = filePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
  if (!fileName) return
  try {
    await apiCall(`/api/screenshot/delete?file=${encodeURIComponent(fileName)}`, { method: 'DELETE' })
  } catch {
    /* best-effort */
  }
}

/**
 * Delete a snapshot's screenshot cache: localStorage thumbnail + full-res PNG on
 * disk (when the snapshot has a filePath). Used by the #1/#10 deletion cascade to
 * free space for orphaned screenshots.
 */
export async function deleteSnapshotCache(snapshotId: string, filePath?: string): Promise<void> {
  ScreenshotStorage.remove(snapshotId)
  if (filePath) await deleteScreenshotFromDisk(filePath)
}
