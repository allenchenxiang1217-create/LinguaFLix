/**
 * Stream Resolver Service (Renderer-side)
 *
 * Wraps the Electron preload API for stream URL resolution.
 * In web mode (when window.electronAPI is not available), uses HTTP API to the backend server.
 */

// ── Types ──

// DownloadProgress shape is shared with the backend (shared/downloader.cjs) —
// import it so the two can never drift apart. Type-only: erased at build time.
import type { DownloadProgress } from '../../../shared/downloader.cjs'

export interface ResolvedStream {
  /** The direct stream URL for use in <video> src. */
  streamUrl: string
  /** Video title (from platform metadata, or filename). */
  title: string
  /** Duration in seconds, or 0 if unknown. */
  duration: number
  /** Format description. */
  format: string
  /** Whether the URL was resolved via yt-dlp. */
  isResolved: boolean
  /** Original URL provided by the user. */
  originalUrl: string
  /** HTTP headers needed to access the stream. */
  headers?: Record<string, string>
}

export interface YtDlpStatus {
  available: boolean
  path?: string
}

// ── Backend API base URL ──
let _apiBaseUrl: string | null = null
let _apiBaseUrlPromise: Promise<string> | null = null

async function getApiBaseUrl(): Promise<string> {
  if (_apiBaseUrl) return _apiBaseUrl
  if (!_apiBaseUrlPromise) {
    _apiBaseUrlPromise = (async () => {
      // Try default ports, starting with env or the expected port
      const ports = [5176, 5177, 5178, 5179, 5180]
      for (const port of ports) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) })
          if (res.ok) {
            _apiBaseUrl = `http://127.0.0.1:${port}`
            return _apiBaseUrl
          }
        } catch {}
      }
      _apiBaseUrl = 'http://127.0.0.1:5176' // default fallback
      return _apiBaseUrl
    })()
  }
  return _apiBaseUrlPromise
}

export async function apiCall<T = any>(path: string, options?: RequestInit): Promise<T> {
  const base = await getApiBaseUrl()
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// ── URL Detection (client-side, works without Electron) ──

const PLATFORM_HOSTS = [
  'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
  'bilibili.com', 'www.bilibili.com', 'b23.tv',
  'vimeo.com', 'player.vimeo.com',
  'dailymotion.com', 'www.dailymotion.com',
  'twitch.tv', 'www.twitch.tv',
  'nicovideo.jp', 'www.nicovideo.jp',
  'ted.com', 'www.ted.com',
]

const DIRECT_EXTENSIONS = [
  'mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v',
  'ogv', '3gp', 'ts', 'm3u8', 'mpd',
]

/** Check if a URL is from a streaming platform that needs yt-dlp resolution. */
export function isPlatformUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    return PLATFORM_HOSTS.some(
      (h) => host === h || host.endsWith('.' + h.replace('www.', '')),
    )
  } catch {
    return false
  }
}

/** Check if a URL points directly to a video file. */
export function isDirectVideoUrl(url: string): boolean {
  if (url.startsWith('data:video/') || url.startsWith('blob:')) return true
  try {
    const u = new URL(url)
    const ext = u.pathname.split('.').pop()?.toLowerCase()
    return ext ? DIRECT_EXTENSIONS.includes(ext) : false
  } catch {
    const ext = url.split('.').pop()?.toLowerCase()
    return ext ? DIRECT_EXTENSIONS.includes(ext) : false
  }
}

/**
 * Extract a usable video URL from pasted text.
 *
 * Bilibili and other sites copy their share string with a title prefix and
 * suffix — e.g. 「【阿根廷输球的真正原因】https://www.bilibili.com/video/…
 * 复制打开B站看看」. Pasting that whole string used to fall through platform
 * detection (the combined string is not a valid URL) and land in the
 * "unknown URL → play directly" branch, which fed the junk string to the
 * <video> element and failed with "Video failed to load". Extract the first
 * http(s):// URL and trim trailing sentence/quote punctuation so any wrapped
 * share text behaves exactly like a pure link.
 */
export function extractVideoUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  // Already a clean http(s) URL (with or without query/fragment) — return as-is.
  if (/^https?:\/\/\S+$/i.test(s)) return s
  // Find the first http(s)://… run anywhere in the pasted text.
  const m = s.match(/https?:\/\/\S+/i)
  if (!m) return s // no URL inside — let the caller handle the raw input
  // Trim anything that can trail a pasted URL: CJK (一-鿿), full-width
  // punctuation (　-〿, ＀-￯), brackets/quotes, and stray
  // sentence punctuation.
  return m[0].replace(/[一-鿿　-〿＀-￯'"()（）【】<>《》，。！？、；：]+$/g, '')
}

/** Get a human-readable platform name from a URL. */
export function getPlatformName(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('bilibili') || host === 'b23.tv') return 'Bilibili'
    if (host.includes('youtube') || host === 'youtu.be') return 'YouTube'
    if (host.includes('vimeo')) return 'Vimeo'
    if (host.includes('dailymotion')) return 'Dailymotion'
    if (host.includes('twitch')) return 'Twitch'
    if (host.includes('nicovideo')) return 'Niconico'
    if (host.includes('ted.com')) return 'TED'
    return 'Video Platform'
  } catch {
    return null
  }
}

/** Check if Electron APIs are available. */
function hasElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI
}

/**
 * Convert a file path to a media URL that works in the current environment.
 *
 * In Electron: /path/to/file → http://127.0.0.1:PORT/media/path/to/file (local HTTP server)
 * In web mode: returns a SAME-ORIGIN URL (/media/...) streamed through the Vite
 * dev-server proxy. Same-origin needs no CORS, so the <video> always plays — this
 * is the same mechanism that makes direct file import (blob: URLs) reliable.
 */
let _mediaBaseUrl: string | null = null
let _mediaBaseUrlPromise: Promise<string | null> | null = null

/**
 * Resolve the backend media server base URL (e.g. http://127.0.0.1:5176/media).
 *
 * Failures are NOT cached: if the backend is briefly unavailable (e.g. mid-restart),
 * the next call re-probes instead of getting stuck on an empty value forever.
 */
async function getMediaBaseUrl(): Promise<string | null> {
  if (_mediaBaseUrl) return _mediaBaseUrl
  if (_mediaBaseUrlPromise) return _mediaBaseUrlPromise

  _mediaBaseUrlPromise = (async () => {
    let base: string | null = null
    if (hasElectron()) {
      try {
        const api = (window as any).electronAPI
        const result = await api.getMediaBaseUrl()
        base = result.url || null
      } catch {
        base = null
      }
    } else {
      // Web mode: use the HTTP backend
      try {
        const result = await apiCall<any>('/api/stream/media-base-url')
        base = result.url || null
      } catch {
        base = null
      }
    }
    _mediaBaseUrl = base
    return base
  })()

  const resolved = await _mediaBaseUrlPromise
  // Don't cache a failed probe — allow later calls to re-try.
  if (!resolved) _mediaBaseUrlPromise = null
  return resolved
}

/**
 * Media-server URLs stored by older versions pointed straight at the backend
 * (http://127.0.0.1:5176/media/…). Those are cross-origin and relied on a CORS
 * handshake that fails in some browsers — rewrite them to the same-origin path.
 */
const STORED_MEDIA_URL_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+\/media\//

export function toMediaUrl(filePath: string): string {
  // Already a browser-native blob:/data: URL — return as-is
  if (filePath.startsWith('data:') || filePath.startsWith('blob:')) {
    return filePath
  }

  // Percent-encode each path segment so filenames containing '#', '?', '%', spaces,
  // or non-ASCII characters survive into the URL. A raw '#' would be parsed as a
  // fragment and the video would 404. The backend decodes with decodeURIComponent.
  const encodeLocalPath = (p: string): string => {
    const normalized = p.replace(/\\/g, '/')
    const withSlash = normalized.startsWith('/') ? normalized : '/' + normalized
    return withSlash.split('/').map((seg) => encodeURIComponent(seg)).join('/')
  }

  // ── Electron: local HTTP media server ──
  if (hasElectron()) {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      // A media-server URL stored by an earlier launch points at a port that is
      // now dead (the server picks a new random port every launch). Rewrite it
      // to the current server's base URL when known; resolveReplayableMedia
      // awaits the async base fetch and covers the not-yet-loaded case.
      if (STORED_MEDIA_URL_RE.test(filePath)) {
        getMediaBaseUrl()
        if (_mediaBaseUrl) {
          return _mediaBaseUrl.replace(/\/media\/?$/, '') + filePath.slice(filePath.indexOf('/media/'))
        }
      }
      return filePath
    }
    // Trigger async base URL load
    getMediaBaseUrl()
    if (_mediaBaseUrl) {
      return _mediaBaseUrl + encodeLocalPath(filePath)
    }
    // Fallback: file:// works when renderer is loaded from file://
    return 'file://' + (filePath.startsWith('/') ? filePath : '/' + filePath)
  }

  // ── Web mode: SAME-ORIGIN via the Vite dev-server proxy ──
  // The page (localhost:5173) and the backend (127.0.0.1:5176) are different
  // origins. A cross-origin <video src> + crossOrigin="anonymous" needs a CORS
  // handshake that works in some browsers but fails in others, surfacing as
  // "Video failed to load". By streaming every media URL through the same origin
  // as the page, no CORS is ever involved — the video plays in every browser,
  // exactly like an imported blob: URL does. (Direct-imported videos play because
  // blob: URLs are inherently same-origin; this makes downloaded videos equally
  // reliable by giving them a same-origin URL too.)
  if (filePath.startsWith('https://')) {
    // Remote direct video URL — keep it as-is (the remote host decides CORS).
    return filePath
  }
  if (filePath.startsWith('http://')) {
    // Legacy stored backend URL → rewrite to the same-origin proxy path.
    if (STORED_MEDIA_URL_RE.test(filePath)) {
      return window.location.origin + filePath.slice(filePath.indexOf('/media/'))
    }
    return filePath
  }
  return window.location.origin + '/media' + encodeLocalPath(filePath)
}

/**
 * Pre-load the media base URL. Call this early during app startup.
 */
export async function initMediaUrl(): Promise<void> {
  await getMediaBaseUrl()
}

// ── Stored-record replay guard ──

export type ReplayStatus =
  | { ok: true; src: string }
  | { ok: false; reason: 'needs-reimport' | 'missing-file' }

/**
 * Decide whether a STORED video record can still be played, and resolve the
 * exact <video> src if so.
 *
 * "Continue" and the dashboard cards replay records by their stored filePath.
 * Some stored values can NEVER play again and must not reach the <video>
 * element — doing so surfaces as the misleading "Video failed to load":
 *
 *   - blob:/data: URLs (direct file imports) die when the page reloads. The
 *     browser can only re-read a blob URL created earlier in THIS page session.
 *   - /media URLs whose underlying file was deleted return 404.
 *
 * Legacy cross-origin http://127.0.0.1:PORT/media/… URLs are rewritten to the
 * same-origin path by toMediaUrl before probing.
 */
export async function resolveReplayableMedia(meta: { filePath: string }): Promise<ReplayStatus> {
  let fp = meta.filePath

  // Legacy cross-origin media URL from a previous desktop launch: the stored
  // port is dead (the media server picks a new random port every launch), so
  // re-open would 404. Await the current base URL and rewrite before resolving.
  if (STORED_MEDIA_URL_RE.test(fp)) {
    const base = await getMediaBaseUrl()
    if (base) fp = base.replace(/\/media\/?$/, '') + fp.slice(fp.indexOf('/media/'))
  }

  // Imported file — object URL only lives for this page session.
  if (fp.startsWith('blob:') || fp.startsWith('data:')) {
    try {
      const r = await fetch(fp)
      r.body?.cancel()
      if (r.ok) return { ok: true, src: fp } // still alive (same-session import)
    } catch {
      // dead object URL → fetch rejects; fall through to needs-reimport
    }
    return { ok: false, reason: 'needs-reimport' }
  }

  const src = toMediaUrl(fp)

  // A local file (absolute path or a /media URL) — probe that it still exists
  // on disk without streaming the whole file (Range: bytes=0-0).
  const isLocalMedia =
    fp.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(fp) ||
    src.startsWith(window.location.origin + '/media')
  if (isLocalMedia) {
    try {
      const r = await fetch(src, { headers: { Range: 'bytes=0-0' } })
      r.body?.cancel()
      if (r.status === 404) return { ok: false, reason: 'missing-file' }
      if (r.ok || r.status === 206) return { ok: true, src }
      // Any other non-404 status — let the player attempt and surface its own error.
      return { ok: true, src }
    } catch {
      // Network/server hiccup is not proof the file is gone — let the player try.
      return { ok: true, src }
    }
  }

  // Remote direct URL (or legacy cross-origin URL rewritten by toMediaUrl).
  return { ok: true, src }
}

// ── Resolution ──

/**
 * Resolve a URL to a direct stream URL.
 *
 * - Direct video URLs are returned as-is.
 * - Platform URLs (YT, Bilibili, etc.) are resolved via the Electron main process.
 * - In web mode, platform URLs return an error.
 */
export async function resolveStreamUrl(url: string): Promise<ResolvedStream> {
  // Direct URLs pass through
  if (isDirectVideoUrl(url)) {
    return {
      streamUrl: url,
      title: url.split('/').pop()?.split('?')[0] || 'Video',
      duration: 0,
      format: 'direct',
      isResolved: false,
      originalUrl: url,
    }
  }

  // Platform URLs need Electron
  if (!isPlatformUrl(url)) {
    // Unknown URL — try as direct
    return {
      streamUrl: url,
      title: url.split('/').pop()?.split('?')[0] || 'Video',
      duration: 0,
      format: 'direct',
      isResolved: false,
      originalUrl: url,
    }
  }

  // Resolve via Electron IPC or HTTP API
  if (hasElectron()) {
    const api = (window as any).electronAPI
    const result = await api.resolveStreamUrl(url)
    if (result.error) throw new Error(result.error)
    return {
      streamUrl: result.streamUrl || url,
      title: result.title || 'Video',
      duration: result.duration || 0,
      format: result.format || 'unknown',
      isResolved: result.resolved || false,
      originalUrl: result.originalUrl || url,
      headers: result.headers,
    }
  }

  // Web mode: use HTTP API
  const result = await apiCall<any>('/api/stream/resolve', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })

  if (result.error) throw new Error(result.error)

  return {
    streamUrl: result.streamUrl || url,
    title: result.title || 'Video',
    duration: result.duration || 0,
    format: result.format || 'unknown',
    isResolved: result.resolved || false,
    originalUrl: result.originalUrl || url,
    headers: result.headers,
  }
}

/** Check if yt-dlp is installed and available. */
export async function checkYtDlpAvailable(): Promise<YtDlpStatus> {
  if (hasElectron()) {
    try {
      const api = (window as any).electronAPI
      return await api.checkYtDlp()
    } catch {
      return { available: false }
    }
  }

  // Web mode: use HTTP API
  try {
    return await apiCall('/api/stream/check-ytdlp')
  } catch {
    return { available: false }
  }
}

/** Download the yt-dlp binary. Returns true on success. */
export async function downloadYtDlp(): Promise<boolean> {
  if (hasElectron()) {
    const api = (window as any).electronAPI
    const result = await api.downloadYtDlp()
    if (!result.success) throw new Error(result.error || 'Failed to download yt-dlp')
    return true
  }

  // Web mode: use HTTP API
  const result = await apiCall<any>('/api/stream/download-ytdlp', { method: 'POST' })
  if (!result.success) throw new Error(result.error || 'Failed to download yt-dlp')
  return true
}

// ── Download (yt-dlp → local file) ──

export type { DownloadProgress }

export interface DownloadResult {
  success: boolean
  filePath?: string
  fileName?: string
  downloadDir?: string
  error?: string
}

/**
 * Download a platform video to the user's local video folder.
 * Returns the task result immediately with a taskId for progress tracking.
 */
export async function downloadVideo(url: string): Promise<DownloadResult> {
  if (hasElectron()) {
    const api = (window as any).electronAPI
    return await api.downloadVideo(url)
  }

  // Web mode: use HTTP API (returns a taskId, progress via SSE)
  try {
    const initResult = await apiCall<any>('/api/stream/download', {
      method: 'POST',
      body: JSON.stringify({ url }),
    })

    if (initResult.error) {
      return { success: false, error: initResult.error }
    }

    // If the result already has success (old sync API), return directly
    if (initResult.success !== undefined) {
      return initResult
    }

    // New task-based API: wait for completion via SSE
    const taskId = initResult.taskId
    if (!taskId) {
      return { success: false, error: 'No task ID returned' }
    }

    return await waitForDownloadTask(taskId)
  } catch (err: any) {
    return { success: false, error: err.message || 'Download failed' }
  }
}

/**
 * Wait for a download task to complete by polling the backend progress endpoint.
 *
 * Uses a plain HTTP poll (`once=1`) instead of EventSource so a transient
 * SSE/proxy drop mid-download can never kill the wait — the poll keeps reading the
 * task's real state and recovers on its own. Only gives up after the backend has
 * been unreachable for a sustained period (~2 min).
 */
async function waitForDownloadTask(taskId: string): Promise<DownloadResult> {
  const base = _apiBaseUrl || 'http://127.0.0.1:5176'
  const progressUrl = `${base}/api/stream/download/progress?taskId=${encodeURIComponent(taskId)}&once=1`

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let failedAttempts = 0
    let finished = false

    const finish = (fn: () => void) => {
      if (finished) return
      finished = true
      if (timer) clearTimeout(timer)
      fn()
    }

    const poll = async () => {
      try {
        const res = await fetch(progressUrl, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) {
          // 404 = task evicted/expired
          finish(() => reject(new Error('Download task expired or server restarted')))
          return
        }
        const data = await res.json()

        if (data.error) {
          finish(() => reject(new Error(data.error)))
          return
        }
        if (data.status === 'error') {
          finish(() => reject(new Error(data.error || 'Download failed')))
          return
        }

        // Notify progress subscribers (drives the "Downloading… N%" UI)
        if (_progressCallback) {
          _progressCallback({
            percent: data.percent ?? 0,
            speed: data.speed ?? '',
            eta: data.eta ?? '',
            status: data.status ?? 'downloading',
            outputPath: data.outputPath,
          })
        }

        // Complete?
        if (data.result || data.status === 'complete') {
          const result = data.result || {}
          finish(() => resolve({
            success: true,
            filePath: result.filePath || data.outputPath || '',
            fileName: result.fileName || '',
            downloadDir: result.downloadDir || '',
          }))
          return
        }

        // Still running — poll again shortly
        failedAttempts = 0
        timer = setTimeout(poll, 1000)
      } catch {
        failedAttempts++
        // Backend briefly unreachable — retry. Give up only after a sustained outage.
        if (failedAttempts > 60) {
          finish(() => reject(new Error('Download connection lost')))
          return
        }
        timer = setTimeout(poll, 2000)
      }
    }

    poll()
  })
}

/**
 * Subscribe to download progress updates (cross-environment).
 * Returns an unsubscribe function.
 * In web mode, this sets up a global callback that SSE events will trigger.
 */
let _progressCallback: ((progress: DownloadProgress) => void) | null = null

export function onDownloadProgress(
  callback: (progress: DownloadProgress) => void,
): () => void {
  if (hasElectron()) {
    const api = (window as any).electronAPI
    if (!api?.onDownloadProgress) return () => {}
    return api.onDownloadProgress(callback)
  }

  // Web mode: register global callback, triggered by SSE events
  _progressCallback = callback
  return () => {
    _progressCallback = null
  }
}
