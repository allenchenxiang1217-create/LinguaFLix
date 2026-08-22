# LinguaFlix 更新日志 (CHANGELOG)

## v1.1.0 (未发布 · 待核验后推送)

### 🆕 新功能

#### 1. 字幕语言显示模式（播放器右侧 🌐 按钮）
- **中英双语 / 仅英文 / 仅中文 / 无字幕** 四种模式，手机开关风格切换
- 模式选择自动记忆（localStorage），下次打开保持
- 工具栏按钮在非双语/无字幕时显示角标（`EN` / `中` / `✕`）

#### 2. 双语字幕自动合并
- SRT 中"英文块 + 中文块分开、但时间戳一致"的字幕自动合并为一条
- 合并后英文行在前、中文行在后，配合显示模式过滤
- 时间容差 ≤ 0.3 秒；重复行自动去重

#### 3. 视频重命名（视频库 + 最近学习）
- 视频库网格卡片、最近学习列表行悬停出现 ✏️ 铅笔按钮
- 内联编辑：回车/✓ 保存，Esc/✗ 取消，点击外部自动保存
- 只改显示名称，不影响视频文件、笔记、生词等关联数据

#### 4. 字幕删除
- 播放器顶部紧凑栏：加载字幕且已有字幕时出现「✕ 删除字幕」按钮
- 一键清除误加载的字幕

### 🔧 修复

#### 5. 字幕挡块不再遮挡操作栏
- 播放器操作栏 z-index：`z-20` → `z-[50]`（挡块 z-40 之上）
- 右侧工具栏：`z-40` → `z-[46]`
- 视频改为 `object-contain`（等比完整显示），不再被裁剪顶到播放器边栏

#### 6. 打开侧边栏自动隐藏字幕
- 侧边栏**完整展开**（full）时立即隐藏字幕挡块，收起恢复
- **悬浮预览**（popup，光标停在笔记按钮）激活 150ms 后隐藏挡块，移开恢复
- 记住用户之前的挡块开关状态，恢复时不强制打开

#### 7. 全屏截图反馈修复
- 截图闪光改用**覆盖层**（原先容器的 `box-shadow` 在全屏元素上不可见）
- 全屏截图现在有光晕闪烁 + 「截图已保存 · 快照 #N」悬浮提示（全屏元素内部渲染一份 toast）

#### 8. 截图大图查看优化
- 笔记截图 lightbox 显示区域扩大（96vw × 92vh），保持等比完整显示

### 📁 涉及文件（全部为渲染层前端，无后端/下载器改动）

```
修改：
  src/renderer/components/dashboard/Dashboard.tsx        # 重命名按钮接入
  src/renderer/components/layout/AppLayout.tsx           # 侧边栏自动隐藏挡块
  src/renderer/components/player/PlayerToolRail.tsx      # 字幕模式按钮
  src/renderer/components/player/SourceInput.tsx         # 删除字幕按钮
  src/renderer/components/player/VideoControls.tsx       # 操作栏层级
  src/renderer/components/player/VideoPlayer.tsx         # object-contain + 闪光覆盖层 + 全屏 toast
  src/renderer/components/sidebar/NoteSnapshotCard.tsx   # 截图 lightbox
  src/renderer/components/subtitles/SubtitleOverlay.tsx  # 显示模式过滤
  src/renderer/i18n/translations.ts                      # 中英文案
  src/renderer/services/subtitle-parser.ts               # 双语字幕合并
  src/renderer/stores/appStore.ts                        # renameVideo action
  src/renderer/stores/subtitleStore.ts                   # displayMode 状态
  src/renderer/styles/globals.css                        # flash-out 动画

新增：
  src/renderer/components/dashboard/RenameInline.tsx     # 重命名内联编辑组件
  src/renderer/components/subtitles/SubtitleDisplayPanel.tsx  # 字幕模式开关面板
```
