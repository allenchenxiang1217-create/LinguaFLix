# LinguaFlix Windows 修复补丁

本目录包含 Windows 专属的启动与打包工具。Windows 运行修复已经合并到主分支，
不再需要手动应用补丁。

## 背景

项目主要在 macOS 上开发，但 Windows 上运行存在几个问题：

1. **yt-dlp 输出编码**：yt-dlp 在中文 Windows 上输出 GBK 编码的文件路径，
   Node 默认按 UTF-8 解码导致中文文件名乱码 → 视频无法播放
2. **Windows 盘符路径**：`C:\...` 编码为 `/media/C%3A/...` 后，后端解码为
   `/C:/...`，但 Windows 上这不是有效路径 → `existsSync` 永远 false → 404
3. **桌面端 decodeURI**：`src/main/media-server.ts` 用 `decodeURI`（不解码
   `%3A`），需改为 `decodeURIComponent`
4. **ffmpeg/yt-dlp 查找**：`which` 命令在 Windows 上不存在（应用 `where`），
   且打包版需要优先使用内置的 yt-dlp/ffmpeg
5. **打包配置**：nsis 与 portable 共用 artifactName 互相覆盖；win-bin 二进制
   未打包进安装包

## 文件内容

| 文件 | 说明 |
| --- | --- |
| `windows-fixes.patch` | 全部修复的 git diff（针对仓库 HEAD 生成） |
| `apply-windows-fixes.cmd` | Windows 一键应用补丁脚本 |
| `build-windows-installer.cmd` | 下载内置二进制 + 应用补丁 + 构建安装包 |

## 使用方法（Windows）

### 构建完整安装包（推荐）

```bat
cd LinguaFLix
windows-fixes\build-windows-installer.cmd
```

脚本会：
1. 下载 yt-dlp.exe（npmmirror 镜像）
2. 下载 ffmpeg essentials（gyan.dev，约 106MB）
3. 放入 `resources/win-bin/`
4. `npm install`（若 node_modules 不存在）
5. `npm run build`
6. `npx electron-builder --win nsis zip`

产物在 `release/`：
- `LinguaFlix-<version>-win-setup.exe` — 安装版
- `LinguaFlix-<version>-win.zip` — 绿色版，**解压即用**（含 yt-dlp/ffmpeg/ffprobe）

## 注意事项

- `windows-fixes.patch` 仅作为历史变更记录保留，不要重复应用。
- `resources/win-bin/` 已被 .gitignore 排除（二进制太大不适合进 git）。
- Mac/Linux 构建不受影响：win-bin 的 extraResources 只在 `win:` 段声明。
