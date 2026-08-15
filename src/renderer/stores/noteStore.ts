import { create } from 'zustand'
import type { Note, SnapshotEntry, VocabWord, OCRRegion } from '@shared/types'
import { OCRService, applyCorrections, learnCorrection } from '../services/ocr-service'
import { saveNotebook, VideoOcrRegionStorage, OcrCorrectionStorage } from '../services/storage-service'

// Default subtitle OCR region — covers the bottom strip of the frame so its
// lower edge reaches the video bottom (y+h === 1), where subtitles usually sit.
// Shared by the store (fallback + re-select modal) and useScreenshot (auto OCR).
export const DEFAULT_OCR_REGION: OCRRegion = { x: 0.05, y: 0.74, w: 0.9, h: 0.26 }

// ── Types ──

interface OCRQueueItem {
  snapshotId: string
  imageDataUrl: string
  region: OCRRegion
}

/** The subset of SnapshotEntry that callers provide when adding a snapshot. */
export type AddSnapshotInput = {
  id?: string
  timestamp: number
  imageFileName: string
  imageDataUrl: string
  thumbnailDataUrl: string
  /** Absolute path of the full-res PNG on disk, when the capture saved one. */
  filePath?: string
  ocrText?: string
  ocrRegion?: OCRRegion
  createdAt: number
}

interface NoteState {
  notes: Note[]
  activeNoteId: string | null

  ocrQueue: OCRQueueItem[]
  ocrPending: Record<string, boolean>

  sidebarMode: 'hidden' | 'narrow' | 'popup' | 'full'
  sidebarHovered: boolean
  /** Which panel tab the sidebar (popup or full) is showing. */
  sidebarTab: 'notes' | 'vocab'

  /** Current video hash — used for auto-persistence. */
  currentVideoHash: string | null

  /** Per-video subtitle region for OCR. Null = use DEFAULT_OCR_REGION. */
  videoOcrRegion: OCRRegion | null
}

interface NoteActions {
  // Notes
  createNote: (videoHash: string, title?: string) => string
  deleteNote: (noteId: string) => void
  setActiveNote: (noteId: string | null) => void

  // Snapshots
  addSnapshot: (input: AddSnapshotInput) => string
  updateSnapshotText: (snapshotId: string, ocrText: string, isCorrected: boolean) => void
  updateSnapshotNote: (snapshotId: string, userNote: string) => void
  updateSnapshotRegion: (snapshotId: string, region: OCRRegion) => void

  // Words
  addWordToSnapshot: (snapshotId: string, word: VocabWord) => void
  /** #10 单词级批注：同步更新快照内该词的副本（与单词本条目 id 一致）。 */
  updateSnapshotWordNote: (snapshotId: string, wordId: string, userNote: string) => void

  // OCR
  enqueueOCR: (item: OCRQueueItem) => void
  setOCRResult: (snapshotId: string, text: string) => void

  // Sidebar
  setSidebarMode: (mode: 'hidden' | 'narrow' | 'popup' | 'full') => void
  setSidebarHovered: (hovered: boolean) => void
  setSidebarTab: (tab: 'notes' | 'vocab') => void

  // Video OCR region
  setVideoOcrRegion: (region: OCRRegion | null) => void
  loadVideoOcrRegion: (region: OCRRegion | null) => void

  // Persistence
  loadNotebook: (notes: Note[], videoHash: string) => void
  clearNotebook: () => void
}

// ── Helper: update a specific note in the array, bumping updatedAt only if changed ──
function mapNoteUpdating(
  notes: Note[],
  noteId: string,
  fn: (note: Note) => Note,
): Note[] {
  return notes.map((n) => {
    if (n.id !== noteId) return n
    const updated = fn(n)
    return { ...updated, updatedAt: Date.now() }
  })
}

// ── Helper: find which note contains a snapshot ──
function findNoteForSnapshot(notes: Note[], snapshotId: string): string | null {
  for (const n of notes) {
    if (n.snapshots.some((sn) => sn.id === snapshotId)) return n.id
  }
  return null
}

export const useNoteStore = create<NoteState & NoteActions>((set, get) => ({
  notes: [],
  activeNoteId: null,

  ocrQueue: [],
  ocrPending: {},

  sidebarMode: 'narrow',
  sidebarHovered: false,
  sidebarTab: 'notes',
  currentVideoHash: null,
  videoOcrRegion: null,

  // ── Notes ──

  createNote: (videoHash, title) => {
    const id = crypto.randomUUID()
    const note: Note = {
      id,
      title: title || `Note ${get().notes.length + 1}`,
      videoHash,
      snapshots: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set((s) => ({ notes: [...s.notes, note], activeNoteId: id }))
    return id
  },

  deleteNote: (noteId) => {
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== noteId),
      activeNoteId: s.activeNoteId === noteId ? null : s.activeNoteId,
    }))
  },

  setActiveNote: (noteId) => set({ activeNoteId: noteId }),

  // ── Snapshots ──

  addSnapshot: (input) => {
    const id = input.id || crypto.randomUUID()
    const entry: SnapshotEntry = {
      id,
      timestamp: input.timestamp,
      imageFileName: input.imageFileName,
      imageDataUrl: input.imageDataUrl,
      thumbnailDataUrl: input.thumbnailDataUrl,
      filePath: input.filePath,
      ocrText: input.ocrText || '',
      ocrRawText: input.ocrText || '',
      isCorrected: false,
      ocrRegion: input.ocrRegion || get().videoOcrRegion || DEFAULT_OCR_REGION,
      userNote: '',
      words: [],
      createdAt: input.createdAt || Date.now(),
    }
    const { activeNoteId } = get()
    set((s) => {
      if (!activeNoteId) {
        // No active note — create one? The caller should have created a note already.
        console.warn('addSnapshot: no active note — snapshot not saved')
        return s
      }
      const notes = mapNoteUpdating(s.notes, activeNoteId, (n) => ({
        ...n,
        snapshots: [...n.snapshots, entry],
      }))
      return { notes }
    })
    return id
  },

  updateSnapshotText: (snapshotId, ocrText, isCorrected) => {
    // Feedback loop: when the user corrects OCR text, learn raw → corrected
    // (exact-match cache + word dictionary) so future OCR auto-applies it.
    if (isCorrected) {
      const { notes } = get()
      const noteId = findNoteForSnapshot(notes, snapshotId)
      const note = noteId ? notes.find((n) => n.id === noteId) : undefined
      const snap = note?.snapshots.find((sn) => sn.id === snapshotId)
      if (note && snap && snap.ocrRawText && snap.ocrRawText !== ocrText) {
        const corrections = OcrCorrectionStorage.load(note.videoHash) ?? { exact: {}, dict: {} }
        OcrCorrectionStorage.save(note.videoHash, learnCorrection(snap.ocrRawText, ocrText, corrections))
      }
    }

    set((s) => {
      const noteId = findNoteForSnapshot(s.notes, snapshotId)
      if (!noteId) return s
      const notes = mapNoteUpdating(s.notes, noteId, (n) => ({
        ...n,
        snapshots: n.snapshots.map((sn) =>
          sn.id === snapshotId ? { ...sn, ocrText, isCorrected } : sn,
        ),
      }))
      return { notes }
    })
  },

  updateSnapshotNote: (snapshotId, userNote) => {
    set((s) => {
      const noteId = findNoteForSnapshot(s.notes, snapshotId)
      if (!noteId) return s
      const notes = mapNoteUpdating(s.notes, noteId, (n) => ({
        ...n,
        snapshots: n.snapshots.map((sn) =>
          sn.id === snapshotId ? { ...sn, userNote } : sn,
        ),
      }))
      return { notes }
    })
  },

  updateSnapshotRegion: (snapshotId, region) => {
    set((s) => {
      const noteId = findNoteForSnapshot(s.notes, snapshotId)
      if (!noteId) return s
      const notes = mapNoteUpdating(s.notes, noteId, (n) => ({
        ...n,
        snapshots: n.snapshots.map((sn) =>
          sn.id === snapshotId ? { ...sn, ocrRegion: region } : sn,
        ),
      }))
      return { notes }
    })
  },

  // ── Words ──

  addWordToSnapshot: (snapshotId, word) => {
    set((s) => {
      const noteId = findNoteForSnapshot(s.notes, snapshotId)
      if (!noteId) return s
      const notes = mapNoteUpdating(s.notes, noteId, (n) => ({
        ...n,
        snapshots: n.snapshots.map((sn) =>
          sn.id === snapshotId
            ? { ...sn, words: [...sn.words.filter((w) => w.word !== word.word), word] }
            : sn,
        ),
      }))
      return { notes }
    })
  },

  updateSnapshotWordNote: (snapshotId, wordId, userNote) => {
    set((s) => {
      const noteId = findNoteForSnapshot(s.notes, snapshotId)
      if (!noteId) return s
      const notes = mapNoteUpdating(s.notes, noteId, (n) => ({
        ...n,
        snapshots: n.snapshots.map((sn) =>
          sn.id === snapshotId
            ? {
                ...sn,
                words: sn.words.map((w) => (w.id === wordId ? { ...w, userNote } : w)),
              }
            : sn,
        ),
      }))
      return { notes }
    })
  },

  // ── OCR Queue ──

  enqueueOCR: (item) => {
    // Deduplicate
    const { ocrQueue, ocrPending } = get()
    if (ocrQueue.some((j) => j.snapshotId === item.snapshotId)) return
    set({
      ocrQueue: [...ocrQueue, item],
      ocrPending: { ...ocrPending, [item.snapshotId]: true },
    })
    // Feed the actual OCR worker
    OCRService.enqueue(item)
  },

  setOCRResult: (snapshotId, text) => {
    set((s) => {
      const noteId = findNoteForSnapshot(s.notes, snapshotId)
      if (!noteId) {
        // Just clear pending flag
        return { ocrPending: { ...s.ocrPending, [snapshotId]: false } }
      }
      const note = s.notes.find((n) => n.id === noteId)
      // Keep the raw OCR text (for later learning) and apply learned corrections.
      const corrections = note ? OcrCorrectionStorage.load(note.videoHash) : null
      const corrected = applyCorrections(text, corrections)
      const notes = mapNoteUpdating(s.notes, noteId, (n) => ({
        ...n,
        snapshots: n.snapshots.map((sn) =>
          sn.id === snapshotId ? { ...sn, ocrRawText: text, ocrText: corrected } : sn,
        ),
      }))
      return {
        notes,
        ocrPending: { ...s.ocrPending, [snapshotId]: false },
      }
    })
  },

  // ── Sidebar ──

  setSidebarMode: (mode) => set({ sidebarMode: mode }),
  setSidebarHovered: (hovered) => set({ sidebarHovered: hovered }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  // ── Video OCR region ──

  setVideoOcrRegion: (region) => {
    set({ videoOcrRegion: region })
    // Persist per-video so it survives reloads and applies to future screenshots.
    const { currentVideoHash } = get()
    if (currentVideoHash) {
      if (region) VideoOcrRegionStorage.save(currentVideoHash, region)
      else VideoOcrRegionStorage.remove(currentVideoHash)
    }
  },

  loadVideoOcrRegion: (region) => set({ videoOcrRegion: region }),

  // ── Persistence ──

  loadNotebook: (notes, videoHash) => set({ notes, activeNoteId: notes[0]?.id || null, currentVideoHash: videoHash }),

  clearNotebook: () => set({
    notes: [],
    activeNoteId: null,
    currentVideoHash: null,
    ocrQueue: [],
    ocrPending: {},
    sidebarMode: 'narrow',
    sidebarHovered: false,
    videoOcrRegion: null,
  }),
}))

// ── Auto-persistence: debounced save to localStorage on every state change ──

let saveTimer: ReturnType<typeof setTimeout> | null = null

useNoteStore.subscribe((state) => {
  const { currentVideoHash, notes } = state
  if (!currentVideoHash || notes.length === 0) return

  // Debounce saves by 1 second to avoid thrashing localStorage
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveNotebook(currentVideoHash, notes)
  }, 1000)
})
