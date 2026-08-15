/**
 * OCR Service — PaddleOCR (PP-OCRv5) wrapper with async queue support.
 *
 * Engine: `esearch-ocr` + `onnxruntime-web` (wasm). Models (det/rec ONNX + dict)
 * are bundled in `public/ocr/` so recognition runs fully offline in the renderer,
 * same path for both web mode and Electron (unlike the old Tesseract CDN engine).
 *
 * Recognizes screenshots in the background: crop → detect+recognize → select the
 * subtitle line(s) → return text. Also exposes the correction-feedback helpers
 * used by noteStore (exact-match cache + word dictionary).
 */

import * as ort from 'onnxruntime-web/wasm'
import { init as initPaddleOCR, type resultType } from 'esearch-ocr'
import type { OCRRegion, OcrCorrections } from '@shared/types'

// ── Types ──

export interface OCRJob {
  snapshotId: string
  imageDataUrl: string
  region: OCRRegion
}

export type OCRResult = {
  snapshotId: string
  text: string
}

type OCRCallback = (result: OCRResult) => void

// ── Queue ──

let queue: OCRJob[] = []
let processing = false
let onResult: OCRCallback | null = null

// ── Engine lifecycle ──

type Engine = Awaited<ReturnType<typeof initPaddleOCR>>

let engine: Engine | null = null
let enginePromise: Promise<Engine> | null = null

/**
 * Resolve the base URL for the bundled OCR assets.
 *
 * - Web mode / Electron dev: relative `ocr/` (served by Vite from public/).
 * - Packaged Electron: the renderer loads from `file://`, where Chromium refuses
 *   `file://` fetch — so route through the main process's local HTTP server.
 */
let _ocrBase: Promise<string> | null = null
function getOcrBase(): Promise<string> {
  if (!_ocrBase) {
    _ocrBase = (async () => {
      const isFile = typeof window !== 'undefined' && window.location.protocol === 'file:'
      if (isFile) {
        const api = (window as any).electronAPI
        if (api?.getOcrBaseUrl) {
          const res = await api.getOcrBaseUrl()
          if (res?.url) return res.url.replace(/\/$/, '') + '/'
        }
      }
      return 'ocr/'
    })()
  }
  return _ocrBase
}

/** Lazily download models + init the PaddleOCR engine (once). */
async function getEngine(): Promise<Engine> {
  if (engine) return engine
  if (!enginePromise) {
    enginePromise = (async () => {
      const base = await getOcrBase()

      // Load the wasm binary directly (wasmBinary) so onnxruntime-web does NOT
      // try to `import()` the `.mjs` glue — that dynamic import is rewritten by
      // Vite's dev server and 500s when the file lives under public/. Single
      // thread keeps the binary-loading path valid.
      ort.env.wasm.numThreads = 1
      ort.env.wasm.wasmBinary = await fetch(base + 'ort-wasm-simd-threaded.wasm').then((r) => r.arrayBuffer())

      const [detBuf, recBuf, dictStr] = await Promise.all([
        fetch(base + 'det.onnx').then((r) => r.arrayBuffer()),
        fetch(base + 'rec.onnx').then((r) => r.arrayBuffer()),
        fetch(base + 'dict.txt').then((r) => r.text()),
      ])

      engine = await initPaddleOCR({
        ort,
        det: { input: detBuf },
        rec: { input: recBuf, decodeDic: dictStr, optimize: { space: false } },
      })
      return engine
    })()
  }
  return enginePromise
}

// ── Image cropping ──

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

/** Crop a sub-rectangle (pixel coords) out of a loaded image and return a PNG data URL. */
function cropImagePx(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context failed')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  return canvas.toDataURL('image/png')
}

// ── Subtitle line selection ──

/** True when the line is mostly Latin letters (i.e. an English subtitle line). */
function isLatinLine(text: string): boolean {
  const letters = (text.match(/[a-zA-Z]/g) || []).length
  const total = text.replace(/\s/g, '').length
  return total > 0 && letters / total >= 0.4
}

/**
 * Pick the subtitle text out of PaddleOCR's detected boxes. The region crop
 * already removes watermarks/timestamps near the frame edge; here we drop the
 * remaining non-Latin lines (Chinese subtitle, pure-digit timestamps) and join
 * the English lines in reading order.
 */
function selectSubtitleText(lines: resultType): string {
  const nonEmpty = lines.filter((l) => l.text.trim().length > 0)
  if (nonEmpty.length === 0) return ''

  let chosen = nonEmpty.filter((l) => isLatinLine(l.text))
  if (chosen.length === 0) chosen = nonEmpty // no English — fall back to everything

  chosen = [...chosen].sort((a, b) => {
    const ay = Math.min(...a.box.map((p) => p[1]))
    const by = Math.min(...b.box.map((p) => p[1]))
    if (Math.abs(ay - by) > 5) return ay - by
    const ax = Math.min(...a.box.map((p) => p[0]))
    const bx = Math.min(...b.box.map((p) => p[0]))
    return ax - bx
  })

  return chosen.map((l) => l.text.trim()).join(' ')
}

// ── Single recognition ──

async function recognizeRegion(imageDataUrl: string, region: OCRRegion): Promise<string> {
  const img = await loadImage(imageDataUrl)
  const cropped = cropImagePx(
    img,
    Math.round(img.width * region.x),
    Math.round(img.height * region.y),
    Math.round(img.width * region.w),
    Math.round(img.height * region.h),
  )

  const e = await getEngine()
  const res = await e.ocr(cropped)
  return selectSubtitleText(res.src)
}

// ── Queue processing ──

async function processQueue(): Promise<void> {
  if (processing || queue.length === 0) return
  processing = true

  while (queue.length > 0) {
    const job = queue.shift()!
    try {
      const text = await recognizeRegion(job.imageDataUrl, job.region)
      if (onResult) {
        onResult({ snapshotId: job.snapshotId, text })
      }
    } catch (err) {
      console.error(`OCR failed for snapshot ${job.snapshotId}:`, err)
      // Still report back, with error text
      if (onResult) {
        onResult({ snapshotId: job.snapshotId, text: '[OCR Error]' })
      }
    }
  }

  processing = false
}

// ── Correction feedback (engine-agnostic) ──

/** Collapse whitespace + trim, so "identical" raw lines hit the exact-match cache. */
function normalizeOcrText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Levenshtein edit distance (for conservative word-pair learning). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

/**
 * Apply learned corrections to a raw OCR result: exact-match cache first, then
 * the word dictionary. Returns the original text unchanged when nothing matches.
 */
export function applyCorrections(raw: string, corrections: OcrCorrections | null | undefined): string {
  if (!corrections) return raw
  const norm = normalizeOcrText(raw)
  if (corrections.exact[norm]) return corrections.exact[norm]
  if (Object.keys(corrections.dict).length === 0) return raw

  const applied = norm.replace(/[A-Za-z]+/g, (word) => {
    const lower = word.toLowerCase()
    return corrections.dict[lower] ?? word
  })
  return applied === norm ? raw : applied
}

/**
 * Learn a correction from (raw OCR → user-corrected). Stores the exact pair and
 * conservatively extracts word-level replacements (same word count, ≤2 small
 * edit-distance diffs) into the dictionary. Returns the updated corrections.
 */
export function learnCorrection(
  raw: string,
  corrected: string,
  corrections: OcrCorrections,
): OcrCorrections {
  const r = normalizeOcrText(raw)
  const c = normalizeOcrText(corrected)
  if (!r || !c || r === c) return corrections

  const next: OcrCorrections = {
    exact: { ...corrections.exact, [r]: c },
    dict: { ...corrections.dict },
  }

  const rawWords = r.toLowerCase().match(/[a-z]+/g) ?? []
  const corWords = c.toLowerCase().match(/[a-z]+/g) ?? []
  if (rawWords.length === corWords.length && rawWords.length > 0) {
    const diffs: Array<[string, string]> = []
    for (let i = 0; i < rawWords.length; i++) {
      if (rawWords[i] !== corWords[i]) diffs.push([rawWords[i], corWords[i]])
    }
    // Only learn a handful of short typo fixes — never a full sentence rewrite.
    if (diffs.length > 0 && diffs.length <= 2) {
      for (const [w, cw] of diffs) {
        if (w.length >= 3 && cw.length >= 3 && editDistance(w, cw) <= 2) {
          next.dict[w] = cw
        }
      }
    }
  }

  return next
}

// ── Public API ──

export const OCRService = {
  /** Start the OCR queue. Call once with a callback that receives results. */
  init(callback: OCRCallback, _language?: string): void {
    onResult = callback
    // PaddleOCR's bundled model covers Latin + CJK, so `language` is a no-op.
    // Kept in the signature so callers (VideoPlayer/SourceInput) stay unchanged.
  },

  /** Add a job to the OCR queue. Processing happens asynchronously. */
  enqueue(job: OCRJob): void {
    // Deduplicate — don't OCR the same snapshot twice
    if (queue.some((j) => j.snapshotId === job.snapshotId)) return
    queue.push(job)
    processQueue()
  },

  /** Run OCR on a single image and return the text (synchronous-style, blocking). */
  async recognize(imageDataUrl: string, region: OCRRegion): Promise<string> {
    return recognizeRegion(imageDataUrl, region)
  },

}
