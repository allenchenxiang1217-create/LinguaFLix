import { create } from 'zustand'
import type { AIOverride } from '../services/ai-providers'

export type UILanguage = 'zh' | 'en'
export type SubtitleSize = 'sm' | 'md' | 'lg'
export type ThemeMode = 'dark' | 'light'
/** 词典服务模式：#3 在线（更便捷，需联网）或离线（更稳定，安装包更大，走内置 ECDICT）。 */
export type DictMode = 'online' | 'offline'

// ── 快捷键（#2 可配置） ──

/** 播放器可自定义的快捷键动作。值存 KeyboardEvent.key 的小写形式（如 ' '、'arrowleft'、'c'）。 */
export type ShortcutAction =
  | 'playPause'
  | 'seekBack5'
  | 'seekFwd5'
  | 'toggleBlocker'
  | 'lockBlocker'
  | 'resetBlocker'
  | 'takeScreenshot'
  | 'fullscreen'

export type ShortcutMap = Record<ShortcutAction, string>

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  'playPause', 'seekBack5', 'seekFwd5', 'toggleBlocker',
  'lockBlocker', 'resetBlocker', 'takeScreenshot', 'fullscreen',
]

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  playPause: ' ',
  seekBack5: 'arrowleft',
  seekFwd5: 'arrowright',
  toggleBlocker: 'b',
  lockBlocker: 'l',
  resetBlocker: 'r',
  takeScreenshot: 'c', // 截图默认键从 s 换成更顺手的 c（Camera）
  fullscreen: 'f',
}

/** 按键显示名（设置页编辑器的展示）。 */
export function formatShortcutKey(key: string): string {
  switch (key) {
    case ' ': return 'Space'
    case 'arrowleft': return '←'
    case 'arrowright': return '→'
    case 'arrowup': return '↑'
    case 'arrowdown': return '↓'
    case 'escape': return 'Esc'
    default: return key.length === 1 ? key.toUpperCase() : key
  }
}

interface SettingsState {
  // AI —— aiProvider 是服务商 id（指向 ai-providers 预设）；模型名用户自填，不预设
  aiProvider: string
  aiModel: string
  /** 按 provider id 存用户覆盖（Key / 自定义 Base URL）；留空 = 用预设官方值 */
  aiOverrides: Record<string, AIOverride>

  // OCR
  ocrLanguage: string           // default 'eng'

  // 词典
  dictMode: DictMode            // #3 离线 / 在线词典服务，default 'online'

  // UI
  language: UILanguage          // 界面语言，default 'zh'
  themeMode: ThemeMode          // 深浅色（白天/黑夜），default 'dark'（现状即深色）
  theme: string                 // accent 主色预设 id，default 'blue'（沿用现有苹果蓝）
  uiScale: number               // 字体大小（0.9–1.2），根 font-size 缩放，只影响 rem 文本
  subtitleSize: SubtitleSize    // 字幕字号档，default 'md'
  defaultPlaybackRate: number   // 视频默认倍速，default 1
  shortcuts: ShortcutMap        // 播放器快捷键（#2 可配置）
}

interface SettingsActions {
  setLanguage: (language: UILanguage) => void
  setSetting: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void
  /** 写某个服务商的用户覆盖（只合并传入的字段，不覆盖其他）。 */
  setAiOverride: (id: string, override: AIOverride) => void
  /** #2 设置某个快捷键动作的按键（存 e.key 小写）。 */
  setShortcut: (action: ShortcutAction, key: string) => void
  /** #2 单个快捷键恢复默认。 */
  resetShortcut: (action: ShortcutAction) => void
  /** 恢复默认设置（只重置设置，不动词汇/笔记数据）。 */
  resetSettings: () => void
}

const STORAGE_KEY = 'linguaflix-settings-v2'

const DEFAULTS: SettingsState = {
  aiProvider: 'deepseek',
  aiModel: '',
  aiOverrides: {},
  ocrLanguage: 'eng',
  dictMode: 'online',
  language: 'zh',
  themeMode: 'dark',
  theme: 'blue',
  uiScale: 1,
  subtitleSize: 'md',
  defaultPlaybackRate: 1,
  shortcuts: { ...DEFAULT_SHORTCUTS },
}

/**
 * 迁移旧存档（v1）：legacy openaiApiKey → aiOverrides.openai.apiKey、
 * claudeApiKey → aiOverrides.claude.apiKey；aiProvider(openai/claude) 本就是服务商 id，保留。
 * 迁移后 legacy 字段不写回（persistSettings 白名单里已剔除）。
 */
function migrate(raw: any): Partial<SettingsState> {
  const out: Partial<SettingsState> = { ...raw }
  if (typeof out.aiOverrides !== 'object' || out.aiOverrides === null) {
    const ov: Record<string, AIOverride> = {}
    if (typeof raw.openaiApiKey === 'string' && raw.openaiApiKey) {
      ov.openai = { ...(ov.openai || {}), apiKey: raw.openaiApiKey }
    }
    if (typeof raw.claudeApiKey === 'string' && raw.claudeApiKey) {
      ov.claude = { ...(ov.claude || {}), apiKey: raw.claudeApiKey }
    }
    out.aiOverrides = ov
  }
  return out
}

function loadSettings(): Partial<SettingsState> {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) return migrate(JSON.parse(data))
  } catch { /* ignore */ }
  return {}
}

function persistSettings(s: SettingsState) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        aiProvider: s.aiProvider,
        aiModel: s.aiModel,
        aiOverrides: s.aiOverrides,
        ocrLanguage: s.ocrLanguage,
        dictMode: s.dictMode,
        language: s.language,
        themeMode: s.themeMode,
        theme: s.theme,
        uiScale: s.uiScale,
        subtitleSize: s.subtitleSize,
        defaultPlaybackRate: s.defaultPlaybackRate,
        shortcuts: s.shortcuts,
      }),
    )
  } catch { /* ignore */ }
}

const initial = loadSettings()

export const useSettingsStore = create<SettingsState & SettingsActions>((set, get) => ({
  ...DEFAULTS,
  ...initial,

  setLanguage: (language) => {
    set({ language })
    persistSettings(get())
  },

  setSetting: (key, value) => {
    set({ [key]: value } as Partial<SettingsState>)
    persistSettings(get())
  },

  setAiOverride: (id, override) => {
    set((s) => ({ aiOverrides: { ...s.aiOverrides, [id]: { ...s.aiOverrides[id], ...override } } }))
    persistSettings(get())
  },

  setShortcut: (action, key) => {
    set((s) => ({ shortcuts: { ...s.shortcuts, [action]: key } }))
    persistSettings(get())
  },

  resetShortcut: (action) => {
    set((s) => ({ shortcuts: { ...s.shortcuts, [action]: DEFAULT_SHORTCUTS[action] } }))
    persistSettings(get())
  },

  resetSettings: () => {
    set({ ...DEFAULTS })
    persistSettings(get())
  },
}))
