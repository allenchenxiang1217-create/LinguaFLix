# LinguaFlix

LinguaFlix 是一个面向英语学习的沉浸式视频播放器。它把观看视频、遮挡字幕、截图 OCR、语境词典、批注和间隔复习串成一条学习流程，帮助你从“看懂视频”走向“记住表达”。

> 当前项目处于持续开发阶段。桌面版是主要使用形态；网页版目前主要用于本地开发、测试和功能预览。

## 核心功能

- **多种视频导入**：打开本地文件、拖拽视频、粘贴 YouTube / Bilibili 链接，或加载直接视频地址。
- **字幕学习**：支持 SRT、VTT、ASS、SSA 字幕，提供逐句 Transcript，并可点击句子跳转播放位置。
- **字幕遮挡**：用可移动、可缩放的挡块遮住中文字幕，只保留英文输入；支持实心和模糊效果。
- **截图与本地 OCR**：快捷键或播放器按钮截图，使用本地 PaddleOCR / ONNX 模型识别画面中的英文字幕，不需要上传截图到第三方 API。
- **批注工作流**：每张截图可以保存 OCR 文本、时间点、个人批注和多个学习单词。
- **词典与 AI 分析**：查询词义、音标、词性和例句，也可以使用 OpenAI、Claude、DeepSeek、MiMo、Kimi、通义等兼容接口分析当前语境。
- **词汇本与复习**：保存单词的语境、截图和视频时间点，使用 SM-2 间隔重复算法安排复习。
- **复习视频**：根据最近视频中保存的词汇时间点，自动剪辑生成复习片段合集。
- **中英文界面**：支持中文和英文界面，以及深浅色、字号、播放速度和快捷键设置。

## 工作方式

### 桌面版

Electron 负责窗口和系统能力，播放器前端由 Vite + React 提供，本地 Node 服务负责媒体流、视频下载、截图保存和复习视频剪辑。

```text
LinguaFlix.app
├── React + Vite renderer
├── Electron main process
├── Local HTTP media server
├── yt-dlp
└── FFmpeg（系统安装或发行包提供）
```

默认情况下，媒体和 API 服务只监听本机 `127.0.0.1`，视频、笔记和词汇主要保存在用户自己的电脑上。

### 网页版开发模式

网页版通过 Vite 代理连接本机 Node 后端：

```text
Browser → Vite frontend → local Node backend → local media / yt-dlp / FFmpeg
```

它适合本地开发和测试。当前后端依赖本机文件路径，不能直接把 `server/index.js` 暴露到公网作为生产 SaaS 后端。

## 快速开始

### 环境要求

- Node.js 20+
- npm
- FFmpeg（使用自动剪辑时需要）
- macOS、Windows 或 Linux

### 安装依赖

```bash
npm install
```

### 启动桌面开发版

```bash
npm run dev
```

### 启动网页版本地开发环境

推荐使用项目脚本，它会同时启动后端和 Vite 前端：

```bash
./start.sh
```

然后打开 [http://localhost:5173](http://localhost:5173)。如果该端口已被占用，Vite 会自动选择其他端口。

也可以单独启动前端：

```bash
npm run dev:web
```

此时需要确保后端已经在 `127.0.0.1:5176` 运行。

## Windows 使用说明（仅 Windows）

> 以下说明仅适用于 **Windows** 用户。macOS / Linux 用户请参照上面的「快速开始」。

### 获取安装包

在 [GitHub Releases](https://github.com/allenchenxiang1217-create/LinguaFLix/releases) 下载：

- **`LinguaFlix-<version>-win.zip`** —— 绿色版，**解压即用**（推荐）
- **`LinguaFlix-<version>-win-setup.exe`** —— 安装版

两个版本都已内置 yt-dlp / FFmpeg / 离线词典，**无需安装任何依赖或配置**。

### 打开步骤（绿色版）

1. 把 `LinguaFlix-<version>-win.zip` **解压**到任意文件夹（必须解压，不能直接在压缩包内双击）。
2. 进入解压后的文件夹，找到 **`LinguaFlix.exe`**（蓝色狐狸图标）并**双击**启动。
3. 若 Windows 弹出安全警告，点「更多信息」→「仍要运行」（内测版未签名，属正常提示）。
4. 其余文件（`resources/`、`locales/`、`.dll`、`.pak` 等）都是运行必需的，请勿移动或删除。

### Windows 平台适配说明

Windows 运行时的平台适配已**合并到源代码**（Mac 开发环境同样受益），包括：

- **yt-dlp 中文文件名**：GBK 输出解码（stdout + stderr），避免中文乱码导致播放失败
- **Windows 盘符路径**：`/C:/...` → `C:/...` 规范化，修复本地视频 404
- **YouTube 下载**：自动读取系统代理（`HTTP(S)_PROXY`）、自动检测 JS runtime（`--js-runtimes node`）、使用 `player_client=android` 规避 403
- **内置二进制**：安装包内置 yt-dlp / ffmpeg / ffprobe，解压即用、零配置
- **构建适配**：`where` 命令、打包 artifact 命名区分等

若需重新构建 Windows 安装包（含内置二进制），在 Windows 上执行：

```bat
npm install
npm run build
npx electron-builder --win nsis zip
```

产物在 `release/`：`LinguaFlix-<version>-win.zip`（绿色版）与 `LinguaFlix-<version>-win-setup.exe`（安装版）。

## 构建与发布

先运行类型检查和 Electron 构建：

```bash
npm run lint
npm run build
```

macOS 本地构建可以使用：

```bash
./start-desktop.sh --build-only
```

构建产物位于 `release/`。未加入 Apple Developer Program 时，可以生成未公证的本地测试包；正式面向大量 macOS 用户分发时，建议使用 Developer ID 签名和公证。Windows 和 Linux 的打包配置也已写入 `electron-builder.yml`。

## 使用流程

1. 从首页导入本地视频，或粘贴视频平台链接。
2. 加载外部字幕；如果视频是硬字幕，可以设置 OCR 识别区域。
3. 播放时用挡块遮住中文字幕，按句精听。
4. 使用 `C` 截图，等待本地 OCR 识别字幕。
5. 在批注面板修正 OCR、记录想法，并点击单词查看词典。
6. 保存需要掌握的词汇，之后从单词本进入 SM-2 复习。
7. 需要集中复习时，可以生成复习视频片段合集。

## 默认快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Space` | 播放 / 暂停 |
| `←` / `→` | 后退 / 快进 5 秒 |
| `B` | 显示 / 隐藏字幕挡块 |
| `L` | 锁定 / 解锁挡块 |
| `R` | 重置挡块 |
| `C` | 截图 |
| `F` | 全屏 |

所有快捷键都可以在设置页修改。

## AI 配置

AI 分析采用用户自己的服务商账号。设置页支持预设服务商和自定义 OpenAI-compatible / Anthropic-compatible Base URL。

当前 AI Key 保存在本地应用存储中，并在使用时发送到对应的 AI 服务；项目仓库不包含任何默认 Key。不要在公共电脑或不可信的浏览器环境中填写个人 API Key。

不配置 AI 不会影响视频播放、字幕遮挡、截图 OCR、词典和复习功能。

## 数据位置

具体路径会根据操作系统变化。macOS 常见位置如下：

- 视频和下载内容：`~/Movies/LinguaFlix/`
- 网页后端上传内容：`~/Library/Application Support/LinguaFlix/uploads/`
- 截图：`~/Library/Application Support/LinguaFlix/screenshots/`
- 应用设置、视频注册表、笔记和词汇：浏览器或 Electron 的本地存储

视频文件本身不会被 Git 追踪，也不会被提交到 GitHub。

## 项目结构

```text
src/main/                         Electron 主进程、IPC、媒体服务
src/preload/                      Electron preload API
src/renderer/                     React 页面、播放器、词典和学习功能
src/renderer/components/player/   视频导入、播放器和字幕交互
src/renderer/components/sidebar/  批注、词汇本和截图面板
src/renderer/services/             OCR、存储、词典、AI 和媒体解析
src/renderer/stores/               Zustand 状态管理
server/index.js                   网页版本地后端
shared/                           下载器和主进程/渲染进程共享类型
resources/                        图标、词典数据库和应用资源
```

## 安全边界

当前版本定位为本地桌面应用和本地开发环境：

- 后端默认只监听 `127.0.0.1`，不要直接改成公网监听。
- 不要把当前本地后端未经鉴权部署到公网。
- 视频路径和截图路径属于本机数据，不应提交到仓库或公开日志。
- 发布前应使用签名、公证、依赖审计和最小权限配置。

如果要做正式的多人网页版，需要进一步加入用户认证、对象存储、数据库、任务队列、访问令牌、视频权限控制和服务端限流。

## 技术栈

- Electron 42
- React 19 + TypeScript
- Vite + Tailwind CSS v4
- Zustand
- Node.js HTTP server
- yt-dlp + FFmpeg
- PaddleOCR / ONNX Runtime Web
- SM-2 spaced repetition

## License

项目当前 `package.json` 声明为 MIT。正式发布前请确保仓库根目录包含与你的分发意图一致的许可证文件和第三方依赖声明。
