import { formatTime } from '../lib/time'

interface CaptureResult {
  dataUrl: string
  thumbnailDataUrl: string
  filePath: string
}

/**
 * Capture the raw current frame of a video element — no watermark, no subtitle
 * text overlay. Used for the "set OCR region" flow so the user picks a clean
 * frame to draw the subtitle box on.
 */
export function captureFrame(videoEl: HTMLVideoElement): string | null {
  const vw = videoEl.videoWidth
  const vh = videoEl.videoHeight
  if (vw === 0 || vh === 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = vw
  canvas.height = vh
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(videoEl, 0, 0, vw, vh)
  return canvas.toDataURL('image/png', 0.85)
}

/**
 * Capture a dashboard cover from the video's current frame.
 * Keep enough source pixels for the larger library cards while bounding the
 * data URL size for local metadata storage.
 */
export function captureVideoThumbnail(videoEl: HTMLVideoElement): string | null {
  const vw = videoEl.videoWidth
  const vh = videoEl.videoHeight
  if (vw === 0 || vh === 0) return null

  const thumbWidth = 640
  const thumbHeight = Math.max(1, Math.round((vh / vw) * thumbWidth))
  const canvas = document.createElement('canvas')
  canvas.width = thumbWidth
  canvas.height = thumbHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(videoEl, 0, 0, thumbWidth, thumbHeight)
  return canvas.toDataURL('image/jpeg', 0.78)
}

/**
 * Capture a screenshot from a video element.
 *
 * Key insight: Canvas drawImage() captures the raw video frame pixels.
 * DOM overlays (blocker div, subtitle text divs) are NOT included.
 * So we don't need to hide the blocker — the screenshot naturally has the full frame.
 */
export async function captureScreenshot(
  videoEl: HTMLVideoElement,
  currentTime: number,
  subtitleText: string,
): Promise<CaptureResult | null> {
  const vw = videoEl.videoWidth
  const vh = videoEl.videoHeight

  if (vw === 0 || vh === 0) return null

  // Create offscreen canvas for full-res capture
  const canvas = document.createElement('canvas')
  canvas.width = vw
  canvas.height = vh
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // 1. Draw the video frame (this captures the raw pixels, NOT DOM overlays!)
  ctx.drawImage(videoEl, 0, 0, vw, vh)

  // 2. Draw subtitle text onto the canvas so visible in screenshot
  if (subtitleText) {
    drawSubtitleText(ctx, subtitleText, vw, vh)
  }

  // 3. Draw timestamp watermark
  drawTimestamp(ctx, currentTime, vw, vh)

  // 4. Generate thumbnail (320px wide, maintaining aspect ratio)
  const thumbCanvas = document.createElement('canvas')
  const thumbWidth = 320
  const thumbHeight = Math.round((vh / vw) * thumbWidth)
  thumbCanvas.width = thumbWidth
  thumbCanvas.height = thumbHeight
  const thumbCtx = thumbCanvas.getContext('2d')
  if (thumbCtx) {
    thumbCtx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight)
  }

  const dataUrl = canvas.toDataURL('image/png', 0.85)
  const thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.6)

  // 5. Save via IPC (Electron) or HTTP API (web)
  const { electronAPI } = window as any
  let filePath = ''
  if (electronAPI?.saveScreenshot) {
    try {
      const result = await electronAPI.saveScreenshot(dataUrl, currentTime)
      filePath = result.filePath
    } catch {
      filePath = 'local://screenshot_' + Date.now()
    }
  } else {
    // Web mode: save via the same-origin /api proxy (dev Vite proxy, the static
    // harness proxy, or a prod reverse proxy all forward /api/* to the backend).
    // No hardcoded host/port, so it keeps working behind any proxy or deployment.
    try {
      const res = await fetch('/api/screenshot/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, timestamp: currentTime }),
      })
      if (res.ok) {
        const result = await res.json()
        filePath = result.filePath
      } else {
        filePath = 'memory://screenshot_' + Date.now()
      }
    } catch {
      filePath = 'memory://screenshot_' + Date.now()
    }
  }

  return { dataUrl, thumbnailDataUrl, filePath }
}

function drawTimestamp(
  ctx: CanvasRenderingContext2D,
  seconds: number,
  width: number,
  height: number,
): void {
  const text = formatTime(seconds)
  const fontSize = Math.max(16, Math.round(width / 60))
  ctx.save()
  ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", sans-serif`
  ctx.textBaseline = 'bottom'

  // Shadow for readability
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 2

  ctx.fillStyle = '#ffffff'
  const padding = Math.round(width / 80)
  ctx.fillText(text, padding, height - padding)
  ctx.restore()
}

function drawSubtitleText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
): void {
  const fontSize = Math.max(14, Math.round(width / 55))
  const lineHeight = fontSize * 1.5
  const lines = text.split('\n')

  ctx.save()
  ctx.font = `${fontSize}px -apple-system, "Segoe UI", sans-serif`
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'center'

  // Background box for readability
  const maxLineWidth = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const boxWidth = Math.min(maxLineWidth + 40, width - 20)
  const boxHeight = lines.length * lineHeight + 16
  const boxX = width / 2 - boxWidth / 2
  const boxY = height - boxHeight - 40

  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.beginPath()
  const radius = 8
  drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, radius)
  ctx.fill()

  // Text
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = 2

  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, boxY + boxHeight - 8 - (lines.length - 1 - i) * lineHeight)
  })

  ctx.restore()
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}
