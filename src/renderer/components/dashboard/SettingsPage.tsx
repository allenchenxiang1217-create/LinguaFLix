import { useState } from 'react'
import {
  Sparkles, Palette, Gauge, Database, Check, Eye, EyeOff, Sun, Moon, Loader2, Download,
  Eraser, RotateCcw, Terminal, Keyboard, BookOpen,
} from 'lucide-react'
import {
  useSettingsStore, type UILanguage, type SubtitleSize, type ThemeMode, type DictMode,
  type ShortcutAction, SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, formatShortcutKey,
} from '../../stores/settingsStore'
import { AI_PROVIDERS, getProvider, normalizeBaseUrl } from '../../services/ai-providers'
import { clearGlossCache } from '../../services/dict-gloss'
import { useVocabularyStore } from '../../stores/vocabularyStore'
import { useI18n } from '../../i18n/useI18n'

/** accent 主色预设（与 globals.css [data-accent] 对应，blue 为默认沿用现有 token）。 */
const THEMES = [
  { id: 'blue',   color: '#0071e3' },
  { id: 'purple', color: '#7c5cf0' },
  { id: 'green',  color: '#0d8546' },
  { id: 'orange', color: '#ff9500' },
  { id: 'red',    color: '#ff453a' },
  { id: 'teal',   color: '#30b0c7' },
]

const SUBTITLE_FONT: Record<SubtitleSize, string> = {
  sm: 'clamp(13px, 2.2vw, 20px)',
  md: 'clamp(15px, 2.8vw, 24px)',
  lg: 'clamp(18px, 3.4vw, 30px)',
}

const SCALES = [0.9, 1, 1.1, 1.2]
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

// ── 小型子组件 ──

function Section({ icon: Icon, title, hint, children }: {
  icon: typeof Sparkles
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border/50 bg-card/60 p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary grid place-items-center">
          <Icon size={15} />
        </span>
        <div>
          <h2 className="text-[0.9375rem] font-semibold tracking-tight text-foreground">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground/70 mt-0.5">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <p className="text-[0.8125rem] font-medium text-foreground">{label}</p>
        {hint && <p className="text-[0.6875rem] text-muted-foreground/60">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

const inputCls = 'h-9 w-full px-3 rounded-[10px] bg-background/50 border border-border/60 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-colors'

/** 分段选择器（语言 / 缩放 / 倍速 / 字号通用）。 */
function Seg<T extends string | number>({ options, value, onChange, formatter }: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  formatter?: (v: T) => string
}) {
  return (
    <div className="inline-flex p-1 gap-0.5 rounded-[10px] bg-foreground/6 border border-border">
      {options.map((o) => (
        <button
          key={String(o)}
          onClick={() => onChange(o)}
          className={`h-8 px-3 rounded-lg text-[0.8125rem] font-medium transition-colors cursor-pointer ${
            value === o
              ? 'bg-foreground/12 text-foreground font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {formatter ? formatter(o) : String(o)}
        </button>
      ))}
    </div>
  )
}

/** #2 单个快捷键编辑器：点击按钮后捕获下一次按键，Esc 恢复默认。 */
function ShortcutRow({ action, label }: { action: ShortcutAction; label: string }) {
  const { t } = useI18n()
  const shortcut = useSettingsStore((s) => s.shortcuts[action])
  const setShortcut = useSettingsStore((s) => s.setShortcut)
  const resetShortcut = useSettingsStore((s) => s.resetShortcut)
  const [capturing, setCapturing] = useState(false)

  const handleCapture = () => {
    if (capturing) return
    setCapturing(true)
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // 纯修饰键不绑定（组合键需要用户真的按一个普通键）。
      const k = e.key.toLowerCase()
      if (['shift', 'ctrl', 'alt', 'meta', 'capslock', 'tab'].includes(k)) return
      if (e.key === 'Escape') {
        resetShortcut(action)
      } else {
        setShortcut(action, k === ' ' ? ' ' : k)
      }
      setCapturing(false)
      window.removeEventListener('keydown', onKey, true)
    }
    window.addEventListener('keydown', onKey, true)
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[0.8125rem] font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        {shortcut !== DEFAULT_SHORTCUTS[action] && (
          <button
            onClick={() => resetShortcut(action)}
            title={t('settings.shortcuts.resetAction')}
            className="p-1.5 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
          >
            <RotateCcw size={12} />
          </button>
        )}
        <button
          onClick={handleCapture}
          className={`h-8 min-w-[64px] px-3 rounded-lg border text-[0.8125rem] font-medium transition-colors cursor-pointer ${
            capturing
              ? 'border-primary/50 bg-primary/10 text-primary animate-pulse'
              : 'border-border/60 bg-background/50 text-foreground hover:border-border hover:bg-foreground/4'
          }`}
        >
          {capturing ? t('settings.shortcuts.pressKey') : formatShortcutKey(shortcut)}
        </button>
      </div>
    </div>
  )
}

/** 苹果设置风格迷你窗口预览（像素级粗略：红绿灯 + 侧栏 + 内容条）。 */
function MiniWin({ dark }: { dark: boolean }) {
  const c = dark
    ? { bg: '#131316', sidebar: '#1c1c1f', fg: '#f5f5f7', muted: '#a1a1a6', border: 'rgba(255,255,255,0.10)', bar: 'rgba(255,255,255,0.12)', barDim: 'rgba(255,255,255,0.07)' }
    : { bg: '#ffffff', sidebar: '#f5f5f7', fg: '#1d1d1f', muted: '#6e6e73', border: 'rgba(0,0,0,0.10)', bar: 'rgba(0,0,0,0.10)', barDim: 'rgba(0,0,0,0.05)' }
  return (
    <div className="rounded-[10px] overflow-hidden border" style={{ width: 148, height: 92, background: c.bg, borderColor: c.border }}>
      <div className="flex items-center gap-1 h-4 px-2" style={{ background: c.sidebar }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#ff5f57' }} />
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#febc2e' }} />
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#28c840' }} />
      </div>
      <div className="flex h-[calc(100%-16px)]">
        <div className="w-8 shrink-0 flex flex-col gap-1 p-1.5" style={{ background: c.sidebar }}>
          <span className="h-1.5 rounded-full w-5" style={{ background: c.fg }} />
          <span className="h-1.5 rounded-full w-4" style={{ background: c.bar }} />
          <span className="h-1.5 rounded-full w-4" style={{ background: c.bar }} />
          <span className="h-1.5 rounded-full w-4" style={{ background: c.bar }} />
        </div>
        <div className="flex-1 p-1.5 space-y-1.5">
          <span className="block h-2 rounded-full w-1/2" style={{ background: c.fg, opacity: 0.75 }} />
          <span className="block h-3.5 rounded-[4px] w-full" style={{ background: c.bar }} />
          <span className="block h-3.5 rounded-[4px] w-full" style={{ background: c.bar }} />
          <span className="block h-3.5 rounded-[4px] w-2/3" style={{ background: c.barDim }} />
        </div>
      </div>
    </div>
  )
}

function ModeCard({ dark, active, onSelect, label }: { dark: boolean; active: boolean; onSelect: () => void; label: string }) {
  return (
    <button
      onClick={onSelect}
      className={`relative rounded-xl p-2.5 transition-all cursor-pointer text-left
        ${active ? 'border-primary bg-primary/8' : 'border-border/60 hover:border-border hover:bg-foreground/4'}`}
      style={{ borderWidth: 1.5 }}
    >
      <div className="flex items-center justify-center py-2 bg-background/40 rounded-lg">
        <MiniWin dark={dark} />
      </div>
      <div className="flex items-center justify-between mt-2 px-0.5">
        <span className={`text-[0.8125rem] font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
        <span className={`w-5 h-5 rounded-full grid place-items-center ${active ? 'bg-primary' : 'bg-transparent border border-border'}`}>
          {active && <Check size={12} className="text-primary-foreground" />}
        </span>
      </div>
    </button>
  )
}

function ProviderCard({ id, name, color, cheap, custom, selected, onSelect }: {
  id: string
  name: string
  color: string
  cheap: boolean
  custom?: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`relative rounded-xl p-3 flex flex-col items-start gap-2 text-left transition-all cursor-pointer
        ${selected ? 'border-primary bg-primary/8' : custom ? 'border-dashed border-border/70 hover:border-border' : 'border-border/60 bg-background/40 hover:border-border hover:bg-foreground/4'}`}
    >
      {selected && <Check size={13} className="absolute top-2 right-2 text-primary" />}
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className={`text-[0.8125rem] font-medium ${selected ? 'text-foreground' : 'text-foreground/85'}`}>{name}</span>
      </span>
      {cheap && (
        <span className="text-[0.625rem] font-bold px-1.5 py-0.5 rounded-md bg-success/10 text-success">¥</span>
      )}
    </button>
  )
}

// ── 主组件 ──

export function SettingsPage() {
  const { t } = useI18n()
  const { aiProvider, aiModel, aiOverrides, language, themeMode, theme, uiScale, subtitleSize, defaultPlaybackRate, dictMode } = useSettingsStore()
  const setSetting = useSettingsStore((s) => s.setSetting)
  const setAiOverride = useSettingsStore((s) => s.setAiOverride)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  const resetSettings = useSettingsStore((s) => s.resetSettings)

  const words = useVocabularyStore((s) => s.words)

  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg?: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const provider = getProvider(aiProvider)
  const override = aiOverrides[provider.id] ?? {}

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2500)
  }

  const testConnection = async () => {
    setTestResult(null)
    if (!override.apiKey) { setTestResult({ ok: false, msg: t('ai.needKey') }); return }
    if (!aiModel.trim()) { setTestResult({ ok: false, msg: t('ai.needModel') }); return }
    setTesting(true)
    try {
      const baseUrl = normalizeBaseUrl(override.baseUrl || provider.baseUrl)
      const url = provider.type === 'anthropic' ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (provider.type === 'anthropic') {
        headers['x-api-key'] = override.apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers['Authorization'] = `Bearer ${override.apiKey}`
      }
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: aiModel.trim(), max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        signal: AbortSignal.timeout(8000),
      })
      setTestResult(res.ok ? { ok: true } : { ok: false, msg: `HTTP ${res.status}` })
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message || String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(words, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `linguaflix-vocabulary-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast(t('settings.data.exported'))
  }

  const handleClearGloss = () => {
    clearGlossCache()
    showToast(t('settings.data.clearGlossed'))
  }

  const handleReset = () => {
    if (!window.confirm(t('settings.data.resetConfirm'))) return
    resetSettings()
    showToast(t('settings.data.resetDone'))
  }

  const providerLabel = (p: (typeof AI_PROVIDERS)[number]) =>
    p.id === 'custom' ? t('settings.ai.custom') : p.name

  return (
    <div className="space-y-8">
      {/* 页头 */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{t('settings.title')}</h2>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">{t('settings.subtitle')}</p>
      </div>

      {/* ── 快捷键 (#5 置顶) ── */}
      <Section icon={Keyboard} title={t('settings.section.shortcuts')} hint={t('settings.shortcuts.hint')}>
        <div className="space-y-2.5">
          {SHORTCUT_ACTIONS.map((a) => (
            <ShortcutRow key={a} action={a} label={t(`settings.shortcuts.${a}`)} />
          ))}
        </div>
      </Section>

      {/* ── AI 接口 ── */}
      <Section icon={Sparkles} title={t('settings.section.ai')}>
        <div className="space-y-5">
          <Field label={t('settings.ai.provider')} hint={t('settings.ai.providerHint')}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {AI_PROVIDERS.map((p) => (
                <ProviderCard
                  key={p.id}
                  id={p.id}
                  name={providerLabel(p)}
                  color={p.color}
                  cheap={p.cheap}
                  custom={p.id === 'custom'}
                  selected={aiProvider === p.id}
                  onSelect={() => { setSetting('aiProvider', p.id); setTestResult(null) }}
                />
              ))}
            </div>
          </Field>

          <Field label={t('settings.ai.model')} hint={t('settings.ai.modelHint')}>
            <input
              className={inputCls}
              value={aiModel}
              onChange={(e) => setSetting('aiModel', e.target.value)}
              placeholder={t('settings.ai.modelPh')}
              spellCheck={false}
            />
          </Field>

          <Field label={t('settings.ai.apiKey')}>
            <div className="relative">
              <input
                className={`${inputCls} pr-10`}
                type={showKey ? 'text' : 'password'}
                value={override.apiKey ?? ''}
                onChange={(e) => setAiOverride(provider.id, { apiKey: e.target.value })}
                placeholder={t('settings.ai.apiKeyPh')}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
                aria-label={showKey ? t('settings.ai.hideKey') : t('settings.ai.showKey')}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          <Field label={t('settings.ai.baseUrl')} hint={provider.id === 'custom' ? t('settings.ai.baseUrlPh') : t('settings.ai.baseUrlHint')}>
            <input
              className={inputCls}
              value={override.baseUrl ?? ''}
              onChange={(e) => setAiOverride(provider.id, { baseUrl: e.target.value })}
              placeholder={provider.baseUrl || t('settings.ai.baseUrlPh')}
              spellCheck={false}
            />
          </Field>

          <div className="flex items-center gap-3">
            <button
              onClick={testConnection}
              disabled={testing}
              className="h-9 px-4 rounded-[10px] bg-primary hover:bg-primary-hover active:scale-[0.98] text-white text-sm font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Terminal size={14} />}
              {testing ? t('settings.ai.testing') : t('settings.ai.test')}
            </button>
            {testResult && (
              <span className={`text-xs flex items-center gap-1.5 ${testResult.ok ? 'text-success' : 'text-destructive/80'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${testResult.ok ? 'bg-success' : 'bg-destructive'}`} />
                {testResult.ok ? t('settings.ai.testOk') : t('settings.ai.testFail', { msg: testResult.msg ?? '' })}
              </span>
            )}
          </div>
        </div>
      </Section>

      {/* ── 外观 ── */}
      <Section icon={Palette} title={t('settings.section.appearance')}>
        <div className="space-y-6">
          {/* 外观模式：苹果双预览卡 */}
          <div>
            <div className="flex items-baseline gap-2 mb-3">
              <p className="text-[0.8125rem] font-medium text-foreground">{t('settings.appearance.mode')}</p>
              <p className="text-[0.6875rem] text-muted-foreground/60">{t('settings.appearance.modeHint')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 max-w-sm">
              <ModeCard
                dark
                active={themeMode === 'dark'}
                onSelect={() => setSetting('themeMode', 'dark' as ThemeMode)}
                label={t('settings.appearance.dark')}
              />
              <ModeCard
                dark={false}
                active={themeMode === 'light'}
                onSelect={() => setSetting('themeMode', 'light' as ThemeMode)}
                label={t('settings.appearance.light')}
              />
            </div>
          </div>

          {/* 界面语言 */}
          <Field label={t('settings.appearance.language')} hint={t('settings.appearance.languageHint')}>
            <Seg<UILanguage>
              options={['zh', 'en']}
              value={language}
              onChange={setLanguage}
              formatter={(v) => (v === 'zh' ? '中文' : 'English')}
            />
          </Field>

          {/* 主题颜色 */}
          <Field label={t('settings.appearance.accent')}>
            <div className="flex items-center gap-2.5">
              {THEMES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSetting('theme', c.id)}
                  title={t(`settings.appearance.color.${c.id}`)}
                  aria-label={t(`settings.appearance.color.${c.id}`)}
                  className={`w-8 h-8 rounded-full grid place-items-center transition-all cursor-pointer ${
                    theme === c.id ? 'ring-2 ring-offset-2 ring-offset-background' : 'hover:scale-110'
                  }`}
                  style={{ background: c.color, ...(theme === c.id ? { boxShadow: `0 0 0 2px ${c.color}` } : {}) }}
                >
                  {theme === c.id && <Check size={14} className="text-white" />}
                </button>
              ))}
            </div>
          </Field>

          {/* 全局缩放 */}
          <Field label={t('settings.appearance.scale')} hint={t('settings.appearance.scaleHint')}>
            <Seg<number>
              options={SCALES}
              value={uiScale}
              onChange={(v) => setSetting('uiScale', v)}
              formatter={(v) => `${Math.round(v * 100)}%`}
            />
          </Field>

          {/* 字幕字号 + 预览 */}
          <Field label={t('settings.appearance.subtitle')} hint={t('settings.appearance.subtitleHint')}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <Seg<SubtitleSize>
                options={['sm', 'md', 'lg']}
                value={subtitleSize}
                onChange={(v) => setSetting('subtitleSize', v)}
                formatter={(v) => t(`settings.appearance.size.${v}`)}
              />
              <span
                className="px-3 py-1 rounded-lg text-center leading-relaxed font-medium tracking-wide text-white bg-black/60"
                style={{ fontSize: SUBTITLE_FONT[subtitleSize] }}
              >
                How are you today?
              </span>
            </div>
          </Field>
        </div>
      </Section>

      {/* ── 词典 (#3) ── */}
      <Section icon={BookOpen} title={t('settings.section.dict')}>
        <Field label={t('settings.dict.mode')} hint={t('settings.dict.modeHint')}>
          <Seg<DictMode>
            options={['online', 'offline']}
            value={dictMode}
            onChange={(v) => setSetting('dictMode', v)}
            formatter={(v) => t(`settings.dict.${v}`)}
          />
        </Field>
      </Section>

      {/* ── 播放 ── */}
      <Section icon={Gauge} title={t('settings.section.playback')}>
        <Field label={t('settings.playback.title')} hint={t('settings.playback.titleHint')}>
          <Seg<number>
            options={RATES}
            value={defaultPlaybackRate}
            onChange={(v) => setSetting('defaultPlaybackRate', v)}
            formatter={(v) => `${v}×`}
          />
        </Field>
      </Section>

      {/* ── 数据 ── */}
      <Section icon={Database} title={t('settings.section.data')}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={handleExport}
            className="rounded-xl border border-border/60 bg-background/40 hover:border-border hover:bg-foreground/4 p-4 text-left transition-colors cursor-pointer group"
          >
            <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary grid place-items-center mb-2 group-hover:bg-primary/20 transition-colors">
              <Download size={15} />
            </span>
            <p className="text-[0.8125rem] font-semibold text-foreground">{t('settings.data.export')}</p>
            <p className="mt-0.5 text-[0.6875rem] text-muted-foreground/70 leading-relaxed">{t('settings.data.exportHint')}</p>
          </button>

          <button
            onClick={handleClearGloss}
            className="rounded-xl border border-border/60 bg-background/40 hover:border-border hover:bg-foreground/4 p-4 text-left transition-colors cursor-pointer group"
          >
            <span className="w-8 h-8 rounded-lg bg-warning/10 text-warning grid place-items-center mb-2 group-hover:bg-warning/20 transition-colors">
              <Eraser size={15} />
            </span>
            <p className="text-[0.8125rem] font-semibold text-foreground">{t('settings.data.clearGloss')}</p>
            <p className="mt-0.5 text-[0.6875rem] text-muted-foreground/70 leading-relaxed">{t('settings.data.clearGlossHint')}</p>
          </button>

          <button
            onClick={handleReset}
            className="rounded-xl border border-border/60 bg-background/40 hover:border-destructive/40 hover:bg-destructive/5 p-4 text-left transition-colors cursor-pointer group"
          >
            <span className="w-8 h-8 rounded-lg bg-destructive/10 text-destructive grid place-items-center mb-2 group-hover:bg-destructive/20 transition-colors">
              <RotateCcw size={15} />
            </span>
            <p className="text-[0.8125rem] font-semibold text-foreground">{t('settings.data.reset')}</p>
            <p className="mt-0.5 text-[0.6875rem] text-muted-foreground/70 leading-relaxed">{t('settings.data.resetHint')}</p>
          </button>
        </div>
      </Section>

      {/* 侧栏快捷深浅色提示（仅图标，点击由 Dashboard 侧栏处理） */}
      <p className="text-[0.6875rem] text-muted-foreground/50 flex items-center gap-1.5">
        <Sun size={11} />
        <Moon size={11} />
        {t('settings.appearance.quickHint')}
      </p>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 glass-deep rounded-xl px-4 py-2.5 text-[0.8125rem] text-foreground animate-fade-in shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}
