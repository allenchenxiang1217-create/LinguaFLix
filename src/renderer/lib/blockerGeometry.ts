import type { BlockerConfig } from '@shared/types'

/**
 * 字幕挡块坐标换算（全屏同步）。
 *
 * 挡块持久化的是「容器百分比」；但烧录字幕固定在「视频画面」里。非全屏用
 * object-contain（留黑边），全屏用 object-cover（裁切），两者对视频画面的
 * 缩放/位移不同——同一个容器百分比，在不同几何下罩住的画面位置不一样。
 * 这里提供「容器百分比 ↔ 视频画面百分比」的换算，让挡块在几何变化（全屏/缩放）
 * 后仍罩住同一块画面。
 */

export type ObjectFit = 'contain' | 'cover'

export interface VideoGeometry {
  /** 容器（挡块定位父元素）宽高 px */
  containerW: number
  containerH: number
  /** 视频原始分辨率 */
  videoW: number
  videoH: number
  fit: ObjectFit
}

/** 视频画面（object-fit 后）在容器内的实际矩形。 */
export function contentRect(g: VideoGeometry): { x: number; y: number; w: number; h: number } {
  const { containerW: W, containerH: H, videoW: vw, videoH: vh, fit } = g
  const scale = fit === 'contain' ? Math.min(W / vw, H / vh) : Math.max(W / vw, H / vh)
  const w = vw * scale
  const h = vh * scale
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** 容器百分比 → 视频画面百分比（0-100）。 */
export function toContent(config: BlockerConfig, g: VideoGeometry): BlockerConfig {
  const { x: cx, y: cy, w: cw, h: ch } = contentRect(g)
  if (cw <= 0 || ch <= 0) return { ...config }
  const x = (config.xPercent / 100) * g.containerW
  const y = (config.yPercent / 100) * g.containerH
  const w = (config.widthPercent / 100) * g.containerW
  const h = (config.heightPercent / 100) * g.containerH
  return {
    xPercent: ((x - cx) / cw) * 100,
    yPercent: ((y - cy) / ch) * 100,
    widthPercent: (w / cw) * 100,
    heightPercent: (h / ch) * 100,
  }
}

/** 视频画面百分比（0-100）→ 容器百分比。 */
export function fromContent(content: BlockerConfig, g: VideoGeometry): BlockerConfig {
  const { x: cx, y: cy, w: cw, h: ch } = contentRect(g)
  const x = (content.xPercent / 100) * cw + cx
  const y = (content.yPercent / 100) * ch + cy
  const w = (content.widthPercent / 100) * cw
  const h = (content.heightPercent / 100) * ch
  return {
    xPercent: clamp((x / g.containerW) * 100, 0, 100),
    yPercent: clamp((y / g.containerH) * 100, 0, 100),
    widthPercent: clamp((w / g.containerW) * 100, 0, 100),
    heightPercent: clamp((h / g.containerH) * 100, 0, 100),
  }
}

/** 从一个几何换算到另一个几何（保持视频画面位置不变）。 */
export function transformConfig(
  config: BlockerConfig,
  from: VideoGeometry,
  to: VideoGeometry,
): BlockerConfig {
  return fromContent(toContent(config, from), to)
}
