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
}): Promise<DownloadResult>
