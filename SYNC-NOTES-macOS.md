# 给 macOS 开发者的同步说明（v1.1.0 未发布改动）

> 本文档写给在 macOS 上开发 LinguaFlix 的维护者（也就是你）。
> 本次所有改动均为**渲染层前端**（React + TypeScript），**不涉及**
> Electron 主进程、预加载脚本、Node 后端或 yt-dlp/ffmpeg 下载逻辑，
> macOS 构建完全不受影响。

## 一、改动总览（13 改 + 2 新增）

| 文件 | 改动 | 备注 |
| --- | --- | --- |
| `stores/subtitleStore.ts` | 新增 `displayMode` 状态（`none/bilingual/english/chinese`）+ `setDisplayMode` + 持久化 | 键 `linguaflix-blocker-v1` 内新增字段，向后兼容 |
| `stores/appStore.ts` | 新增 `renameVideo(hash, newName)` action | 只改 fileName，hash 不变 |
| `services/subtitle-parser.ts` | 新增 `mergeOverlappingCues()`，解析后自动合并同时间戳双语字幕 | 时间容差 0.3s，英文行在前 |
| `components/subtitles/SubtitleOverlay.tsx` | 按 `displayMode` 过滤字幕行；`none` 不渲染；混合行提取目标语言 | |
| `components/subtitles/SubtitleDisplayPanel.tsx` | **新增**：字幕模式开关面板（手机开关样式） | |
| `components/player/PlayerToolRail.tsx` | 工具栏加 🌐 字幕模式按钮 + 面板；z-index `z-40`→`z-[46]` | |
| `components/player/VideoPlayer.tsx` | 视频 `object-cover`→`object-contain`；截图闪光改覆盖层；全屏内嵌 toast | 关键：全屏 toast 必须渲染在全屏元素内 |
| `components/player/VideoControls.tsx` | 操作栏 z-index `z-20`→`z-[50]`（挡块之上） | |
| `components/player/SourceInput.tsx` | 紧凑栏加「✕ 删除字幕」按钮（有字幕时显示） | |
| `components/layout/AppLayout.tsx` | 侧边栏 full / popup 激活时自动隐藏挡块，关闭恢复 | popup hover 延迟 150ms |
| `components/dashboard/Dashboard.tsx` | 视频库 + 最近学习接入重命名按钮 | |
| `components/dashboard/RenameInline.tsx` | **新增**：内联重命名编辑组件 | |
| `components/sidebar/NoteSnapshotCard.tsx` | 截图 lightbox 区域扩大 | |
| `styles/globals.css` | 新增 `flash-out` 动画 + `--animate-flash-out` | |
| `i18n/translations.ts` | 新增中英文案（subtitleDisplay.*、dashboard.rename.*、import.removeSubtitles） | |

## 二、需要你重点核验的点

1. **字幕合并**（`subtitle-parser.ts`）：双语 SRT（英文/中文分开成块、时间一致）现在合并为一条。
   请用你自己的双语字幕测试：macOS 上 `npm run dev` → 加载字幕 → 确认显示两行。
2. **字幕显示模式**：播放器右侧工具栏 🌐 按钮 → 切换 无/双语/仅英文/仅中文。
3. **视频重命名**：视频库/最近学习悬停铅笔按钮。
4. **挡块层级**：挡块拖到下方不应盖住操作栏。
5. **全屏 toast**：全屏时截图应看到「截图已保存 · 快照 #N」（渲染在全屏元素内部）。

## 三、需要注意的边界情况

- `subtitle-parser.ts` 的合并是**自动**的：任何 startTime 相差 ≤0.3s 且重叠的 cue 都会合并。
  如果你的字幕里**有意**让两条 cue 同时间显示（如人名+台词双行），合并后仍会显示两行（用 \n 连接），
  行为一致；但**顺序会重排为英文在前、中文在后**。
- `AppLayout` 的挡块自动隐藏依赖 `sidebarHovered`（popup 状态），macOS 触控板 hover 行为与鼠标一致。
- `VideoPlayer` 全屏 toast 用的是 `z-[60]`，若未来全屏面板层级变化需同步调整。

## 四、构建验证（macOS）

```bash
npm install
npm run lint    # tsc --noEmit
npm run build   # electron-vite build
```

本次改动不涉及原生模块或打包配置，`npm run build` 通过即可。

## 五、与已推送版本的关系

- 当前远程 master = `a27b1e6`（含之前的 Windows 修复：yt-dlp 编码、YouTube 代理/JS runtime/player_client、
  Windows 盘符路径、黑边修复、README Windows 说明）。
- 本次 15 个文件的改动是**未提交**的工作区内容，核验通过后 commit + push。
- 更新日志见 `CHANGELOG.md`。
