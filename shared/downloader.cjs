/**
 * Shared yt-dlp download logic — the SINGLE source of truth for downloading
 * platform videos. Used by BOTH entry points:
 *
 *   - web backend:  server/index.js        (CommonJS `require`)
 *   - Electron main: src/main/stream-resolver.ts  (`import` — bundled by electron-vite)
 *
 * Keep every fix HERE so both entry points behave identically and a fix in one
 * can never be forgotten in the other:
 *
 *   - H.264 (avc1) + AAC (mp4a) forcing  → plays in every browser/player
 *   - --force-ipv4                       → fixes Bilibili TLS resets over IPv6
 *   - --socket-timeout / --retries + one automatic retry → survives transient failures
 *   - bounded stderr capture             → useful error messages
 *   - ffprobe codec check                → warns when a platform ignores the selector
 *
 * This file is CommonJS (the server is plain Node). The `.cjs` extension tells
 * Node AND Vite to parse it as CJS, so both the server's `require()` and the
 * Electron bundle's `import` interop correctly. Types live in the adjacent
 * `downloader.d.cts` for the TypeScript side.
 */
const child_process = require('child_process')
const path = require('path')
const fs = require('fs')

// ── Windows stdout encoding ──
// On a Chinese/Japanese Windows system, Python (and therefore the PyInstaller-
// packaged yt-dlp.exe) writes non-ASCII paths to stdout in the console code page
// (GBK/cp936), NOT UTF-8. Node's Buffer#toString() decodes as UTF-8, which mangles
// every CJK filename → the API returns a mojibake path → the renderer 404s on
// /media/<mojibake>. TextDecoder('gbk') is streaming and handles multi-byte
// characters split across data chunks (unlike StringDecoder, which only supports
// utf8/utf16le/latin1/base64/hex).
function createStdoutDecoder() {
  if (process.platform === 'win32') {
    try {
      return new TextDecoder('gbk')
    } catch {
      // Fall back to UTF-8 if full-icu isn't available.
      return null
    }
  }
  return null
}

// ── Windows system proxy + JS runtime detection ──
// yt-dlp (a Python process) does NOT read the Windows system proxy settings by
// itself, and the newer YouTube extractor needs a JS runtime (node/deno) to
// parse the player. Without these, "paste a YouTube link" fails on machines
// that browse YouTube fine through a VPN/system proxy. Detection is best-effort
// and only active on Windows / when the binary is actually found, so machines
// that work today keep working identically.

let cachedProxy = null
let cachedJsRuntime = null

/** Read the Windows system proxy (HKCU Internet Settings). Returns http URL or null. */
function getWindowsProxy() {
  if (process.platform !== 'win32') return cachedProxy || null
  if (cachedProxy !== null) return cachedProxy || null
  try {
    const { execFileSync } = require('child_process')
    // ProxyEnable = 0x1 means the system proxy is on.
    const enableOut = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable'], { encoding: 'utf8', timeout: 3000 })
    if (!/0x1/.test(enableOut)) { cachedProxy = ''; return null }
    const serverOut = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'], { encoding: 'utf8', timeout: 3000 })
    const m = serverOut.match(/ProxyServer\s+REG_SZ\s+(\S+)/)
    if (!m || !m[1]) { cachedProxy = ''; return null }
    let proxy = m[1].trim()
    // A "http=127.0.0.1:7890;https=127.0.0.1:7890" scheme list → take the http entry.
    if (proxy.includes('=')) {
      const httpEntry = proxy.split(';').find((e) => e.startsWith('http='))
      proxy = httpEntry ? httpEntry.split('=')[1] : proxy.split('=')[1]
    }
    if (!proxy.includes('://')) proxy = 'http://' + proxy
    cachedProxy = proxy
    return proxy
  } catch {
    cachedProxy = ''
    return null
  }
}

/**
 * Find a usable JS runtime for yt-dlp's YouTube extractor (node preferred).
 * Returns "runtime:/path" (yt-dlp --js-runtimes format) or null.
 */
function findJsRuntime() {
  if (cachedJsRuntime !== null) return cachedJsRuntime || null
  const candidates = []
  // Common Windows install locations + PATH lookup.
  if (process.env.NODE) candidates.push(process.env.NODE)
  const { execFileSync } = require('child_process')
  try {
    const out = execFileSync('where', ['node'], { encoding: 'utf8', timeout: 3000 })
    const first = out.trim().split(/\r?\n/)[0]
    if (first) candidates.push(first)
  } catch { /* not on PATH */ }
  candidates.push(
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\nodejs\\node.exe',
    'D:\\node.exe',
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
  )
  const fs2 = require('fs')
  for (const c of candidates) {
    if (c && fs2.existsSync(c)) { cachedJsRuntime = 'node:' + c; return cachedJsRuntime }
  }
  cachedJsRuntime = ''
  return null
}

/** Extra yt-dlp args that make platform downloads work on a proxied Windows box. */
function buildPlatformArgs() {
  const args = []
  const js = findJsRuntime()
  if (js) args.push('--js-runtimes', js)
  // YouTube: the default android_vr client returns HTTP 403 when downloading
  // the video stream through many proxies/VPNs, and the web client only serves
  // storyboard images for some videos. The plain `android` client downloads
  // both reliably. Scoped to youtube, so other platforms are unaffected.
  args.push('--extractor-args', 'youtube:player_client=android')
  return args
}

/** Environment overrides for the yt-dlp child process (proxy via HTTP(S)_PROXY). */
function buildPlatformEnv() {
  const proxy = getWindowsProxy()
  if (!proxy) return undefined
  return {
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    NO_PROXY: 'localhost,127.0.0.1,::1,.bilibili.com,.bilivideo.com,.b23.tv,.hdslb.com,.mcdn.bilivideo.cn,.biliapi.net',
  }
}

// ── Format forcing ──// FORCE H.264 (avc1) video + AAC (mp4a) audio in an mp4 container — the combo
// every browser/player decodes. yt-dlp's default sort ranks AV1 above h264, so
// without this you download files that can't be decoded → "Video failed to
// load". The fallback chain degrades to "any H.264 mp4" then "anything" for
// platforms that only offer exotic formats.
const FORMAT_SELECTOR =
  'bestvideo[ext=mp4][height<=720][vcodec^=avc1]+bestaudio[acodec^=mp4a]' +
  '/best[ext=mp4][height<=720][vcodec^=avc1]' +
  '/best[ext=mp4][vcodec^=avc1]' +
  '/best'

// --force-ipv4 is the fix for Bilibili (and some other platforms) resetting TLS
// mid-download over IPv6, which yt-dlp reports as
// "SSL: UNEXPECTED_EOF_WHILE_READING … giving up after 10 retries". Forcing IPv4
// downloads cleanly in seconds. --socket-timeout keeps slow connections from
// dying during stalls. --retries 5 handles transient network blips within a
// single attempt.
const STABILITY_ARGS = [
  '--force-ipv4',
  '--socket-timeout', '60',
  '--retries', '5',
  '--fragment-retries', '10',
  '--extractor-retries', '3',
  '--retry-sleep', '2',
]

/**
 * Build the full yt-dlp argument list for a download. Split out so callers can
 * inspect/override args if they ever need a special case.
 *
 * `ffmpegLocation` (optional): directory containing ffmpeg/ffprobe. Passed to
 * yt-dlp via --ffmpeg-location so a packaged app's bundled ffmpeg is used even
 * when nothing is on PATH — without it, yt-dlp would fail to merge DASH
 * video+audio streams ("ERROR: You have requested merging of multiple formats
 * but ffmpeg is not installed").
 */
function buildDownloadArgs({ outputTemplate, url, ffmpegLocation }) {
  const args = [
    '-f', FORMAT_SELECTOR,
    ...STABILITY_ARGS,
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--newline',
    '-o', outputTemplate,
    '--print', 'after_move:filepath',
    url,
  ]
  if (ffmpegLocation) {
    args.unshift('--ffmpeg-location', ffmpegLocation)
  }
  // JS runtime for the YouTube extractor (node/deno) — required by recent
  // yt-dlp; harmless on other platforms.
  const platformArgs = buildPlatformArgs()
  if (platformArgs.length) {
    args.unshift(...platformArgs)
  }
  return args
}

// ── Codec probe ──

/**
 * Probe a downloaded file's video codec. Resolves with the codec name (e.g.
 * "h264") or null if ffprobe is unavailable. The -f selector already forces
 * H.264, so this is a belt-and-suspenders warning when a platform ignores it.
 */
function probeVideoCodec(filePath) {
  return new Promise((resolve) => {
    child_process.execFile(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filePath],
      { timeout: 10000 },
      (err, stdout) => {
        if (err) { resolve(null); return }
        resolve(stdout.trim())
      },
    )
  })
}

// ── Download ──

/**
 * Run one yt-dlp download process. Resolves with the final output metadata or
 * rejects with a human-readable error that includes yt-dlp's own stderr.
 */
function runDownloadOnce({ ytdlpPath, args, onProgress, downloadDir }) {
  return new Promise((resolve, reject) => {
    onProgress({ percent: 0, speed: '', eta: '', status: 'starting' })
    const proc = child_process.spawn(ytdlpPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildPlatformEnv() ? { ...process.env, ...buildPlatformEnv() } : undefined,
    })
    let lastPercent = 0
    let outputPath = ''
    const stderrTail = []
    // Decode yt-dlp's stdout with the correct code page on Windows (GBK for
    // CJK locales) so file paths with non-ASCII characters survive intact.
    const outDecoder = createStdoutDecoder()
    // stderr needs its OWN decoder — TextDecoder is stateful (multi-byte chars
    // can span chunks), so sharing one between stdout and stderr would corrupt
    // both streams' output.
    const errDecoder = createStdoutDecoder()

    proc.stderr.on('data', (data) => {
      // stderr is also code-page encoded on Windows (GBK for CJK locales) —
      // decode it with a dedicated streaming decoder so error messages are
      // readable instead of mojibake (e.g. "python" -> "турусс").
      const text = errDecoder ? errDecoder.decode(data, { stream: true }) : data.toString()
      // Keep a bounded tail of yt-dlp's own error output for useful failure messages.
      for (const line of text.split('\n')) {
        const t = line.trim()
        if (t) { stderrTail.push(t); if (stderrTail.length > 8) stderrTail.shift() }
      }
      // Parse progress line: "[download]  45.2% of ~50.00MiB at  2.3MiB/s ETA 00:12"
      // Anchored to the "[download]" prefix so non-progress lines (e.g. a
      // "[download] Destination: …/100% Natural.mp4" title) can't fake a percent.
      const pctMatch = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
      if (pctMatch) {
        lastPercent = parseFloat(pctMatch[1])
        const speedMatch = text.match(/at\s+(\S+\/s)/)
        const etaMatch = text.match(/ETA\s+(\S+)/)
        onProgress({ percent: lastPercent, speed: speedMatch?.[1] || '', eta: etaMatch?.[1] || '', status: 'downloading' })
      }
      // Detect merging phase
      if (text.includes('[Merger]') || text.includes('[ffmpeg]')) {
        onProgress({ percent: lastPercent, speed: '', eta: '', status: 'merging' })
      }
    })

    proc.stdout.on('data', (data) => {
      if (outDecoder) {
        outputPath += outDecoder.decode(data, { stream: true })
      } else {
        outputPath += data.toString()
      }
    })

    proc.on('close', async (code) => {
      if (outDecoder) outputPath += outDecoder.decode() // flush remaining bytes
      const finalPath = outputPath.trim()
      if (code === 0 && finalPath) {
        const codec = await probeVideoCodec(finalPath).catch(() => null)
        if (codec && codec !== 'h264') {
          console.warn(`⚠️  Downloaded video codec is "${codec}" (not H.264) — may not play in all browsers: ${finalPath}`)
        }
        onProgress({ percent: 100, speed: '', eta: '', status: 'complete', outputPath: finalPath })
        resolve({ filePath: finalPath, fileName: path.basename(finalPath), downloadDir, codec: codec || undefined })
      } else if (code === 0) {
        // yt-dlp exited 0 but --print after_move:filepath produced nothing (a
        // skipped/already-complete edge where the postprocessor didn't move the
        // file). A clearer failure than the generic "Download failed (exit 0)".
        onProgress({ percent: lastPercent, speed: '', eta: '', status: 'error' })
        reject(new Error('yt-dlp finished without reporting an output path — the download may have been skipped.'))
      } else {
        onProgress({ percent: lastPercent, speed: '', eta: '', status: 'error' })
        const detail = stderrTail.join(' ').slice(0, 300)
        reject(new Error(`Download failed (exit code ${code}). ${detail ? `yt-dlp: ${detail}` : 'Try installing ffmpeg for video/audio merging.'}`))
      }
    })

    proc.on('error', (err) => {
      onProgress({ percent: lastPercent, speed: '', eta: '', status: 'error' })
      reject(new Error(`Failed to start download: ${err.message}`))
    })
  })
}

/**
 * Download a platform video into `downloadDir` using yt-dlp. Creates the
 * directory if needed, builds the args, and retries once on transient failure.
 * Resolves with `{ filePath, fileName, downloadDir, codec }`.
 *
 * `ffmpegLocation` (optional): directory containing ffmpeg/ffprobe, forwarded to
 * yt-dlp via --ffmpeg-location (see buildDownloadArgs).
 */
async function downloadVideoWithYtdlp({ ytdlpPath, downloadDir, url, onProgress, ffmpegLocation }) {
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })
  const outputTemplate = path.join(downloadDir, '%(title)s.%(ext)s')
  const args = buildDownloadArgs({ outputTemplate, url, ffmpegLocation })

  // Transient resets are common on platform/CDN connections. Retry with a
  // short backoff while keeping yt-dlp's own certificate validation intact.
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await runDownloadOnce({ ytdlpPath, args, onProgress, downloadDir })
    } catch (err) {
      lastError = err
      if (attempt === 3) break
      const delayMs = attempt * 1500
      console.warn(`Download attempt ${attempt} failed (${err.message}) — retrying in ${delayMs}ms…`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

module.exports = {
  FORMAT_SELECTOR,
  buildDownloadArgs,
  probeVideoCodec,
  runDownloadOnce,
  downloadVideoWithYtdlp,
  getWindowsProxy,
  findJsRuntime,
  buildPlatformArgs,
  buildPlatformEnv,
}
