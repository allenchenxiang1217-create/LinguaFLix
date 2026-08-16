# LinguaFlix 新 Logo（可直接接入）

把桌面「logo设计」文件夹里的三份源 SVG 优化成了一份 React 组件 + 四份标准化 SVG。所有内容自包含、无外部依赖，可直接替换原有 logo 文件。

## 文件清单

| 文件 | 用途 |
| --- | --- |
| `Logo.tsx` | 可直接替换原 logo 组件（导出 `LogoMark` / `AppLogo` / `Wordmark`） |
| `applogo.svg` | 主 logo：白底圆角方 + 紫色渐变播放键 + 黑进度条 |
| `黑底logo.svg` | 暗色模式：黑底 + 纯白 glyph |
| `白底logo.svg` | 亮色模式：白底 + 黑描边 + 纯黑 glyph |
| `logo-mark.svg` | 纯 mark（播放键 + 进度条，`currentColor` 自适应） |

## 三态对应关系

| 场景 | 组件写法 | 表现 |
| --- | --- | --- |
| 主 logo / 应用图标 / 引导页 | `<AppLogo variant="color" />` | 白底 + 紫渐变播放键 |
| 深色背景（暗色模式） | `<AppLogo variant="dark" />` 或 `<LogoMark className="text-foreground" />` | 纯白 |
| 浅色背景（亮色模式） | `<AppLogo variant="light" />` 或 `<LogoMark className="text-foreground" />` | 纯黑 |

## 接入方式

### 1. 左上角（侧栏 / 顶栏）

推荐用 `LogoMark`，它通过 `currentColor` 继承前景色，**暗/亮模式自动切换，组件内无需判断主题**：

```tsx
import { LogoMark, Wordmark } from './Logo'

<div className="flex items-center gap-2.5">
  <LogoMark size={22} className="text-foreground" />
  <span className="text-[15px] font-semibold tracking-tight">
    <Wordmark />
  </span>
</div>
```

> 暗色模式下 `--foreground` 为浅色 → 白 glyph；亮色模式下为深色 → 黑 glyph，正好对应「黑底 / 白底」两份源文件。

### 2. 应用图标 / 关于页 / 需要显式三态的地方

```tsx
import { AppLogo } from './Logo'

<AppLogo variant="color" size={64} />   // 主 logo（紫色渐变）
<AppLogo variant="dark"  size={64} />   // 深色背景
<AppLogo variant="light" size={64} />   // 浅色背景
```

### 3. 若需整份 SVG（favicon / 打包图标 / 非 React 场景）

直接引用同目录的 `applogo.svg`、`黑底logo.svg`、`白底logo.svg` 或 `logo-mark.svg`。其中 `logo-mark.svg` 用 `currentColor`，可直接嵌进任意 HTML 并随 `color` 变主题色。

## 设计规范（Apple 风格）

- **圆角方**：`rx = 221 / 1024 ≈ 21.6%`（与 iOS app icon 的圆角比例一致）
- **品牌紫渐变**：`#A259FF → #613599`（对角，`gradientUnits="userSpaceOnUse"`，起点 (250,196) → 终点 (492,539)）
- **图标结构**：右指播放键（圆角三角）+ 底部两条「进度条」胶囊（`rx=16`），表达「视频 + 学习进度」
- **单色态**：暗色 `#ffffff` / 亮色 `#000000`，保证在任何背景上的可读性

## 与原 SVG 的差异（优化点）

1. 底部两条进度条由「带 `H512` 冗余接缝的 path」改为等价的 `<rect rx="16">`，更小、更清晰。
2. 播放键路径统一了坐标（原三份里 `717.743/717.742`、`280.581/280.58` 是浮点取整差异，视觉无差别）。
3. `LogoMark` 用紧贴内容的 `viewBox` 裁剪掉圆角方背景与留白，`size` 语义干净。
4. 渐变 id 语义化命名（`linguaflix-play-grad`）；React 组件内用 `useId()` 生成唯一 id，避免多个实例内联时 id 冲突。

## 备注

- `Wordmark` 当前为最简实现（纯文本 `LinguaFlix`），沿用父容器样式；如需「Lingua + 紫色 Flix」的双色锁版可在此基础上扩展。
- 三份源 SVG 均保留了 `width/height="1024"` 与 `viewBox="0 0 1024 1024"`，作为图标素材可直接缩放导出 PNG/ICNS/ICO。
