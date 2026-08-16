# LinguaFlix 交接须知（给下一个 AI 窗口）

> 2026-08-17 交接。项目根目录：`/Users/allenchen/lingua-flix`
> 技术栈：Electron + Vite + React 19 + Tailwind v4 + Zustand。
> 记忆库 `MEMORY.md` 已有大量 LinguaFlix 条目（会自动加载），本文只写**本次会话新增/改动**和**待办**，避免与记忆重复。

## Git 状态（重要）
- 只有 2 个提交：`497171e`（baseline v1.1.0，即「第一版」）、`b913480`（词典瘦身）。
- **之后的所有改动都在工作区、未提交**（`git status` 会看到一大批 `M` 和 `??` 文件，这是多轮修复累积的正常状态，别慌）。
- 有几个一次性调试/验证脚本（`dbg-card.js`、`harness-proxy.js`、`verify-*.js` 等）是未跟踪的，可忽略。

## 存储位置（磁盘实况，排查时直接看这里）

### 1. localStorage（视频注册表 `linguaflix-app` + 笔记/生词/缩略图等）
- **打包版**（app 名 `lingua-flix`，renderer 从 `file://` 加载）：
  `~/Library/Application Support/lingua-flix/Local Storage/leveldb/`
- **dev 模式**（`npm run dev`，app 名默认 **"Electron"**，renderer 在 electron-vite 的 dev server）：
  `~/Library/Application Support/Electron/Local Storage/leveldb/`（观察到的 origin 是 `http://127.0.0.1:8998`，端口可能每次变）
- ⚠️ 这两个是**分开的两个库**，排查时先确认用户跑的是打包版还是 dev 模式，别找错目录。
- leveldb 是二进制 + UTF-16LE 编码，直接 `grep` 搜不到明文；用 `python3` 按 `utf-16-le` 解码，或 `strings` 看。

### 2. 视频文件（磁盘，真正的源文件）
- Electron 下载：`~/Movies/LinguaFlix/`（`app.getPath('videos') + '/LinguaFlix'`）
- Web 后端下载：`~/Movies/LinguaFlix/`（`server/index.js` 的 `DOWNLOAD_DIR`）
- 自动剪辑复习视频：`~/Movies/LinguaFlix/clips/`（`CLIPS_DIR`）

### 3. Web 后端（`server/index.js`）数据目录
- `USER_DATA_DIR = ~/Library/Application Support/LinguaFlix/`
  - `uploads/`    —— `/api/upload/video` 上传的视频
  - `screenshots/`—— 全尺寸截图 PNG（第 179 个文件了，量大）
  - `bin/`        —— yt-dlp 等二进制

### 4. 截图存储策略（当前代码）
- 全尺寸 PNG → **磁盘**（Electron `screenshot:save` IPC；web `/api/screenshot/save`）
- 缩略图（320px JPEG）→ localStorage（`linguaflix-ss-<id>` 和视频 `thumbnailDataUrl`）
- 笔记 `imageDataUrl` 不落 JSON（`storage-service.ts` 里显式置空），只存 `filePath`。

## 本次会话完成的两件事

### A. 「使用教程」从悬浮窗改成一级页面（已完成、已同步代码）
- Open Design 项目「LinguaFlix 桌面应用重设计」新增 `tutorial.html`（一级页）。
- 「使用教程」入口在**侧边栏底部**（紧挨深浅色切换，**不在主 nav 组**）——用户强调过两次「位置跟原来一样、别跟其他放一块」。
- 设计做了「去 AI 味」（蓝色装饰收敛成中性灰，accent 蓝只留给交互），**文字内容没改**（用户明确「只改设计不改文案」）。
- 同步到代码：`Dashboard.tsx`（`navView` 加 `'tutorial'`）、`UsageTutorial.tsx`（可折叠卡片，加了 `defaultOpen` 参数）。
- 验证：`npx tsc --noEmit -p tsconfig.web.json` 通过；未跑 `npm run build`。

### B. 「视频刷新后消失」根因 + 修复（本次会话重点）
**结论一句话**：三条导入路径里，「打开文件」和「拖拽」之前已改成存**原始绝对路径**，唯独「粘贴链接下载」这条路漏了——它把带随机端口的 media URL 存进注册表，重启端口就失效。

**证据（实翻 localStorage 得出）**：
- 打包版 localStorage（`~/Library/Application Support/lingua-flix/Local Storage/leveldb`，origin=`file://`）里 `linguaflix-app` 的 `filePath` = `http://127.0.0.1:59999/media/...`（随机端口）。
- 磁盘 `~/Movies/LinguaFlix` 有 13 个视频文件，都好好的。
- 注意 dev 模式（`npm run dev`）app 名叫 **"Electron"**（不是 lingua-flix），localStorage 在 `~/Library/Application Support/Electron`（origin=`http://127.0.0.1:8998`），与打包版分开。

**已修复**（本次会话）：
- `src/renderer/components/player/SourceInput.tsx` 下载路径：`handleVideoLoaded(playSrc, fileName, mediaUrl)` → `handleVideoLoaded(playSrc, fileName, result.filePath!)`，改存原始绝对路径，与另两条路一致。
- `tsc --noEmit` 通过。

**三条导入路径现在的 filePath 存法（统一为原始绝对路径）**：
1. 打开文件对话框 `handleOpenFile` → 存原始路径 ✓
2. 拖拽/文件选择 `handleDrop`/`handleFileChange` → `importLocalFile`（`webUtils.getPathForFile`）→ 存原始路径 ✓
3. 链接下载（主流程）→ **本次刚改**：存 `result.filePath!` ✓

回放统一走 `resolveReplayableMedia`（`stream-resolver.ts`）：剥 `file://` 前缀 → 重写旧端口 media URL → `toMediaUrl` 用当前端口编码 → Range 探针确认文件在。

## 待办 / 下一步
1. 历史遗留的「多标签页整表覆盖竞态」已由 `appStore.ts` 的 union-merge + storage 监听修复（见记忆 `linguaflix-persistence-root-cause`），与下载路径问题是**两个不同根因**，别混为一谈。

## 2026-08-17 网页端持久化复核（本次追加）
- 已创建修改前回退副本：`/Users/allenchen/lingua-flix-backup-20260817-before-web-video-persistence-fix`。
- 网页端本地上传现在统一保存后端返回的**原始绝对路径**；`toMediaUrl` 只在播放时生成当前 origin 下的地址。
- 后端不可达时不再把临时 `blob:` URL 写进视频注册表；导入会明确失败并提示启动网页后端后重试。
- 浏览器端到端验证通过：本地文件上传 → 返回视频库 → 刷新 → 重新打开可播放；粘贴直链 → 刷新 → 重新打开也可播放。
- `npm run lint`、`npm run build`、`git diff --check` 均通过。
