/**
 * yt-dlp Binary Manager — finds, downloads, and caches the yt-dlp binary.
 *
 * Search order:
 *   1. Cached path from previous resolution (module-level variable)
 *   2. `yt-dlp` in system PATH
 *   3. Downloaded binary in app userData directory
 *
 * On first run, if yt-dlp is not found, it can be auto-downloaded from GitHub.
 */

import { app } from 'electron'
import { execFile } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, chmodSync, createWriteStream, openSync, readSync, closeSync, unlinkSync } from 'fs'
import { get } from 'https'
import { pipeline } from 'stream'
import { promisify } from 'util'

const pipelineAsync = promisify(pipeline)
const execFileAsync = promisify(execFile)

// ── Constants ──

const BINARY_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
const GITHUB_DL_URL =
  process.platform === 'win32'
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'

// ── Module state ──

let cachedPath: string | null = null
let availabilityChecked = false
let availabilityResult = false

// ── Path helpers ──

function getUserDataBinDir(): string {
  const dir = join(app.getPath('userData'), 'bin')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getDownloadPath(): string {
  return join(getUserDataBinDir(), BINARY_NAME)
}

// ── PATH resolution ──

async function findInPath(): Promise<string | null> {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(cmd, ['yt-dlp'], { timeout: 5000 })
    const found = stdout.trim().split('\n')[0]?.trim()
    if (found && existsSync(found)) return found
  } catch {
    // Not in PATH
  }
  return null
}

// ── Download ──

interface DownloadProgress {
  percent: number
  downloadedBytes: number
  totalBytes: number | null
}

async function downloadBinary(
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
  const destPath = getDownloadPath()

  return new Promise<string>((resolve, reject) => {
    const request = get(GITHUB_DL_URL, { timeout: 120_000 })

    request.on('response', (response) => {
      // Handle redirects
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          const redirectReq = get(redirectUrl, { timeout: 120_000 })
          redirectReq.on('response', (redirectRes) => {
            pipeDownload(redirectRes, destPath, onProgress, resolve, reject)
          })
          redirectReq.on('error', reject)
          return
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`))
        return
      }

      pipeDownload(response, destPath, onProgress, resolve, reject)
    })

    request.on('error', reject)
    request.setTimeout(120_000, () => {
      request.destroy()
      reject(new Error('Download timed out'))
    })
  })
}

function pipeDownload(
  response: import('http').IncomingMessage,
  destPath: string,
  onProgress: ((progress: DownloadProgress) => void) | undefined,
  resolve: (path: string) => void,
  reject: (error: Error) => void,
): void {
  const totalBytesStr = response.headers['content-length']
  const totalBytes = totalBytesStr ? parseInt(totalBytesStr, 10) : null
  let downloadedBytes = 0

  const fileStream = createWriteStream(destPath)

  response.on('data', (chunk: Buffer) => {
    downloadedBytes += chunk.length
    if (onProgress && totalBytes) {
      onProgress({
        percent: Math.round((downloadedBytes / totalBytes) * 100),
        downloadedBytes,
        totalBytes,
      })
    }
  })

  pipelineAsync(response, fileStream)
    .then(() => {
      if (process.platform === 'win32') {
        const header = Buffer.alloc(2)
        try {
          const fd = openSync(destPath, 'r')
          readSync(fd, header, 0, 2, 0)
          closeSync(fd)
        } catch (err) {
          try { unlinkSync(destPath) } catch { /* ignore cleanup failure */ }
          reject(new Error(`Downloaded yt-dlp.exe could not be validated: ${(err as Error).message}`))
          return
        }
        if (header[0] !== 0x4d || header[1] !== 0x5a) {
          try { unlinkSync(destPath) } catch { /* ignore cleanup failure */ }
          reject(new Error('Downloaded yt-dlp file is not a valid Windows executable. Check the network or proxy response.'))
          return
        }
      }
      // Make executable on macOS/Linux
      if (process.platform !== 'win32') {
        try {
          chmodSync(destPath, 0o755)
        } catch {
          // chmod failed — might still work
        }
      }
      resolve(destPath)
    })
    .catch(reject)
}

// ── Public API ──

export const YtDlpManager = {
  /** Get the path to the yt-dlp binary, downloading if necessary. */
  async getPath(): Promise<string> {
    if (cachedPath) return cachedPath

    // 0. Bundled binary (packaged app ships yt-dlp.exe in resources/ so users
    //    never need to install or download anything).
    const bundledPath = join(process.resourcesPath, 'yt-dlp.exe')
    if (app.isPackaged && existsSync(bundledPath)) {
      cachedPath = bundledPath
      availabilityChecked = true
      availabilityResult = true
      return cachedPath
    }

    // 1. Check system PATH
    const inPath = await findInPath()
    if (inPath) {
      cachedPath = inPath // Keep the absolute path returned by where.exe on Windows.
      availabilityChecked = true
      availabilityResult = true
      return cachedPath
    }

    // 2. Check downloaded binary
    const downloadPath = getDownloadPath()
    if (existsSync(downloadPath)) {
      cachedPath = downloadPath
      availabilityChecked = true
      availabilityResult = true
      return cachedPath
    }

    // 3. Not found — caller should download
    throw new Error('yt-dlp not found. Call download() to install it.')
  },

  /** Check if yt-dlp is available (does not download). */
  async isAvailable(): Promise<boolean> {
    if (availabilityChecked) return availabilityResult

    try {
      await this.getPath()
      return true
    } catch {
      availabilityChecked = true
      availabilityResult = false
      return false
    }
  },

  /** Download yt-dlp binary. Returns the path on success. */
  async download(onProgress?: (pct: number) => void): Promise<string> {
    const path = await downloadBinary(
      onProgress
        ? (p) => onProgress(p.percent)
        : undefined,
    )
    cachedPath = path
    availabilityChecked = true
    availabilityResult = true
    return path
  },
}
