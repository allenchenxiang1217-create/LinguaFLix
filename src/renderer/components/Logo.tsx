import { useId } from 'react'
import type { CSSProperties, HTMLAttributes, SVGAttributes } from 'react'

/**
 * LinguaFlix 品牌标识组件（可直接替换原有 logo 文件）
 * ========================================================
 * 视觉源：桌面「logo设计」文件夹三份 SVG ——
 *   applogo.svg   主 logo：白底圆角方 + 紫色渐变播放键 + 黑进度条
 *   黑底logo.svg  暗色模式：纯白（用于黑/深色背景）
 *   白底logo.svg  亮色模式：纯黑 + 描边圆角方（用于白/浅色背景）
 *
 * 设计规范（Apple 风）：
 *   - 圆角方 rx = 221 / 1024 ≈ 21.6%
 *   - 品牌紫渐变 #A259FF → #613599（对角，userSpaceOnUse）
 *   - 图标 = 播放键（右指三角，圆角）+ 底部两条「进度条」胶囊
 *
 * 接入方式（详见 README.md）：
 *   侧栏/顶栏左上角（currentColor 自动适配暗/亮模式，无需判断主题）：
 *     <LogoMark size={22} className="text-foreground" />
 *   应用图标 / 关于页 / 引导页（三态显式指定）：
 *     <AppLogo variant="color" size={64} />
 *     <AppLogo variant="dark"  size={64} />   // 深色背景
 *     <AppLogo variant="light" size={64} />   // 浅色背景
 */

// ── 几何（原始 1024 坐标；mark 的 viewBox 裁剪到紧贴内容，不包含圆角方背景） ──

/** 播放键（右指圆角三角）。 */
const PLAY_PATH =
  'M699.126 402.1' +
  'C710.315 408.06 715.91 411.04 717.742 415.009' +
  'C719.339 418.467 719.339 422.451 717.742 425.908' +
  'C715.91 429.877 710.315 432.857 699.126 438.817' +
  'L280.58 661.75' +
  'C270.494 667.122 265.45 669.809 261.334 669.276' +
  'C257.742 668.811 254.506 666.869 252.407 663.917' +
  'C250.002 660.534 250.002 654.82 250.002 643.392' +
  'V197.526' +
  'C250.002 186.097 250.002 180.383 252.407 177.001' +
  'C254.506 174.048 257.742 172.106 261.334 171.641' +
  'C265.45 171.109 270.494 173.795 280.58 179.167' +
  'L699.126 402.1Z'

/** 下方进度条（满宽，靠下）。 */
const BAR_BOTTOM = { x: 227.275, y: 751.901, w: 569.45, h: 41.667 }
/** 上方进度条（较短，靠右）。 */
const BAR_TOP = { x: 458.338, y: 656.572, w: 338.387, h: 41.667 }

/** mark 内容包围盒（不含圆角方背景）：x [227.275, 796.725], y [171.109, 793.568]。 */
const MARK_VIEWBOX = '227.275 171.109 569.45 622.459'
/** 宽/高 ≈ 0.915（播放键近似方 + 底部进度条，整体略高）。 */
const MARK_ASPECT = 569.45 / 622.459

/** 播放键 + 两条进度条；播放键与进度条颜色可独立指定。 */
function MarkGlyph({ playFill, barFill }: { playFill: string; barFill: string }) {
  return (
    <>
      <path d={PLAY_PATH} fill={playFill} />
      <rect
        x={BAR_BOTTOM.x}
        y={BAR_BOTTOM.y}
        width={BAR_BOTTOM.w}
        height={BAR_BOTTOM.h}
        rx={16}
        fill={barFill}
      />
      <rect
        x={BAR_TOP.x}
        y={BAR_TOP.y}
        width={BAR_TOP.w}
        height={BAR_TOP.h}
        rx={16}
        fill={barFill}
      />
    </>
  )
}

// ── LogoMark：纯 mark（无圆角方背景），currentColor 自适应暗/亮 ──

export interface LogoMarkProps extends Omit<SVGAttributes<SVGSVGElement>, 'width' | 'height'> {
  /** 宽度（px）。高度按 mark 比例自动计算。 */
  size?: number
}

/**
 * 左上角使用的 logo mark。通过 `currentColor` 继承前景色：
 * 暗色模式下前景为浅色 → 白 glyph（= 黑底logo）；亮色模式下前景为深色 → 黑 glyph（= 白底logo）。
 */
export function LogoMark({ size = 22, style, ...rest }: LogoMarkProps) {
  const merged: CSSProperties = { display: 'block', ...style }
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      width={size}
      height={size / MARK_ASPECT}
      style={merged}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <MarkGlyph playFill="currentColor" barFill="currentColor" />
    </svg>
  )
}

// ── AppLogo：完整圆角方图标，三态（color / dark / light） ──

export type AppLogoVariant = 'color' | 'dark' | 'light'

export interface AppLogoProps extends Omit<SVGAttributes<SVGSVGElement>, 'width' | 'height'> {
  /**
   * color —— 主 logo：白底 + 紫色渐变播放键 + 黑进度条
   * dark  —— 暗色模式：黑底 + 纯白
   * light —— 亮色模式：白底 + 黑描边 + 纯黑
   */
  variant?: AppLogoVariant
  /** 边长（px），图标为正方形。 */
  size?: number
}

export function AppLogo({ variant = 'color', size = 64, style, ...rest }: AppLogoProps) {
  const gid = useId().replace(/:/g, '')
  const isDark = variant === 'dark'
  const isLight = variant === 'light'

  const playFill = variant === 'color' ? `url(#${gid})` : isDark ? '#ffffff' : '#000000'
  const barFill = isDark ? '#ffffff' : '#000000'

  return (
    <svg
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      style={{ display: 'block', ...style }}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {variant === 'color' && (
        <defs>
          <linearGradient
            id={gid}
            x1="250.002"
            y1="195.849"
            x2="491.777"
            y2="538.614"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0.153846" stopColor="#A259FF" />
            <stop offset="1" stopColor="#613599" />
          </linearGradient>
        </defs>
      )}

      {isLight ? (
        <rect x="0.5" y="0.5" width="1023" height="1023" rx="220.5" fill="#ffffff" stroke="#000000" />
      ) : (
        <rect width="1024" height="1024" rx="221" fill={isDark ? '#000000' : '#ffffff'} />
      )}

      <MarkGlyph playFill={playFill} barFill={barFill} />
    </svg>
  )
}

// ── Wordmark：文字标识 ──

export function Wordmark({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={className} {...rest}>
      LinguaFlix
    </span>
  )
}

export default AppLogo
