/**
 * Type declarations for shared/downloader.cjs (CommonJS). Kept hand-written and
 * adjacent so the Electron main process (which type-checks via `tsc --noEmit`)
 * gets full types for the shared logic.
 */

export interface DownloadProgress {
  percent: number
  speed: string
  eta: string
  status: 'starting' | 'downloading' | 'merging' | 'complete' | 'error'
  outputPath?: string
}

export interface DownloadResult {
  filePath: string
  fileName: string
  downloadDir: string
  codec?: string
}

export declare const FORMAT_SELECTOR: string

export declare function buildDownloadArgs(opts: {
  outputTemplate: string
  url: string
  ffmpegLocation?: string
}): string[]

export declare function probeVideoCodec(filePath: string): Promise<string | null>

export declare function runDownloadOnce(opts: {
  ytdlpPath: string
  args: string[]
  onProgress: (p: DownloadProgress) => void
  downloadDir: string
}): Promise<DownloadResult>

export declare function downloadVideoWithYtdlp(opts: {
  ytdlpPath: string
  downloadDir: string
  url: string
  onProgress: (p: DownloadProgress) => void
  ffmpegLocation?: string
}): Promise<DownloadResult>

/** Windows system proxy (http URL) or null. Best-effort, Windows-only. */
export declare function getWindowsProxy(): string | null

/** yt-dlp --js-runtimes value ("node:/path") or null. */
export declare function findJsRuntime(): string | null

/** Extra yt-dlp args that make platform downloads work on a proxied box. */
export declare function buildPlatformArgs(): string[]

/** Env overrides (HTTP(S)_PROXY / NO_PROXY) for the yt-dlp child process. */
export declare function buildPlatformEnv(): Record<string, string> | undefined
