LinguaFlix

LinguaFlix 是一个面向英语学习的沉浸式视频播放器。它把观看视频、遮挡字幕、无感笔记、语境词典、自由批注和间隔复习串成一条完整的学习流程，帮助学习者从“看懂视频”走向“记住表达”。

当前项目处于持续开发阶段。桌面版是主要使用形态；网页版目前主要用于本地开发、测试和功能预览。


一、核心功能

1. 多种视频导入

支持打开本地文件、拖拽视频、粘贴 YouTube 或 Bilibili 链接，也可以加载直接视频地址，播放器会自动提取视频、下载并加载进入播放界面。

2. 字幕学习（可选项）

支持 SRT、VTT、ASS、SSA 字幕格式，提供逐句 Transcript。点击字幕句子即可跳转到对应的视频位置。

3. 字幕遮挡

通过可移动、可缩放的字幕挡块遮住中文字幕，只保留英文输入。挡块支持实心和模糊两种效果，也可以调整透明度、位置和大小。

4. 截图与本地 OCR

可以使用快捷键或播放器按钮截图，记录不懂的生词或句子。应用使用本地 OCR 模型识别画面中的英文字幕，不需要把截图上传到第三方 API。

默认情况下，OCR 识别区域是屏幕的下 20%。用户可以手动框选英文字母区域，以大大提高 OCR 识别准确性。OCR 识别出的文本如果有误，也支持重新框选或手动修改文本。

5. 无感记录笔记流

每张截图对应一份笔记，这份笔记里面有识别出的 OCR 文本、视频时间点、个人批注和多个学习单词。用户通过图片、视频、句子、词典等多元化内容，在语境中学习英语。

6. 词典与 AI 分析（当前允许自定义开放使用，后续会提供付费服务以保证服务质量）

可以查询词义、音标、词性和例句，也可以使用 OpenAI、Claude、DeepSeek、MiMo、Kimi、通义等兼容接口分析当前语境中的单词用法。

7. 词汇本与复习（复习记忆模块正在开发当中，后续会通过付费形式推出，不影响软件的其他使用功能）

单词本中保存单词的语境、截图和视频时间点，用户可以随时查看截图内容，或回到视频中查看单词出现的位置。与此同时，软件会通过算法安排后续复习。

8. 复习视频

看完一个视频之后，如何快速复习？复习视频功能会根据最近视频中保存的词汇时间点，自动剪辑生成复习片段合集，帮助用户快速回顾视频中的知识点。

9. 个性化设置

支持中文和英文界面，以及深色和浅色模式、字号、播放速度和快捷键设置。


二、工作方式

桌面版

Electron 负责应用窗口和系统能力，播放器前端由 Vite 和 React 提供，本地 Node 服务负责媒体流、视频下载、截图保存和复习视频剪辑。

桌面版包含以下部分：

React 和 Vite 渲染界面
Electron 主进程
本地 HTTP 媒体服务
yt-dlp 视频下载工具
FFmpeg 视频处理工具

默认情况下，媒体和 API 服务只监听本机 127.0.0.1。视频、笔记和词汇主要保存在用户自己的电脑上。

网页版开发模式

网页版通过 Vite 代理连接本机 Node 后端：

浏览器 → Vite 前端 → 本地 Node 后端 → 本地媒体、yt-dlp 和 FFmpeg

网页版目前适合本地开发和测试。由于后端依赖本机文件路径，不能直接把 server/index.js 暴露到公网作为生产 SaaS 后端。


三、快速开始

环境要求

Node.js 22 或更高版本（需要系统根证书支持）
npm
FFmpeg（使用自动剪辑功能时需要）
macOS、Windows 或 Linux

安装依赖

npm install

启动桌面开发版

npm run dev

启动网页版本地开发环境

./start.sh

然后打开 http://localhost:5173。

如果 5173 端口已被占用，Vite 会自动选择其他端口。

也可以单独启动前端：

npm run dev:web

单独启动前端时，需要确保后端已经运行在 127.0.0.1:5176。


四、构建与发布

类型检查和 Electron 构建：

npm run lint
npm run build

macOS 本地构建：

./start-desktop.sh --build-only

构建产物位于 release 目录。没有 Apple Developer 证书时，可以生成未公证的本地测试包。正式面向大量 macOS 用户分发时，建议使用 Developer ID 签名和公证。

Windows 和 Linux 的打包配置写在 electron-builder.yml 中。


五、使用流程

1. 从首页导入本地视频，或粘贴视频平台链接。
2. 加载外部字幕；如果视频使用硬字幕，可以设置 OCR 识别区域。
3. 播放视频时使用字幕挡块遮住中文字幕，进行精听。
4. 使用 C 键截图，等待本地 OCR 识别字幕。
5. 在批注面板修正 OCR、记录想法，并点击单词查看词典。
6. 保存需要掌握的词汇，之后从单词本进入 SM-2 复习。
7. 需要集中复习时，可以生成复习视频片段合集。


六、默认快捷键

Space：播放或暂停
左方向键和右方向键：后退或快进 5 秒
B：显示或隐藏字幕挡块
L：锁定或解锁字幕挡块
R：重置字幕挡块
C：截图
F：全屏

所有快捷键都可以在设置页修改。


七、AI 配置

AI 分析使用用户自己的服务商账号。设置页支持预设服务商，也支持自定义 OpenAI-compatible 或 Anthropic-compatible Base URL。

当前 AI Key 保存在本地应用存储中，并在使用时发送到对应的 AI 服务。项目仓库不包含任何默认 Key。

不要在公共电脑或不可信的浏览器环境中填写个人 API Key。

不配置 AI 不会影响视频播放、字幕遮挡、截图 OCR、词典和复习功能。


八、数据位置

具体路径会根据操作系统变化。macOS 常见位置如下：

视频和下载内容：~/Movies/LinguaFlix/
网页后端上传内容：~/Library/Application Support/LinguaFlix/uploads/
截图：~/Library/Application Support/LinguaFlix/screenshots/
应用设置、视频注册表、笔记和词汇：浏览器或 Electron 的本地存储

视频文件本身不会被 Git 追踪，也不会被提交到 GitHub。


九、项目结构

src/main/
Electron 主进程、IPC 和媒体服务

src/preload/
Electron preload API

src/renderer/
React 页面、播放器、词典和学习功能

src/renderer/components/player/
视频导入、播放器和字幕交互

src/renderer/components/sidebar/
批注、词汇本和截图面板

src/renderer/services/
OCR、存储、词典、AI 和媒体解析

src/renderer/stores/
Zustand 状态管理

server/index.js
网页版本地后端

shared/
下载器和主进程、渲染进程共享类型

resources/
图标、词典数据库和应用资源


十、安全边界

当前版本定位为本地桌面应用和本地开发环境：

后端默认只监听 127.0.0.1，不要直接改成公网监听。
不要把当前本地后端未经鉴权部署到公网。
视频路径和截图路径属于本机数据，不应提交到仓库或公开日志。
正式发布前应使用签名、公证、依赖审计和最小权限配置。

如果要做正式的多人网页版，需要进一步加入用户认证、对象存储、数据库、任务队列、访问令牌、视频权限控制和服务端限流。


十一、技术栈

Electron 42
React 19 和 TypeScript
Vite 和 Tailwind CSS v4
Zustand
Node.js HTTP server
yt-dlp 和 FFmpeg
PaddleOCR 和 ONNX Runtime Web
SM-2 spaced repetition


十二、License

项目当前 package.json 声明为 MIT。正式发布前，请确保仓库根目录包含与你的分发意图一致的许可证文件和第三方依赖声明。
