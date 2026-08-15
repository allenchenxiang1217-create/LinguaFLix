import { ipcMain, dialog } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { YtDlpManager } from './ytdlp-manager'
import { resolveStreamUrl, downloadVideo, getDownloadDir } from './stream-resolver'
import { getMediaBaseUrl, getOcrBaseUrl } from './media-server'

// ── Chinese-English dictionary (有道) normalization ──
interface ZhDictTranslation { pos?: string; meanings: string[] }
interface ZhDictExample { en: string; zh: string }

function normalizeZhDict(data: any, word: string) {
  const ecWord = data?.ec?.word?.[0]
  const phonetic = ecWord?.usphone || ecWord?.ukphone || undefined

  const translations: ZhDictTranslation[] = []
  for (const trGroup of ecWord?.trs || []) {
    for (const tr of trGroup?.tr || []) {
      const meanings = (tr?.l?.i || []).map((s: any) => String(s))
      if (meanings.length) translations.push({ pos: tr?.pos, meanings })
    }
  }

  const examples: ZhDictExample[] = []
  for (const p of (data?.blng_sents_part?.['sentence-pair'] || []).slice(0, 3)) {
    if (p?.sentence && p?.['sentence-translation']) {
      examples.push({ en: p.sentence, zh: p['sentence-translation'] })
    }
  }

  // Fallback: web translations when no core meanings were extracted.
  if (!translations.length && data?.web_trans?.['web-translation']) {
    for (const wt of data.web_trans['web-translation']) {
      const meanings = (wt?.trans || []).map((t: any) => t?.value).filter(Boolean)
      if (meanings.length) translations.push({ meanings })
    }
  }

  return { word, phonetic, translations, examples }
}

// ── Offline ECDICT dictionary (bundled SQLite) ──
// The full ECDICT (CC-BY-SA) is compiled into resources/ecdict.db by
// scripts/build-dictionary.mjs and shipped as an extraResource. It powers
// rich offline EN→CN and EN→EN lookups, with online services as fallback.
interface EcdictSense { pos?: string; meanings: string[] }
interface EcdictEntry { word: string; phonetic?: string; zh: EcdictSense[]; en: EcdictSense[] }

let ecdictDb: DatabaseSync | null = null
let ecdictDbFailed = false

function getEcdictDb(): DatabaseSync | null {
  if (ecdictDb) return ecdictDb
  if (ecdictDbFailed) return null
  const dbPath = app.isPackaged
    ? join(process.resourcesPath, 'ecdict.db')
    : join(__dirname, '../../resources/ecdict.db')
  try {
    ecdictDb = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    ecdictDbFailed = true
    ecdictDb = null
  }
  return ecdictDb
}

/**
 * Split an ECDICT translation/definition blob into per-part-of-speech senses.
 * Lines look like "n. 猫, 恶妇" or "v. beat with a cat-o'-nine-tails". Lines
 * without a POS prefix (e.g. an acronym's expanded full form) become a POS-less
 * sense; `[field]`-tagged lines (domain labels like [计]/[网络]) are dropped.
 */
function parseEcdictSenses(text: string): EcdictSense[] {
  const groups: EcdictSense[] = []
  for (const rawLine of (text || '').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('[')) continue
    const m = line.match(/^([A-Za-z]+\.)\s*(.+)$/)
    if (m && m[2]) {
      const pos = m[1]
      const last = groups[groups.length - 1]
      if (last && last.pos === pos) last.meanings.push(m[2])
      else groups.push({ pos, meanings: [m[2]] })
    } else {
      groups.push({ meanings: [line] })
    }
  }
  return groups
}

export function registerIpcHandlers(): void {
  // Open a video file dialog
  ipcMain.handle('dialog:openVideo', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Video File',
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Open a subtitle file dialog
  ipcMain.handle('dialog:openSubtitle', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Subtitle File',
      filters: [
        { name: 'Subtitle Files', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const content = readFileSync(filePath, 'utf-8')
    return { filePath: filePath, fileName: basename(filePath), content }
  })

  // Save a screenshot image
  ipcMain.handle('screenshot:save', async (_event, dataUrl: string, timestamp: number) => {
    const userDataPath = app.getPath('userData')
    const screenshotsDir = join(userDataPath, 'screenshots')
    mkdirSync(screenshotsDir, { recursive: true })

    const fileName = `snapshot_${Math.floor(timestamp)}s_${Date.now()}.png`
    const filePath = join(screenshotsDir, fileName)

    // Convert data URL to Buffer and save
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
    writeFileSync(filePath, Buffer.from(base64Data, 'base64'))

    return { filePath, fileName }
  })

  // Read a screenshot file as data URL
  ipcMain.handle('screenshot:read', async (_event, filePath: string) => {
    const data = readFileSync(filePath)
    return `data:image/png;base64,${data.toString('base64')}`
  })

  // ── Stream Resolution (yt-dlp) ──

  /**
   * Resolve a platform URL (YouTube, Bilibili, etc.) to a direct stream URL.
   * For direct video URLs, returns them unchanged.
   */
  ipcMain.handle('stream:resolve', async (_event, url: string) => {
    try {
      if (!url || typeof url !== 'string') {
        return { error: 'No URL provided' }
      }

      const result = await resolveStreamUrl(url, (status) => {
        // Could send progress events to renderer, but for now just resolve
      })

      return {
        // Don't return error if resolution was successful
        streamUrl: result.streamUrl,
        title: result.title,
        duration: result.duration,
        format: result.format,
        headers: result.headers,
        resolved: result.resolved,
        originalUrl: result.originalUrl,
      }
    } catch (err: any) {
      return { error: err.message || 'Failed to resolve URL' }
    }
  })

  /**
   * Check if yt-dlp is available on the system.
   */
  ipcMain.handle('stream:checkYtDlp', async () => {
    try {
      const available = await YtDlpManager.isAvailable()
      if (available) {
        const path = await YtDlpManager.getPath()
        return { available: true, path }
      }
      return { available: false }
    } catch {
      return { available: false }
    }
  })

  /**
   * Download the yt-dlp binary (desktop "Install yt-dlp" button).
   */
  ipcMain.handle('stream:downloadYtDlp', async () => {
    try {
      const path = await YtDlpManager.download()
      return { success: true, path }
    } catch (err: any) {
      return { success: false, error: err.message || 'Download failed' }
    }
  })

  /**
   * Download a platform video to the local videos folder.
   * Sends progress updates via event.sender.
   */
  ipcMain.handle('stream:download', async (event, url: string) => {
    try {
      if (!url || typeof url !== 'string') {
        return { error: 'No URL provided' }
      }

      const filePath = await downloadVideo(url, (progress) => {
        event.sender.send('stream:download-progress', progress)
      })

      // Extract just the file name for display
      const fileName = filePath.split('/').pop() || filePath

      return {
        success: true,
        filePath,
        fileName,
        downloadDir: getDownloadDir(),
      }
    } catch (err: any) {
      return { error: err.message || 'Download failed' }
    }
  })

  /**
   * Get the download directory path.
   */
  ipcMain.handle('stream:getDownloadDir', async () => {
    return { dir: getDownloadDir() }
  })

  /**
   * Get the local media HTTP server base URL.
   */
  ipcMain.handle('stream:getMediaBaseUrl', async () => {
    return { url: getMediaBaseUrl() }
  })

  /**
   * Get the OCR asset base URL (served by the same local HTTP server).
   */
  ipcMain.handle('ocr:getBaseUrl', async () => {
    return { url: getOcrBaseUrl() }
  })

  /**
   * Chinese-English dictionary lookup (有道). Proxied through the main process
   * because dict.youdao.com does not send CORS headers, so the renderer cannot
   * fetch it directly. Node's fetch in the main process is not subject to the
   * browser same-origin policy.
   */
  ipcMain.handle('dict:lookupZh', async (_event, word: string) => {
    try {
      if (!word || typeof word !== 'string') return { error: 'No word provided' }
      const res = await fetch(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return { data: normalizeZhDict(data, word) }
    } catch (err: any) {
      return { error: err.message || 'Lookup failed' }
    }
  })

  /**
   * English-English dictionary lookup (dictionaryapi.dev). Also proxied through
   * the main process: dictionaryapi.dev's CORS header is intermittent, so the
   * renderer cannot reliably fetch it directly. Node fetch has no SOP.
   */
  ipcMain.handle('dict:lookupEn', async (_event, word: string) => {
    try {
      if (!word || typeof word !== 'string') return { error: 'No word provided' }
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
      if (!res.ok) return { error: 'not_found' }
      const arr = await res.json()
      const data = Array.isArray(arr) && arr[0] ? arr[0] : null
      if (!data) return { error: 'not_found' }
      return { data }
    } catch (err: any) {
      return { error: err.message || 'Lookup failed' }
    }
  })

  /**
   * Offline dictionary lookup against the bundled ECDICT SQLite DB. Returns both
   * the Chinese translation senses and the English definition senses so the
   * renderer can render either language mode without another round-trip.
   */
  ipcMain.handle('dict:lookupLocal', async (_event, word: string) => {
    try {
      if (!word || typeof word !== 'string') return { error: 'No word provided' }
      const db = getEcdictDb()
      if (!db) return { error: 'no_db' }
      const key = word.trim().toLowerCase()
      if (!key) return { error: 'No word provided' }

      const row = db
        .prepare('SELECT word, phonetic, translation, definition FROM entries WHERE key = ?')
        .get(key) as { word?: string; phonetic?: string; translation?: string; definition?: string } | undefined
      if (!row) return { error: 'not_found' }

      const entry: EcdictEntry = {
        word: row.word || word,
        phonetic: row.phonetic || undefined,
        zh: parseEcdictSenses(row.translation || ''),
        en: parseEcdictSenses(row.definition || ''),
      }
      // Junk rows (prefix/suffix/inflection markers) have no usable senses.
      if (!entry.zh.length && !entry.en.length) return { error: 'not_found' }
      return { data: entry }
    } catch (err: any) {
      return { error: err.message || 'Lookup failed' }
    }
  })
}
