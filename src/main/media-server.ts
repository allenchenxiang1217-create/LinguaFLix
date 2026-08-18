/**
 * Local Media HTTP Server
 *
 * Simple HTTP server to serve local video files to the renderer.
 * Avoids need for custom Electron protocols which have compatibility issues.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { existsSync, createReadStream, statSync } from 'fs'
import { join } from 'path'

let mediaPort = 0

function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    flv: 'video/x-flv',
    wmv: 'video/x-ms-wmv',
    m4v: 'video/mp4',
    ogv: 'video/ogg',
    ts: 'video/mp2t',
    m3u8: 'application/x-mpegURL',
    mpd: 'application/dash+xml',
    vtt: 'text/vtt',
    srt: 'text/plain',
  }
  return mimeTypes[ext || ''] || 'application/octet-stream'
}

/** Directory holding the bundled OCR assets (copied from src/renderer/public/ocr). */
function getOcrDir(): string {
  return join(__dirname, '../renderer/ocr')
}

/**
 * Serve the bundled OCR model assets (det/rec ONNX, dict, ort wasm) over HTTP.
 * The packaged renderer loads from file://, and Chromium refuses file:// fetch —
 * so these are served from this server with permissive CORS instead.
 */
function serveOcr(pathname: string, res: ServerResponse): void {
  const fileName = pathname.replace(/^\/ocr\//, '')
  const filePath = join(getOcrDir(), fileName)
  if (!fileName || !existsSync(filePath)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  try {
    const stats = statSync(filePath)
    const ext = fileName.split('.').pop()?.toLowerCase()
    const contentType =
      ext === 'wasm'
        ? 'application/wasm'
        : ext === 'txt'
          ? 'text/plain; charset=utf-8'
          : 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(stats.size),
      'Access-Control-Allow-Origin': '*',
    })
    createReadStream(filePath).pipe(res)
  } catch {
    res.writeHead(500)
    res.end('Failed to read file')
  }
}

export function startMediaServer(): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${mediaPort}`)

    // OCR model assets — see serveOcr().
    if (url.pathname.startsWith('/ocr/')) {
      serveOcr(url.pathname, res)
      return
    }

    // URL format: /media/<encoded absolute path> — renderer's toMediaUrl
    // percent-encodes each path segment (encodeURIComponent), so filenames with
    // '#', '?', '%', spaces or non-ASCII round-trip. decodeURIComponent pairs
    // with that encoding (decodeURI alone would leave %3A etc. untouched).
    let filePath = decodeURIComponent(url.pathname.replace(/^\/media/, ''))

    // Windows: `/C:/Users/...` is not a valid absolute path — fs.existsSync
    // would always be false, so the video 404s. Strip the leading slash in front
    // of the drive letter to get `C:/Users/...` (Node accepts forward slashes
    // on Windows). macOS `/Users/...` is untouched.
    const driveMatch = filePath.match(/^\/([a-zA-Z]):(\/|$)/)
    if (driveMatch) {
      filePath = driveMatch[1] + ':' + driveMatch[2] + filePath.slice(driveMatch[0].length)
    }

    if (!filePath) {
      res.writeHead(400)
      res.end('Bad request')
      return
    }

    if (!existsSync(filePath)) {
      res.writeHead(404)
      res.end('File not found')
      return
    }

    try {
      const stats = statSync(filePath)
      const fileSize = stats.size

      // Handle Range requests for video seeking
      const rangeHeader = req.headers.range
      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        const chunkSize = end - start + 1

        res.writeHead(206, {
          'Content-Type': getContentType(filePath),
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        })
        const stream = createReadStream(filePath, { start, end })
        stream.pipe(res)
        return
      }

      // Full file
      res.writeHead(200, {
        'Content-Type': getContentType(filePath),
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      })
      const stream = createReadStream(filePath)
      stream.pipe(res)
    } catch {
      res.writeHead(500)
      res.end('Failed to read file')
    }
  })

  // Listen on a random available port
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    if (addr && typeof addr === 'object') {
      mediaPort = addr.port
    }
  })
}

export function getMediaBaseUrl(): string {
  return `http://127.0.0.1:${mediaPort}/media`
}

export function getOcrBaseUrl(): string {
  return `http://127.0.0.1:${mediaPort}/ocr`
}
