import { contextBridge, ipcRenderer, webUtils } from 'electron'

// ── Stream resolution result types (must be serializable) ──

export interface ResolvedStreamResult {
  streamUrl?: string
  title?: string
  duration?: number
  format?: string
  headers?: Record<string, string>
  resolved?: boolean
  originalUrl?: string
  error?: string
}

export interface YtDlpStatusResult {
  available: boolean
  path?: string
}

export interface YtDlpDownloadResult {
  success: boolean
  path?: string
  error?: string
}

// Define the API that the renderer process can access
const electronAPI = {
  // Video file dialog
  openVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:openVideo'),

  // Subtitle file dialog
  openSubtitle: (): Promise<{ filePath: string; fileName: string; content: string } | null> =>
    ipcRenderer.invoke('dialog:openSubtitle'),

  /** Absolute path of a dragged/selected File (Electron ≥32). Persists the raw
   *  path so a drag-and-drop / <input type=file> import survives reload, exactly
   *  like the open-video dialog path. Returns '' when the path isn't accessible. */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // Screenshot save/read
  saveScreenshot: (dataUrl: string, timestamp: number): Promise<{ filePath: string; fileName: string }> =>
    ipcRenderer.invoke('screenshot:save', dataUrl, timestamp),

  readScreenshot: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('screenshot:read', filePath),

  /** Delete a saved screenshot PNG (deletion cascade: free disk space). */
  deleteScreenshot: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('screenshot:delete', filePath),

  // ── Stream Resolution ──
  /** Resolve a platform URL (YouTube, Bilibili, etc.) to a direct stream URL. */
  resolveStreamUrl: (url: string): Promise<ResolvedStreamResult> =>
    ipcRenderer.invoke('stream:resolve', url),

  /** Check if yt-dlp is installed and available. */
  checkYtDlp: (): Promise<YtDlpStatusResult> =>
    ipcRenderer.invoke('stream:checkYtDlp'),

  /** Download the yt-dlp binary. */
  downloadYtDlp: (): Promise<YtDlpDownloadResult> =>
    ipcRenderer.invoke('stream:downloadYtDlp'),

  /** Download a platform video to the local videos folder. */
  downloadVideo: (url: string): Promise<{ success?: boolean; filePath?: string; fileName?: string; downloadDir?: string; error?: string }> =>
    ipcRenderer.invoke('stream:download', url),

  /** Listen for download progress updates. */
  onDownloadProgress: (callback: (progress: { percent: number; speed: string; eta: string; status: string; outputPath?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress)
    ipcRenderer.on('stream:download-progress', handler)
    return () => ipcRenderer.removeListener('stream:download-progress', handler)
  },

  /** Get the download directory path. */
  getDownloadDir: (): Promise<{ dir: string }> =>
    ipcRenderer.invoke('stream:getDownloadDir'),

  /** Get the local media HTTP server base URL. */
  getMediaBaseUrl: (): Promise<{ url: string }> =>
    ipcRenderer.invoke('stream:getMediaBaseUrl'),

  /** Get the OCR asset base URL (served by the local HTTP server). */
  getOcrBaseUrl: (): Promise<{ url: string }> =>
    ipcRenderer.invoke('ocr:getBaseUrl'),

  /** Chinese-English dictionary lookup (有道), proxied through the main process. */
  lookupZhDict: (word: string): Promise<{ data?: any; error?: string }> =>
    ipcRenderer.invoke('dict:lookupZh', word),

  /** English-English dictionary lookup (dictionaryapi.dev), proxied through the main process. */
  lookupEnDict: (word: string): Promise<{ data?: any; error?: string }> =>
    ipcRenderer.invoke('dict:lookupEn', word),

  /** Offline ECDICT lookup (bundled SQLite) — returns both zh + en senses. */
  lookupLocalDict: (word: string): Promise<{ data?: any; error?: string }> =>
    ipcRenderer.invoke('dict:lookupLocal', word),
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type augmentation for the window object
export type ElectronAPI = typeof electronAPI
