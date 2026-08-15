import { useId } from 'react'

/**
 * LinguaFlix 品牌符号——与最终 app 图标一致：紫色渐变「播放三角」+ 下方「字幕条」。
 * 图标底色为白，故此处用亮一档的紫色，保证在深色侧栏/启动页上依旧清晰。
 */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  // 同一页面会渲染多枚 Logo，用 useId 派生唯一渐变 id，避免 SVG id 冲突。
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${uid}-play`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B47CFF" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#A259FF" />
          <stop offset="1" stopColor="#7C4DCC" />
        </linearGradient>
      </defs>
      {/* 播放三角（指向右） */}
      <path d="M16 12 L16 32 L36 22 Z" fill={`url(#${uid}-play)`} />
      {/* 字幕条 */}
      <rect x="10" y="40" width="28" height="4" rx="2" fill={`url(#${uid}-bar)`} />
    </svg>
  )
}

/**
 * 字标 W2：源语重、译文轻——「Lingua」加粗近白，「Flix」常规弱化。
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="font-semibold">Lingua</span>
      <span className="font-normal opacity-60">Flix</span>
    </span>
  )
}
