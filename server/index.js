/**
 * LinguaFlix Backend Server
 *
 * Standalone Node.js HTTP server that replaces the Electron main process.
 * Provides all the APIs that the renderer needs:
 *   - Media file streaming (with Range support)
 *   - yt-dlp integration (resolve/download)
 *   - Screenshot save/read
 *   - Platform URL resolution
 *
 * Usage: node server/index.js [--port PORT]
 */

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const stream = require('stream');
const util = require('util');
const child_process = require('child_process');
const { downloadVideoWithYtdlp } = require('../shared/downloader.cjs');

const pipelineAsync = util.promisify(stream.pipeline);
const execFileAsync = util.promisify(child_process.execFile);

const PORT = parseInt(process.env.PORT || process.argv.slice(2).find((_, i, a) => a[i - 1] === '--port') || '0', 10) || 5176;

// ── Paths ──
const USER_DATA_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'LinguaFlix')
  : path.join(os.homedir(), 'Library', 'Application Support', 'LinguaFlix');
const DOWNLOAD_DIR = process.platform === 'win32'
  ? path.join(os.homedir(), 'Videos', 'LinguaFlix')
  : path.join(os.homedir(), 'Movies', 'LinguaFlix');
const SCREENSHOTS_DIR = path.join(USER_DATA_DIR, 'screenshots');
const UPLOADS_DIR = path.join(USER_DATA_DIR, 'uploads');
const BIN_DIR = path.join(USER_DATA_DIR, 'bin');
// 自动剪辑生成的复习视频（#25）——放进下载目录的子文件夹，与普通下载区分。
const CLIPS_DIR = path.join(DOWNLOAD_DIR, 'clips');

// Ensure directories exist
[USER_DATA_DIR, DOWNLOAD_DIR, SCREENSHOTS_DIR, UPLOADS_DIR, BIN_DIR, CLIPS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── ffmpeg resolution (auto-clip) ──
let cachedFfmpegPath = null;

async function getFfmpegPath() {
  if (cachedFfmpegPath) return cachedFfmpegPath;
  // Packaged app ships ffmpeg/ffprobe in resources/ (see electron-builder.yml).
  const bundled = path.join(process.resourcesPath || '', 'ffmpeg.exe');
  if (bundled && fs.existsSync(bundled)) { cachedFfmpegPath = bundled; return bundled; }
  // `which` is macOS/Linux-only — Windows uses `where`.
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(whichCmd, ['ffmpeg'], { timeout: 5000 });
    const found = stdout.trim().split('\n')[0]?.trim();
    if (found && fs.existsSync(found)) { cachedFfmpegPath = found; return found; }
  } catch {}
  // Homebrew 默认安装位置兜底（macOS 上 which 可能因 PATH 异常而失败）。
  const alt = '/opt/homebrew/bin/ffmpeg';
  if (fs.existsSync(alt)) { cachedFfmpegPath = alt; return alt; }
  return null;
}

/**
 * 把渲染端传来的 filePath 还原为服务器可读的本地绝对路径。
 *   - blob:/data:  → 浏览器临时对象，服务器读不到 → null
 *   - https:/http: 远程直链 → 服务器读不到 → null（http://…/media/… 这种媒体服务器 URL 除外）
 *   - 绝对路径（Electron 打开本地文件） → 直接用
 *   - /media/… 或 http(s)://…/media/… （web 模式存储 URL） → 剥掉前缀 + decodeURIComponent
 * 始终防御路径穿越（'..' 拒绝）。
 */
function resolveLocalFilePath(p) {
  if (!p || typeof p !== 'string') return null;
  if (p.startsWith('blob:') || p.startsWith('data:')) return null;
  let abs = p;
  if (/^https?:\/\//.test(p)) {
    const m = p.match(/^https?:\/\/[^/]+(\/media\/.*)$/);
    if (!m) return null; // 远程直链（无 /media 前缀）→ 服务器不可读
    abs = m[1];
  }
  if (abs.startsWith('/media/')) {
    abs = abs.slice('/media'.length);
    try { abs = decodeURIComponent(abs); } catch {}
  }
  abs = normalizeLocalPath(abs);
  if (abs.split('/').includes('..')) return null;
  return abs;
}

/**
 * 把 /media URL 解码后的路径规范化为服务器可读的本地绝对路径。
 *
 * 渲染端 toMediaUrl 把本地路径逐段 encodeURIComponent 后拼成
 *   /media/<encoded path>
 * 例如 macOS: /media/Users/x/video.mp4 → /Users/x/video.mp4
 *      Windows: C:\Users\x\video.mp4 → /media/C%3A/Users/x/video.mp4 → /C:/Users/x/video.mp4
 *
 * Windows 上的坑：`/C:/Users/...` 不是有效绝对路径（path.resolve 会把它当成
 * `D:\C:\Users\...` 之类），fs.existsSync 永远 false → 视频 404。需要把
 * `/C:/...` 的盘符前导斜杠去掉，还原成 `C:/Users/...`（Node 在 Windows 上
 * 同时接受正斜杠）。
 */
function normalizeLocalPath(abs) {
  if (!abs) return abs;
  const m = abs.match(/^\/([a-zA-Z]):(\/|$)/);
  if (m) {
    return m[1] + ':' + m[2] + abs.slice(m[0].length);
  }
  if (!abs.startsWith('/')) return '/' + abs;
  return abs;
}

/** 带并发上限的异步 map（用于并行抽取片段）。 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Offline dictionary (ECDICT SQLite) ──
// Same bundled DB the Electron main process uses. Opened lazily (only on the
// first /api/dict/lookup call) so the web backend's startup stays instant.
let dictDb = null;
let dictDbFailed = false;

function getDictDb() {
  if (dictDb) return dictDb;
  if (dictDbFailed) return null;
  const dbPath = path.join(__dirname, '..', 'resources', 'ecdict.db');
  try {
    const { DatabaseSync } = require('node:sqlite');
    dictDb = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    dictDbFailed = true;
    dictDb = null;
  }
  return dictDb;
}

// Split an ECDICT translation/definition blob into per-POS senses. Lines look
// like "n. 猫, 恶妇" or "v. beat with a cat-o'-nine-tails". POS-less lines (e.g.
// an acronym's expanded form) become a POS-less sense; `[field]`-tagged lines
// (domain labels like [计]/[网络]) are dropped.
function parseEcdictSenses(text) {
  const groups = [];
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('[')) continue;
    const m = line.match(/^([A-Za-z]+\.)\s*(.+)$/);
    if (m && m[2]) {
      const pos = m[1];
      const last = groups[groups.length - 1];
      if (last && last.pos === pos) last.meanings.push(m[2]);
      else groups.push({ pos, meanings: [m[2]] });
    } else {
      groups.push({ meanings: [line] });
    }
  }
  return groups;
}

// Normalize 有道 (dict.youdao.com/jsonapi) into the same shape the renderer's
// ZhDictResult expects. Mirrors the Electron main process's normalizeZhDict so
// web mode gets identical 中英 results (音标/词性/释义/例句).
function normalizeZhDict(data, word) {
  const ecWord = data && data.ec && data.ec.word && data.ec.word[0];
  const phonetic = (ecWord && (ecWord.usphone || ecWord.ukphone)) || undefined;

  const translations = [];
  for (const trGroup of (ecWord && ecWord.trs) || []) {
    for (const tr of (trGroup && trGroup.tr) || []) {
      const meanings = ((tr && tr.l && tr.l.i) || []).map((s) => String(s));
      if (meanings.length) translations.push({ pos: tr && tr.pos, meanings });
    }
  }

  const examples = [];
  const pairs = (data && data.blng_sents_part && data.blng_sents_part['sentence-pair']) || [];
  for (const p of pairs.slice(0, 3)) {
    if (p && p.sentence && p['sentence-translation']) {
      examples.push({ en: p.sentence, zh: p['sentence-translation'] });
    }
  }

  // Fallback: web translations when no core meanings were extracted.
  if (!translations.length && data && data.web_trans && data.web_trans['web-translation']) {
    for (const wt of data.web_trans['web-translation']) {
      const meanings = ((wt && wt.trans) || []).map((t) => t && t.value).filter(Boolean);
      if (meanings.length) translations.push({ meanings });
    }
  }

  return { word, phonetic, translations, examples };
}

// ── yt-dlp Manager ──
const BINARY_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const GITHUB_DL_URL = process.platform === 'win32'
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

let cachedYtDlpPath = null;
let availabilityChecked = false;
let availabilityResult = false;

async function findInPath() {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(cmd, ['yt-dlp'], { timeout: 5000 });
    const found = stdout.trim().split('\n')[0]?.trim();
    if (found && fs.existsSync(found)) return found;
  } catch {}
  return null;
}

async function getYtDlpPath() {
  if (cachedYtDlpPath) return cachedYtDlpPath;

  const inPath = await findInPath();
  if (inPath) {
    cachedYtDlpPath = inPath;
    availabilityChecked = true;
    availabilityResult = true;
    return cachedYtDlpPath;
  }

  const downloadPath = path.join(BIN_DIR, BINARY_NAME);
  if (fs.existsSync(downloadPath)) {
    if (process.platform === 'win32') {
      try {
        const header = Buffer.alloc(2);
        const fd = fs.openSync(downloadPath, 'r');
        fs.readSync(fd, header, 0, 2, 0);
        fs.closeSync(fd);
        if (header[0] !== 0x4d || header[1] !== 0x5a) {
          fs.unlinkSync(downloadPath);
        } else {
          cachedYtDlpPath = downloadPath;
          availabilityChecked = true;
          availabilityResult = true;
          return cachedYtDlpPath;
        }
      } catch {
        try { fs.unlinkSync(downloadPath); } catch {}
      }
    } else {
      cachedYtDlpPath = downloadPath;
      availabilityChecked = true;
      availabilityResult = true;
      return cachedYtDlpPath;
    }
  }

  throw new Error('yt-dlp not found. Use /api/stream/download-ytdlp to install it.');
}

async function isYtDlpAvailable() {
  if (availabilityChecked) return availabilityResult;
  try {
    await getYtDlpPath();
    return true;
  } catch {
    availabilityChecked = true;
    availabilityResult = false;
    return false;
  }
}

function downloadBinaryOnce(onProgress) {
  const destPath = path.join(BIN_DIR, BINARY_NAME);
  return new Promise((resolve, reject) => {
    const request = https.get(GITHUB_DL_URL, { timeout: 120000 });
    request.on('response', (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          const redirectReq = https.get(redirectUrl, { timeout: 120000 });
          redirectReq.on('response', (redirectRes) => pipeDownload(redirectRes, destPath, onProgress, resolve, reject));
          redirectReq.on('error', reject);
          return;
        }
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }
      pipeDownload(response, destPath, onProgress, resolve, reject);
    });
    request.on('error', reject);
    request.setTimeout(120000, () => { request.destroy(); reject(new Error('Download timed out')); });
  });
}

async function downloadBinary(onProgress) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await downloadBinaryOnce(onProgress);
    } catch (err) {
      lastError = err;
      if (attempt === 3) break;
      const delayMs = attempt * 1500;
      console.warn(`yt-dlp install attempt ${attempt} failed (${err.message}) — retrying in ${delayMs}ms…`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function pipeDownload(response, destPath, onProgress, resolve, reject) {
  const totalBytesStr = response.headers['content-length'];
  const totalBytes = totalBytesStr ? parseInt(totalBytesStr, 10) : null;
  let downloadedBytes = 0;
  const fileStream = fs.createWriteStream(destPath);
  response.on('data', (chunk) => {
    downloadedBytes += chunk.length;
    if (onProgress && totalBytes) {
      onProgress({ percent: Math.round(downloadedBytes / totalBytes * 100), downloadedBytes, totalBytes });
    }
  });
  pipelineAsync(response, fileStream).then(() => {
    if (process.platform === 'win32') {
      const header = Buffer.alloc(2);
      try {
        const fd = fs.openSync(destPath, 'r');
        fs.readSync(fd, header, 0, 2, 0);
        fs.closeSync(fd);
      } catch (err) {
        try { fs.unlinkSync(destPath); } catch {}
        reject(new Error(`Downloaded yt-dlp.exe could not be validated: ${err.message}`));
        return;
      }
      if (header[0] !== 0x4d || header[1] !== 0x5a) {
        try { fs.unlinkSync(destPath); } catch {}
        reject(new Error('Downloaded yt-dlp file is not a valid Windows executable. Check the network or proxy response.'));
        return;
      }
    }
    if (process.platform !== 'win32') {
      try { fs.chmodSync(destPath, 0o755); } catch {}
    }
    cachedYtDlpPath = destPath;
    availabilityChecked = true;
    availabilityResult = true;
    resolve(destPath);
  }).catch(reject);
}

// ── Stream Resolver ──
const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map();

const PLATFORM_DOMAINS = new Set([
  'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
  'bilibili.com', 'www.bilibili.com', 'b23.tv',
  'vimeo.com', 'player.vimeo.com', 'dailymotion.com', 'www.dailymotion.com',
  'twitch.tv', 'www.twitch.tv', 'nicovideo.jp', 'www.nicovideo.jp',
  'ted.com', 'www.ted.com',
]);

const DIRECT_VIDEO_EXTENSIONS = new Set([
  'mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v', 'ogv', '3gp', '3g2', 'ts', 'm3u8', 'mpd',
]);

function isPlatformUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (PLATFORM_DOMAINS.has(host)) return true;
    if (host.endsWith('.youtube.com') || host.endsWith('.bilibili.com')) return true;
    if (host === 'b23.tv' || host === 'youtu.be') return true;
    return false;
  } catch { return false; }
}

function isDirectVideoUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const ext = u.pathname.split('.').pop();
    if (ext && DIRECT_VIDEO_EXTENSIONS.has(ext)) return true;
    if (urlStr.startsWith('data:video/') || urlStr.startsWith('blob:')) return true;
    return false;
  } catch {
    const ext = urlStr.split('.').pop()?.toLowerCase();
    return ext ? DIRECT_VIDEO_EXTENSIONS.has(ext) : false;
  }
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) { cache.delete(key); return null; }
  return entry.result;
}

function setCache(key, result) {
  if (cache.size >= 50) { const firstKey = cache.keys().next().value; if (firstKey) cache.delete(firstKey); }
  cache.set(key, { result, timestamp: Date.now() });
}

function selectBestFormat(formats) {
  if (!formats || formats.length === 0) return null;
  const combined = formats.find(f => f.url && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && f.protocol !== 'm3u8_native');
  if (combined) return combined;
  const video = formats.find(f => f.url && f.protocol !== 'm3u8_native');
  if (video) return video;
  return formats.find(f => f.url) || null;
}

const RESOLUTION_FORMAT = 'best[height<=720]/bestvideo[height<=720]+bestaudio/best';
const RESOLUTION_TIMEOUT = 20000;

async function resolveStreamUrl(urlStr, onProgress) {
  if (isDirectVideoUrl(urlStr)) {
    return { streamUrl: urlStr, title: urlStr.split('/').pop()?.split('?')[0] || 'Video', duration: 0, format: 'direct', headers: {}, resolved: false, originalUrl: urlStr };
  }
  if (!isPlatformUrl(urlStr)) {
    return { streamUrl: urlStr, title: urlStr.split('/').pop()?.split('?')[0] || 'Video', duration: 0, format: 'direct', headers: {}, resolved: false, originalUrl: urlStr };
  }

  const cached = getCached(urlStr);
  if (cached) return cached;

  const ytdlpPath = await getYtDlpPath();
  const args = ['--dump-json', '-f', RESOLUTION_FORMAT, '--no-playlist', '--no-check-formats', '--extractor-retries', '1', '--socket-timeout', '10', urlStr];

  try {
    const { stdout } = await execFileAsync(ytdlpPath, args, { timeout: RESOLUTION_TIMEOUT, maxBuffer: 5 * 1024 * 1024 });
    const info = JSON.parse(stdout.trim());
    const title = info.fulltitle || info.title || 'Unknown';
    const requestedFormats = info.requested_formats;

    if (requestedFormats && requestedFormats.length >= 2) {
      const videoFmt = requestedFormats.find(f => f.vcodec && f.vcodec !== 'none' && f.url);
      const audioFmt = requestedFormats.find(f => f.acodec && f.acodec !== 'none' && f.url);
      if (!videoFmt) throw new Error('No video stream found in multi-part format.');

      const headers = {};
      const fmtHeaders = videoFmt.http_headers || info.http_headers || {};
      for (const [k, v] of Object.entries(fmtHeaders)) headers[k.toLowerCase()] = String(v);
      if (!headers['user-agent']) headers['user-agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

      const height = videoFmt.height ? `${videoFmt.height}p` : '';
      const formatLabel = height || 'video-only';

      if (audioFmt?.url) {
        headers['x-audio-url'] = audioFmt.url;
        if (audioFmt.http_headers) {
          for (const [k, v] of Object.entries(audioFmt.http_headers)) {
            const key = `x-audio-${k.toLowerCase()}`;
            if (!headers[key]) headers[key] = String(v);
          }
        }
      }

      const result = { streamUrl: videoFmt.url, title, duration: Math.round(info.duration || 0), format: formatLabel || 'unknown', headers, resolved: true, originalUrl: urlStr };
      setCache(urlStr, result);
      return result;
    }

    let streamUrl = info.url;
    let formatLabel = info.format || '';
    if (!streamUrl) {
      const bestFormat = selectBestFormat(info.formats || []);
      if (!bestFormat || !bestFormat.url) throw new Error('No playable stream found.');
      streamUrl = bestFormat.url;
      formatLabel = bestFormat.format_note || (bestFormat.height ? `${bestFormat.height}p` : '') + (bestFormat.ext ? ` ${bestFormat.ext}` : '') || formatLabel;
    }

    const headers = {};
    const fmtHeaders = info.http_headers || {};
    for (const [k, v] of Object.entries(fmtHeaders)) headers[k.toLowerCase()] = String(v);
    if (!headers['user-agent']) headers['user-agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    const result = { streamUrl, title, duration: Math.round(info.duration || 0), format: formatLabel || 'unknown', headers, resolved: true, originalUrl: urlStr };
    setCache(urlStr, result);
    return result;
  } catch (err) {
    if (err.killed && err.signal === 'SIGTERM') throw new Error('Resolution timed out.');
    if (err.stderr) {
      const stderr = String(err.stderr);
      if (stderr.includes('HTTP Error 403')) throw new Error('Access denied by the platform.');
      if (stderr.includes('Video unavailable') || stderr.includes('This video is not available')) throw new Error('This video is not available (private, deleted, or geo-restricted).');
      if (stderr.includes('which is not a valid URL')) throw new Error('The provided URL is not recognized as a supported video link.');
    }
    throw new Error(err.message || 'Failed to resolve video URL.');
  }
}

// ── Download ──
// The yt-dlp download logic (H.264/AAC format forcing, --force-ipv4, retries,
// stderr capture, codec probe) lives in shared/downloader.cjs — the SAME module
// the Electron main process uses. Edit there, not here.
async function downloadVideo(urlStr, onProgress) {
  const ytdlpPath = await getYtDlpPath();
  // If ffmpeg was found via `where`/`which`, pass its directory to yt-dlp so
  // DASH video+audio merging works even when ffmpeg is not on PATH. ffprobe
  // (codec probe) lives in the same bin dir.
  const ffmpegExe = await getFfmpegPath().catch(() => null);
  const ffmpegLocation = ffmpegExe ? path.dirname(ffmpegExe) : undefined;
  const result = await downloadVideoWithYtdlp({
    ytdlpPath,
    downloadDir: DOWNLOAD_DIR,
    url: urlStr,
    onProgress,
    ffmpegLocation,
  });
  return { success: true, ...result };
}

// ── Media Server ──
function getContentType(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const mimeTypes = {
    mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    mov: 'video/quicktime', flv: 'video/x-flv', wmv: 'video/x-ms-wmv', m4v: 'video/mp4',
    ogv: 'video/ogg', ts: 'video/mp2t', m3u8: 'application/x-mpegURL', mpd: 'application/dash+xml',
    vtt: 'text/vtt', srt: 'text/plain', mp3: 'audio/mpeg', aac: 'audio/aac', ogg: 'audio/ogg',
    wav: 'audio/wav', flac: 'audio/flac', opus: 'audio/opus',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// ── Download Task Tracker (in-memory, for SSE progress) ──
const downloadTasks = new Map();

function createTask() {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const task = { id, progress: { percent: 0, speed: '', eta: '', status: 'starting' }, result: null, error: null, updatedAt: Date.now() };
  downloadTasks.set(id, task);
  // Bounded cleanup: evict only terminal tasks (10 min grace after completion), or
  // tasks that have stalled with no progress for 30 min. A slow download that is
  // still making progress is never evicted, so the client's progress wait is never orphaned.
  const cleanup = () => setTimeout(() => {
    if (task.result || task.error) {
      downloadTasks.delete(id);
    } else if (Date.now() - task.updatedAt > 30 * 60 * 1000) {
      downloadTasks.delete(id);
    } else {
      cleanup();
    }
  }, 600000);
  cleanup();
  return task;
}

// ── HTTP Router ──
function corsHeaders(req) {
  // Only allow same-machine origins (the Vite dev server). Reflecting an arbitrary
  // Origin together with Allow-Credentials would let any website read local files
  // through this server via the user's browser.
  const origin = req.headers.origin || '';
  const isLocal = !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
  const allowed = isLocal ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...(allowed ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
  };
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve(Buffer.concat(chunks).toString()); }
    });
    req.on('error', reject);
  });
}

async function handleRequest(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = parsedUrl.pathname;

  // Light request log for diagnosability
  const mediaPrefix = pathname.startsWith('/media/') ? pathname.slice(0, 80) + (pathname.length > 80 ? '…' : '') : pathname;
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${req.method} ${mediaPrefix}`);

  // Add CORS to all responses
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = function(code, headers) {
    return origWriteHead(code, { ...headers, ...corsHeaders(req) });
  };

  try {
    // ── Media streaming: /media/* ──
    if (req.method === 'GET' && pathname.startsWith('/media/')) {
      // decodeURIComponent pairs with the client's per-segment encodeURIComponent in
      // toMediaUrl, so filenames with '#', '?', '%', spaces or non-ASCII round-trip.
      let filePath = decodeURIComponent(pathname.replace(/^\/media/, ''));
      // Windows: `/C:/Users/...` is not a valid absolute path — and path.join('/',
      // 'C:/...') would produce '\C:\...' which is ALSO invalid. Strip the leading
      // slash in front of the drive letter and use the drive path as-is, so
      // `C:/Users/...` resolves on Windows while macOS `/Users/...` stays untouched.
      const driveMatch = filePath.match(/^\/([a-zA-Z]):(\/|$)/);
      const isDrivePath = !!driveMatch;
      if (driveMatch) {
        filePath = driveMatch[1] + ':' + driveMatch[2] + filePath.slice(driveMatch[0].length);
      }
      const absPath = isDrivePath ? filePath : (filePath.startsWith('/') ? filePath : path.join('/', filePath));

      // Reject path traversal ('..' anywhere in the decoded path)
      if (absPath.split('/').includes('..')) {
        jsonResponse(res, 403, { error: 'Forbidden' });
        return;
      }

      if (!fs.existsSync(absPath)) {
        jsonResponse(res, 404, { error: 'File not found' });
        return;
      }

      const stats = fs.statSync(absPath);
      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          ...corsHeaders(req),
          'Content-Type': getContentType(absPath),
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(absPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          ...corsHeaders(req),
          'Content-Type': getContentType(absPath),
          'Content-Length': String(stats.size),
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(absPath).pipe(res);
      }
      return;
    }

    // ── API: upload local video (web mode persistence) ──
    // The renderer POSTs the raw file bytes as the request body (File as the fetch
    // body), and the original name via ?name=. We stream it straight to disk under
    // the persistent uploads dir and hand back the absolute path so the client can
    // build a same-origin /media/... URL that survives page reloads (blob: URLs do
    // not). A UUID suffix keeps repeated imports of the same filename collision-free.
    if (req.method === 'POST' && pathname === '/api/upload/video') {
      const rawName = parsedUrl.searchParams.get('name') || 'video.mp4'
      const safeName = (path.basename(rawName) || 'video.mp4').replace(/[^\w.\- ]/g, '_').slice(0, 100)
      const ext = path.extname(safeName) || '.mp4'
      const base = path.basename(safeName, ext) || 'video'
      const storedName = `${base}-${crypto.randomUUID()}${ext}`
      const filePath = path.join(UPLOADS_DIR, storedName)
      try {
        await pipelineAsync(req, fs.createWriteStream(filePath))
        jsonResponse(res, 200, { filePath, fileName: safeName })
      } catch (err) {
        fs.rmSync(filePath, { force: true })
        console.error('[upload] failed:', err.message)
        jsonResponse(res, 500, { error: 'Upload failed' })
      }
      return;
    }

    // ── API: stream:resolve ──
    if (req.method === 'POST' && pathname === '/api/stream/resolve') {
      const body = await readBody(req);
      const result = await resolveStreamUrl(body.url);
      jsonResponse(res, 200, result);
      return;
    }

    // ── API: stream:checkYtDlp ──
    if (req.method === 'GET' && pathname === '/api/stream/check-ytdlp') {
      const available = await isYtDlpAvailable();
      let ytdlpPath = null;
      if (available) {
        try { ytdlpPath = await getYtDlpPath(); } catch {}
      }
      jsonResponse(res, 200, { available, path: ytdlpPath });
      return;
    }

    // ── API: stream:downloadYtDlp ──
    if (req.method === 'POST' && pathname === '/api/stream/download-ytdlp') {
      try {
        const result = await downloadBinary(progress => {
          // For now, progress is not streamed over HTTP
        });
        jsonResponse(res, 200, { success: true, path: result });
      } catch (err) {
        jsonResponse(res, 500, { success: false, error: err.message });
      }
      return;
    }

    // ── API: stream:download ──
    if (req.method === 'POST' && pathname === '/api/stream/download') {
      const body = await readBody(req);

      // Only accept http(s) URLs — blocks file:// and other schemes from being fed
      // to yt-dlp (which would otherwise allow arbitrary local file access).
      let parsedUrl;
      try { parsedUrl = new URL(body.url); } catch { jsonResponse(res, 400, { error: 'Invalid URL' }); return; }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        jsonResponse(res, 400, { error: 'Unsupported URL protocol' });
        return;
      }

      const task = createTask();
      jsonResponse(res, 200, { taskId: task.id });

      // Run download in background, updating task progress
      try {
        const result = await downloadVideo(body.url, progress => {
          task.progress = progress;
          task.updatedAt = Date.now();
        });
        task.result = result;
        task.progress = { percent: 100, speed: '', eta: '', status: 'complete', outputPath: result.filePath };
      } catch (err) {
        task.error = err.message;
        task.progress = { percent: task.progress.percent, speed: '', eta: '', status: 'error' };
      }
      return;
    }

    // ── Progress: stream:download progress ──
    // Two modes:
    //   ?once=1   → one-shot JSON poll (returns current state and closes) — used by the renderer
    //   (default) → SSE stream that pushes updates until the task is terminal
    if (req.method === 'GET' && pathname === '/api/stream/download/progress') {
      const taskId = parsedUrl.searchParams.get('taskId');
      if (!taskId) {
        jsonResponse(res, 400, { error: 'Missing taskId parameter' });
        return;
      }

      const task = downloadTasks.get(taskId);
      if (!task) {
        if (parsedUrl.searchParams.get('once') === '1') {
          jsonResponse(res, 404, { error: 'Task not found' });
        } else {
          res.writeHead(200, {
            ...corsHeaders(req),
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          res.write(`data: ${JSON.stringify({ error: 'Task not found' })}\n\n`);
          res.end();
        }
        return;
      }

      // One-shot poll mode: current state as plain JSON, then close.
      if (parsedUrl.searchParams.get('once') === '1') {
        if (task.result) jsonResponse(res, 200, { ...task.progress, result: task.result });
        else if (task.error) jsonResponse(res, 200, { status: 'error', error: task.error });
        else jsonResponse(res, 200, task.progress);
        return;
      }

      res.writeHead(200, {
        ...corsHeaders(req),
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Send current progress immediately
      res.write(`data: ${JSON.stringify(task.progress)}\n\n`);

      // If task is already done, close
      if (task.result || task.error) {
        if (task.result) {
          res.write(`data: ${JSON.stringify({ ...task.progress, result: task.result })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ status: 'error', error: task.error })}\n\n`);
        }
        res.end();
        return;
      }

      // Poll for updates
      const interval = setInterval(() => {
        const t = downloadTasks.get(taskId);
        if (!t || t.result || t.error) {
          clearInterval(interval);
          if (t?.result) {
            res.write(`data: ${JSON.stringify({ ...t.progress, result: t.result })}\n\n`);
          } else if (t?.error) {
            res.write(`data: ${JSON.stringify({ status: 'error', error: t.error })}\n\n`);
          }
          res.end();
          return;
        }
        res.write(`data: ${JSON.stringify(t.progress)}\n\n`);
      }, 500);

      // Clean up on disconnect
      req.on('close', () => {
        clearInterval(interval);
        // Keep task in map for reconnection
      });

      return;
    }

    // ── API: stream:getMediaBaseUrl ──
    if (req.method === 'GET' && pathname === '/api/stream/media-base-url') {
      jsonResponse(res, 200, { url: `http://127.0.0.1:${PORT}/media` });
      return;
    }

    // ── API: review-clip 自动剪辑（#25）──
    // 看完整片后，把每个生词 [t-2s, t+2s] 的片段抽出来拼成一个复习视频。
    // 采用研究验证过的可靠方案：每段 `-ss 在 -i 之前 + 重编码`（帧级精确，绝不 -c copy
    // 抽任意时间戳——关键帧不准），全部抽完后用 concat demuxer `-c copy` 无损合并。
    if (req.method === 'POST' && pathname === '/api/review-clip') {
      const body = await readBody(req);
      const { sourcePath, duration, segments } = (body && typeof body === 'object') ? body : {};
      if (!sourcePath || !Array.isArray(segments) || segments.length === 0) {
        jsonResponse(res, 400, { error: 'Missing sourcePath/segments' });
        return;
      }

      const inputPath = resolveLocalFilePath(sourcePath);
      if (!inputPath || !fs.existsSync(inputPath)) {
        jsonResponse(res, 422, { error: 'no_local_file' });
        return;
      }
      const ffmpeg = await getFfmpegPath();
      if (!ffmpeg) {
        jsonResponse(res, 500, { error: 'ffmpeg_not_found' });
        return;
      }

      const totalDuration = (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) ? duration : 0;

      // 1) 计算每个生词的窗口 [t-2, t+2]，夹到 [0, duration]；非法的 t 丢弃。
      const MARGIN = 2;
      const windows = [];
      for (const seg of segments) {
        const t = Number(seg && seg.t);
        if (!Number.isFinite(t) || t < 0) continue;
        const start = Math.max(0, t - MARGIN);
        const end = totalDuration > 0 ? Math.min(totalDuration, t + MARGIN) : t + MARGIN;
        if (end <= start) continue;
        windows.push({ start, end });
      }
      if (windows.length === 0) {
        jsonResponse(res, 422, { error: 'no_clippable_segments' });
        return;
      }

      // 2) 排序 + 合并重叠/相邻窗口（同一场景多次存词只剪一次）。
      windows.sort((a, b) => a.start - b.start);
      const merged = [];
      for (const w of windows) {
        const last = merged[merged.length - 1];
        if (last && w.start <= last.end + 0.05) last.end = Math.max(last.end, w.end);
        else merged.push({ start: w.start, end: w.end });
      }

      // 3) 并行抽取片段（重编码，并发 2 防吃满 CPU）→ concat demuxer 合并。
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linguaflix-clip-'));
      const segFiles = new Array(merged.length);
      try {
        await mapLimit(merged, 2, async (w, i) => {
          const out = path.join(workDir, `seg_${String(i).padStart(3, '0')}.mp4`);
          // `-map 0:v:0 -map 0:a:0?` 让无声源也能抽（音频可选），各段参数一致保证可 concat。
          const args = [
            '-y',
            '-ss', String(w.start), '-i', inputPath,
            '-t', String(w.end - w.start),
            '-map', '0:v:0', '-map', '0:a:0?',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
            '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
            '-avoid_negative_ts', 'make_zero',
            out,
          ];
          await execFileAsync(ffmpeg, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
          segFiles[i] = out;
        });
        if (segFiles.length === 0) {
          jsonResponse(res, 500, { error: 'extraction_failed' });
          return;
        }

        const listPath = path.join(workDir, 'list.txt');
        fs.writeFileSync(listPath, segFiles.map((f) => `file '${f.replace(/'/g, `'\\''`)}'`).join('\n'));
        const outPath = path.join(CLIPS_DIR, `review_${Date.now()}.mp4`);
        await execFileAsync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outPath], { timeout: 180000, maxBuffer: 10 * 1024 * 1024 });

        const clipSegments = merged.map((w, i) => {
          const clipStart = merged.slice(0, i).reduce((sum, prior) => sum + (prior.end - prior.start), 0);
          return {
            sourceStart: w.start,
            sourceEnd: w.end,
            clipStart,
            clipEnd: clipStart + (w.end - w.start),
          };
        });
        const clipDuration = merged.reduce((sum, w) => sum + (w.end - w.start), 0);
        jsonResponse(res, 200, {
          filePath: outPath,
          fileName: path.basename(outPath),
          duration: Math.round(clipDuration),
          clipCount: merged.length,
          segments: clipSegments,
        });
      } catch (err) {
        console.error('[review-clip] failed:', err && err.message);
        jsonResponse(res, 500, { error: (err && err.message) || 'Clip generation failed' });
      } finally {
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
      }
      return;
    }

    // ── API: review-clip delete（#10 覆盖旧剪辑：删除磁盘上的旧复习视频）──
    // 只接受 basename（review_*.mp4），防路径穿越；文件必须落在 CLIPS_DIR 内。
    if (req.method === 'DELETE' && pathname === '/api/review-clip') {
      const raw = parsedUrl.searchParams.get('file') || '';
      const safe = path.basename(raw);
      if (!safe || !/^review_.+\.mp4$/.test(safe)) {
        jsonResponse(res, 400, { error: 'Invalid clip file' });
        return;
      }
      const target = path.join(CLIPS_DIR, safe);
      if (target !== path.resolve(target)) {
        jsonResponse(res, 403, { error: 'Forbidden' });
        return;
      }
      try {
        fs.rmSync(target, { force: true });
        jsonResponse(res, 200, { ok: true });
      } catch (err) {
        jsonResponse(res, 500, { error: (err && err.message) || 'Delete failed' });
      }
      return;
    }

    // ── API: screenshot:save ──
    if (req.method === 'POST' && pathname === '/api/screenshot/save') {
      const body = await readBody(req);
      const { dataUrl, timestamp } = body;
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      const fileName = `snapshot_${Math.floor(timestamp || Date.now() / 1000)}s_${Date.now()}.png`;
      const filePath = path.join(SCREENSHOTS_DIR, fileName);
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      jsonResponse(res, 200, { filePath, fileName });
      return;
    }

    // ── API: screenshot:read (web-mode read-back of a saved PNG) ──
    // Takes the basename only (path traversal is defended against); returns the
    // file as a data URL so the renderer can restore full-res images after reload.
    if (req.method === 'GET' && pathname === '/api/screenshot/read') {
      const raw = parsedUrl.searchParams.get('file') || '';
      const safe = path.basename(raw);
      if (!safe || !/^snapshot_.+\.png$/.test(safe)) {
        jsonResponse(res, 400, { error: 'bad_file' });
        return;
      }
      try {
        const data = fs.readFileSync(path.join(SCREENSHOTS_DIR, safe));
        jsonResponse(res, 200, { dataUrl: `data:image/png;base64,${data.toString('base64')}` });
      } catch {
        jsonResponse(res, 404, { error: 'not_found' });
      }
      return;
    }

    // ── API: screenshot:delete (web-mode delete of a saved PNG) ──
    // Takes the basename only (path traversal is defended against). Used by #1/#10
    // deletion cascade to free disk space when a snapshot's screenshot becomes orphaned.
    if (req.method === 'DELETE' && pathname === '/api/screenshot/delete') {
      const raw = parsedUrl.searchParams.get('file') || '';
      const safe = path.basename(raw);
      if (!safe || !/^snapshot_.+\.png$/.test(safe)) {
        jsonResponse(res, 400, { error: 'bad_file' });
        return;
      }
      try {
        fs.unlinkSync(path.join(SCREENSHOTS_DIR, safe));
        jsonResponse(res, 200, { ok: true });
      } catch {
        jsonResponse(res, 404, { error: 'not_found' });
      }
      return;
    }

    // ── API: AI 词汇分析流式代理 ──
    // Browsers can't call OpenAI/Anthropic directly (third-party CORS), so the
    // backend proxies the stream: it forwards the upstream SSE response byte-for-byte.
    // Node is not subject to the browser same-origin policy.
    if (req.method === 'POST' && pathname === '/api/ai/stream') {
      const body = await readBody(req);
      const { type, baseUrl, apiKey, model, prompt } = (body && typeof body === 'object') ? body : {};
      if (!type || !baseUrl || !apiKey || !model || !prompt) {
        jsonResponse(res, 400, { error: 'Missing AI params (type/baseUrl/apiKey/model/prompt)' });
        return;
      }
      const isAnthropic = type === 'anthropic';
      const base = baseUrl.replace(/\/+$/, '');
      const upstreamUrl = isAnthropic ? `${base}/messages` : `${base}/chat/completions`;
      const upstreamHeaders = isAnthropic
        ? { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      const upstreamBody = isAnthropic
        ? JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: prompt }], stream: true })
        : JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: true, max_tokens: 600, temperature: 0.7 });

      let upstream;
      try {
        upstream = await fetch(upstreamUrl, { method: 'POST', headers: upstreamHeaders, body: upstreamBody });
      } catch (err) {
        jsonResponse(res, 502, { error: 'Upstream unreachable: ' + (err.message || '') });
        return;
      }

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => '');
        jsonResponse(res, upstream.status, { error: errText || `Upstream ${upstream.status}` });
        return;
      }

      res.writeHead(200, {
        ...corsHeaders(req),
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      try {
        for await (const chunk of upstream.body) {
          res.write(chunk);
        }
      } catch {
        // client aborted mid-stream — drop silently
      }
      res.end();
      return;
    }

    // ── API: dictionary lookup (offline ECDICT) ──
    // Mirrors the Electron main process's dict:lookupLocal shape: returns
    // { data: { word, phonetic, zh, en } } on a hit, else { error }.
    if (req.method === 'GET' && pathname === '/api/dict/lookup') {
      const word = parsedUrl.searchParams.get('word') || '';
      const db = getDictDb();
      if (!db) { jsonResponse(res, 200, { error: 'no_db' }); return; }
      const key = word.trim().toLowerCase();
      if (!key) { jsonResponse(res, 200, { error: 'No word provided' }); return; }
      try {
        const row = db.prepare('SELECT word, phonetic, translation, definition FROM entries WHERE key = ?').get(key);
        if (!row) { jsonResponse(res, 200, { error: 'not_found' }); return; }
        const entry = {
          word: row.word || word,
          phonetic: row.phonetic || undefined,
          zh: parseEcdictSenses(row.translation || ''),
          en: parseEcdictSenses(row.definition || ''),
        };
        if (!entry.zh.length && !entry.en.length) { jsonResponse(res, 200, { error: 'not_found' }); return; }
        jsonResponse(res, 200, { data: entry });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message || 'Lookup failed' });
      }
      return;
    }

    // ── API: Chinese-English dictionary (有道 proxy) ──
    // dict.youdao.com does not send CORS headers, so the renderer can't fetch it
    // directly; the backend proxies it (Node is not subject to the browser SOP).
    // Mirrors Electron's dict:lookupZh so web mode gets rich 中英 (音标/例句).
    if (req.method === 'GET' && pathname === '/api/dict/zh') {
      const word = parsedUrl.searchParams.get('word') || '';
      if (!word) { jsonResponse(res, 200, { error: 'No word provided' }); return; }
      try {
        const r = await fetch(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`);
        if (!r.ok) { jsonResponse(res, 200, { error: `HTTP ${r.status}` }); return; }
        const data = await r.json();
        jsonResponse(res, 200, { data: normalizeZhDict(data, word) });
      } catch (err) {
        jsonResponse(res, 200, { error: err.message || 'Lookup failed' });
      }
      return;
    }

    // ── API: English-English dictionary (dictionaryapi.dev proxy) ──
    // dictionaryapi.dev's CORS header is intermittent, so proxy it here (Node
    // is not subject to the browser SOP). Mirrors Electron's dict:lookupEn.
    if (req.method === 'GET' && pathname === '/api/dict/en') {
      const word = parsedUrl.searchParams.get('word') || '';
      if (!word) { jsonResponse(res, 200, { error: 'No word provided' }); return; }
      try {
        const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
        if (!r.ok) { jsonResponse(res, 200, { error: 'not_found' }); return; }
        const arr = await r.json();
        const data = Array.isArray(arr) && arr[0] ? arr[0] : null;
        jsonResponse(res, 200, data ? { data } : { error: 'not_found' });
      } catch (err) {
        jsonResponse(res, 200, { error: err.message || 'Lookup failed' });
      }
      return;
    }

    // ── Health check ──
    if (req.method === 'GET' && pathname === '/api/health') {
      jsonResponse(res, 200, { status: 'ok', port: PORT });
      return;
    }

    // ── 404 ──
    jsonResponse(res, 404, { error: `Not found: ${pathname}` });
  } catch (err) {
    console.error('Server error:', err);
    jsonResponse(res, 500, { error: err.message || 'Internal server error' });
  }
}

// ── Start Server ──
const server = http.createServer(handleRequest);

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  const actualPort = addr?.port || PORT;
  console.log(`\n🦊 LinguaFlix Backend Server`);
  console.log(`   Media:  http://127.0.0.1:${actualPort}/media`);
  console.log(`   API:    http://127.0.0.1:${actualPort}/api`);
  console.log(`   Health: http://127.0.0.1:${actualPort}/api/health\n`);

  // Write port to a file so the frontend can discover it
  fs.writeFileSync(path.join(__dirname, '.port'), String(actualPort));
});
