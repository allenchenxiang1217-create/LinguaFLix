/**
 * Stream Resolver — uses yt-dlp to extract direct stream URLs from platform pages.
 *
 * Supported platforms: YouTube, Bilibili, Vimeo, and 1000+ others via yt-dlp.
 * For direct video file URLs (.mp4, .webm, etc.), returns the URL unchanged.
 *
 * Optimizations:
 *   - 30-min result cache → near-instant replay of same video
 *   - yt-dlp format pre-selection via -f → avoids enumerating 100s of formats
 *   - --no-check-formats + --extractor-retries 1 → less network overhead
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { YtDlpManager } from './ytdlp-manager'
import { downloadVideoWithYtdlp, type DownloadProgress } from '../../shared/downloader.cjs'

const execFileAsync = promisify(execFile)

// ── Types ──

export interface ResolvedStream {
  streamUrl: string
  title: string
  duration: number
  format: string
  headers: Record<string, string>
  resolved: boolean
  originalUrl: string
}

interface YtDlpJsonOutput {
  title?: string
  fulltitle?: string
  duration?: number
  url?: string
  format?: string
  format_id?: string
  protocol?: string
  formats?: Array<YtDlpFormat>
  requested_formats?: Array<YtDlpFormat>
  http_headers?: Record<string, string>
  extractor?: string
  webpage_url?: string
}

interface YtDlpFormat {
  format_id: string
  url?: string
  manifest_url?: string
  protocol?: string
  resolution?: string
  height?: number
  width?: number
  vcodec?: string
  acodec?: string
  ext?: string
  filesize?: number
  tbr?: number
  http_headers?: Record<string, string>
  format_note?: string
  fps?: number
}

// ── Resolution Cache ──

interface CacheEntry {
  result: ResolvedStream
  timestamp: number
}

const CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const cache = new Map<string, CacheEntry>()

function getCached(url: string): ResolvedStream | null {
  const entry = cache.get(url)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(url)
    return null
  }
  return entry.result
}

function setCache(url: string, result: ResolvedStream): void {
  // Limit cache size to 50 entries
  if (cache.size >= 50) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
  cache.set(url, { result, timestamp: Date.now() })
}

/** Clear expired entries. Call periodically. */
function pruneCache(): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > CACHE_TTL) cache.delete(key)
  }
}

// ── URL Detection ──

const PLATFORM_DOMAINS = new Set([
  'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
  'bilibili.com', 'www.bilibili.com', 'b23.tv',
  'vimeo.com', 'player.vimeo.com',
  'dailymotion.com', 'www.dailymotion.com',
  'twitch.tv', 'www.twitch.tv',
  'nicovideo.jp', 'www.nicovideo.jp',
  'ted.com', 'www.ted.com',
])

const DIRECT_VIDEO_EXTENSIONS = new Set([
  'mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v',
  'ogv', '3gp', '3g2', 'ts', 'm3u8', 'mpd',
])

export function isPlatformUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (PLATFORM_DOMAINS.has(host)) return true
    if (host.endsWith('.youtube.com') || host.endsWith('.bilibili.com')) return true
    if (host === 'b23.tv' || host === 'youtu.be') return true
    return false
  } catch {
    return false
  }
}

export function isDirectVideoUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const ext = u.pathname.split('.').pop()
    if (ext && DIRECT_VIDEO_EXTENSIONS.has(ext)) return true
    if (url.startsWith('data:video/') || url.startsWith('blob:')) return true
    return false
  } catch {
    const ext = url.split('.').pop()?.toLowerCase()
    return ext ? DIRECT_VIDEO_EXTENSIONS.has(ext) : false
  }
}

// ── Resolution ──

const RESOLUTION_TIMEOUT = 20_000 // reduced from 30s

/** yt-dlp format selector: prefer 720p combined stream, fall back gracefully */
/** yt-dlp format selector: prefer combined streams, fall back to separate video+audio for DASH-only platforms like Bilibili */
const RESOLUTION_FORMAT = 'best[height<=720]/bestvideo[height<=720]+bestaudio/best'

export async function resolveStreamUrl(
  url: string,
  onProgress?: (status: string) => void,
): Promise<ResolvedStream> {
  // Direct URLs pass through unchanged
  if (isDirectVideoUrl(url)) {
    return {
      streamUrl: url,
      title: url.split('/').pop()?.split('?')[0] || 'Video',
      duration: 0,
      format: 'direct',
      headers: {},
      resolved: false,
      originalUrl: url,
    }
  }

  // Unknown URLs: try as direct
  if (!isPlatformUrl(url)) {
    return {
      streamUrl: url,
      title: url.split('/').pop()?.split('?')[0] || 'Video',
      duration: 0,
      format: 'direct',
      headers: {},
      resolved: false,
      originalUrl: url,
    }
  }

  // ── Cache check ──
  const cached = getCached(url)
  if (cached) {
    onProgress?.('Ready (cached)')
    return cached
  }

  onProgress?.('Resolving...')

  // Ensure yt-dlp is available
  const ytdlpPath = await YtDlpManager.getPath()

  // Speed-optimized flags:
  //   -f: pre-select best format (avoids dumping 100s of formats)
  //   --no-check-formats: don't verify each format URL is alive
  //   --extractor-retries 1: don't retry failed extractors multiple times
  const args = [
    '--dump-json',
    '-f', RESOLUTION_FORMAT,
    '--no-playlist',
    '--no-check-formats',
    '--extractor-retries', '1',
    '--socket-timeout', '10',
    url,
  ]

  try {
    const { stdout } = await execFileAsync(ytdlpPath, args, {
      timeout: RESOLUTION_TIMEOUT,
      maxBuffer: 5 * 1024 * 1024, // 5MB (reduced from 10MB thanks to format pre-selection)
    })

    const info: YtDlpJsonOutput = JSON.parse(stdout.trim())
    const title = info.fulltitle || info.title || 'Unknown'

    // ── Handle multi-part formats (e.g., Bilibili DASH: separate video + audio) ──
    // When yt-dlp selects `bestvideo+bestaudio`, it returns multiple streams in
    // `requested_formats` with no single combined `url` at top-level.
    const requestedFormats = info.requested_formats

    if (requestedFormats && requestedFormats.length >= 2) {
      // Multi-part stream: pick the video stream and note audio is separate
      const videoFmt = requestedFormats.find(
        (f) => f.vcodec && f.vcodec !== 'none' && f.url,
      )
      const audioFmt = requestedFormats.find(
        (f) => f.acodec && f.acodec !== 'none' && f.url,
      )

      if (!videoFmt) {
        throw new Error('No video stream found in multi-part format.')
      }
      if (!videoFmt.url) {
        throw new Error('The video stream has no playable URL in multi-part format.')
      }

      // Collect headers from the format entry
      const headers: Record<string, string> = {}
      const fmtHeaders = videoFmt.http_headers || info.http_headers || {}
      for (const [k, v] of Object.entries(fmtHeaders)) {
        headers[k.toLowerCase()] = String(v)
      }
      if (!headers['user-agent']) {
        headers['user-agent'] =
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      }

      const height = videoFmt.height ? `${videoFmt.height}p` : ''
      const formatLabel = height || 'video-only'

      // Store audio URL in headers so the frontend can use MSE later
      if (audioFmt?.url) {
        headers['x-audio-url'] = audioFmt.url
        // Also pass audio HTTP headers
        if (audioFmt.http_headers) {
          for (const [k, v] of Object.entries(audioFmt.http_headers)) {
            const key = `x-audio-${k.toLowerCase()}`
            if (!headers[key]) headers[key] = String(v)
          }
        }
      }

      const result: ResolvedStream = {
        streamUrl: videoFmt.url,
        title,
        duration: Math.round(info.duration || 0),
        format: formatLabel || 'unknown',
        headers,
        resolved: true,
        originalUrl: url,
      }

      setCache(url, result)
      pruneCache()
      return result
    }

    // ── Single format (combined video+audio or direct URL) ──
    // Use top-level url if present, otherwise pick from formats
    let streamUrl = info.url
    let formatLabel = info.format || ''

    if (!streamUrl) {
      // With -f pre-selection, the best format is already chosen — grab the first playable one
      const bestFormat = selectBestFormat(info.formats || [])
      if (!bestFormat || !bestFormat.url) {
        throw new Error('No playable stream found. The video may require login or is geo-restricted.')
      }
      streamUrl = bestFormat.url
      formatLabel =
        bestFormat.format_note ||
        (bestFormat.height ? `${bestFormat.height}p` : '') +
          (bestFormat.ext ? ` ${bestFormat.ext}` : '') ||
        formatLabel
    }

    // Collect headers
    const headers: Record<string, string> = {}
    const fmtHeaders = info.http_headers || {}
    for (const [k, v] of Object.entries(fmtHeaders)) {
      headers[k.toLowerCase()] = String(v)
    }
    if (!headers['user-agent']) {
      headers['user-agent'] =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    }

    const result: ResolvedStream = {
      streamUrl,
      title,
      duration: Math.round(info.duration || 0),
      format: formatLabel || 'unknown',
      headers,
      resolved: true,
      originalUrl: url,
    }

    // Cache for 30 min
    setCache(url, result)

    // Periodic cache cleanup
    pruneCache()

    return result
  } catch (err: any) {
    if (err.killed && err.signal === 'SIGTERM') {
      throw new Error('Resolution timed out. The video may be unavailable or geo-restricted.')
    }
    if (err.stderr) {
      const stderr = String(err.stderr)
      if (stderr.includes('HTTP Error 403')) {
        throw new Error('Access denied by the platform. The video may require login.')
      }
      if (stderr.includes('Video unavailable') || stderr.includes('This video is not available')) {
        throw new Error('This video is not available (private, deleted, or geo-restricted).')
      }
      if (stderr.includes('which is not a valid URL')) {
        throw new Error('The provided URL is not recognized as a supported video link.')
      }
    }
    throw new Error(err.message || 'Failed to resolve video URL. Check the link and try again.')
  }
}

// ── Format Selection (lightweight — used as fallback after -f pre-selection) ──

function selectBestFormat(formats: YtDlpFormat[]): YtDlpFormat | null {
  if (!formats || formats.length === 0) return null

  // With -f pre-selection, formats are already filtered — prefer combined streams
  const combined = formats.find(
    (f) => f.url && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && f.protocol !== 'm3u8_native',
  )
  if (combined) return combined

  // Fall back to any video format with a URL
  const videoFormat = formats.find((f) => f.url && f.protocol !== 'm3u8_native')
  if (videoFormat) return videoFormat

  // Last resort: any format with a URL
  return formats.find((f) => f.url) || null
}

// ── Download ──

// The yt-dlp download logic (H.264/AAC format forcing, --force-ipv4, retries,
// stderr capture, codec probe) lives in shared/downloader.cjs — the SAME module
// the web backend (server/index.js) uses. Edit there, not here. DownloadProgress
// is re-exported so downstream importers (ipc-handlers) keep their type.
export type { DownloadProgress } from '../../shared/downloader.cjs'

/**
 * Download a platform video to the user's local video folder using yt-dlp.
 * Reports progress via the `onProgress` callback.
 * Returns the path to the downloaded file on success.
 */
export async function downloadVideo(
  url: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<string> {
  const ytdlpPath = await YtDlpManager.getPath()
  // Use macOS Videos folder / LinguaFlix subfolder
  const downloadDir = join(app.getPath('videos'), 'LinguaFlix')
  // Packaged app ships ffmpeg/ffprobe in resources/ (see electron-builder.yml)
  // so DASH video+audio merging works out of the box. In dev, ffmpeg is picked
  // up from PATH by yt-dlp itself, so no location is passed.
  const ffmpegLocation = app.isPackaged
    ? process.resourcesPath
    : undefined
  const { filePath } = await downloadVideoWithYtdlp({ ytdlpPath, downloadDir, url, onProgress, ffmpegLocation })
  return filePath
}

/** Get the LinguaFlix download directory path. */
export function getDownloadDir(): string {
  const dir = join(app.getPath('videos'), 'LinguaFlix')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
