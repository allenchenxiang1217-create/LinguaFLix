import { useState, useCallback, useRef } from 'react'
import { X, Loader2, BookmarkPlus, Check, Sparkles, MessageSquare, Play } from 'lucide-react'
import { useSettingsStore, type UILanguage } from '../../stores/settingsStore'
import { useI18n } from '../../i18n/useI18n'
import { useVocabularyStore } from '../../stores/vocabularyStore'
import { useNoteStore } from '../../stores/noteStore'
import { usePlayerStore } from '../../stores/playerStore'
import { getProvider, normalizeBaseUrl } from '../../services/ai-providers'

interface AIVocabAnalysisProps {
  word: string
  sentence: string
  contextBefore: string
  contextAfter: string
  snapshotId?: string
  noteId?: string
  videoTimestamp?: number
  onClose: () => void
}

export function AIVocabAnalysis({
  word, sentence, contextBefore, contextAfter,
  snapshotId, noteId, videoTimestamp, onClose
}: AIVocabAnalysisProps) {
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [hasRun, setHasRun] = useState(false)

  const { aiProvider, aiModel, aiOverrides } = useSettingsStore()
  const language = useSettingsStore((s) => s.language)
  const { t } = useI18n()
  const addWord = useVocabularyStore((s) => s.addWord)
  const addWordToSnapshot = useNoteStore((s) => s.addWordToSnapshot)
  const videoHash = usePlayerStore((s) => s.videoHash)
  const abortRef = useRef<AbortController | null>(null)

  const analyze = useCallback(async () => {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort()

    setLoading(true); setError(null); setAnalysis(''); setHasRun(true)

    // 按选中服务商取覆盖值：Key 必填，模型名必填（不预设具体模型，用户自填）
    const p = getProvider(aiProvider)
    const ov = aiOverrides[p.id] ?? {}
    const apiKey = ov.apiKey ?? ''
    const baseUrl = normalizeBaseUrl(ov.baseUrl || p.baseUrl)
    if (!apiKey) { setError(t('ai.needKey')); setLoading(false); return }
    if (!aiModel.trim()) { setError(t('ai.needModel')); setLoading(false); return }

    const controller = new AbortController()
    abortRef.current = controller

    try {
      if (p.type === 'openai') {
        await streamOpenAI(baseUrl, apiKey, aiModel.trim(), word, sentence, contextBefore, contextAfter, (c) => setAnalysis(prev => prev + c), controller.signal, language, t)
      } else {
        await streamClaude(baseUrl, apiKey, aiModel.trim(), word, sentence, contextBefore, contextAfter, (c) => setAnalysis(prev => prev + c), controller.signal, language, t)
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || t('ai.failed'))
      }
    } finally {
      setLoading(false)
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [word, sentence, contextBefore, contextAfter, aiProvider, aiModel, aiOverrides, language, t])

  const handleSave = () => {
    const vocabWord = {
      word,
      contextSentence: sentence,
      snapshotId: snapshotId || '',
      noteId: noteId || '',
      videoHash: videoHash || '',
      videoTimestamp: videoTimestamp || 0,
      aiAnalysis: analysis,
    }
    // addWord 返回落库条目（真实 id）；快照副本复用同一 id，单词级批注才能同步。
    const stored = addWord(vocabWord)
    if (snapshotId) {
      addWordToSnapshot(snapshotId, stored)
    }
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden animate-fade-in bg-card/50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/30 bg-background/30">
        <div className="flex items-center gap-1.5">
          <Sparkles size={12} className="text-primary" />
          <span className="text-[0.6875rem] font-semibold text-foreground/80">{t('ai.title')}</span>
        </div>
        <div className="flex items-center gap-1">
          {analysis && (
            <button onClick={handleSave}
              className={`flex items-center gap-1 px-2 py-1 text-[0.625rem] font-semibold rounded-lg transition-all duration-200 cursor-pointer
                ${saved ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary hover:bg-primary/25'}`}>
              {saved ? <><Check size={10} /> {t('ai.saved')}</> : <><BookmarkPlus size={10} /> {t('ai.save')}</>}
            </button>
          )}
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary transition-colors cursor-pointer">
            <X size={12} className="text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Context preview */}
      <div className="px-3 py-2 bg-background/50 text-[0.625rem] space-y-1 border-b border-border/30">
        <div className="flex items-center gap-1.5 mb-1">
          <MessageSquare size={10} className="text-muted-foreground/40" />
          <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/50">{t('ai.context')}</span>
        </div>
        {contextBefore && <p className="text-muted-foreground/35 italic leading-relaxed">...{contextBefore}</p>}
        <p className="text-foreground/80 font-medium leading-relaxed">
          {sentence.split(' ').map((w, i) => {
            const clean = w.replace(/[^a-zA-Z'-]/g, '')
            return clean.toLowerCase() === word.toLowerCase()
              ? <span key={i} className="bg-primary/25 text-primary-foreground px-1 rounded font-bold">{w} </span>
              : <span key={i}>{w} </span>
          })}
        </p>
        {contextAfter && <p className="text-muted-foreground/35 italic leading-relaxed">{contextAfter}...</p>}
      </div>

      {/* Analysis content */}
      <div className="px-3 py-3">
        {!hasRun && !loading && (
          <button
            onClick={analyze}
            className="w-full flex items-center justify-center gap-2 py-2 text-[0.6875rem] font-semibold rounded-xl
                       bg-gradient-to-r from-primary/20 to-chart-3/20 hover:from-primary/30 hover:to-chart-3/30
                       border border-primary/20 text-primary transition-all duration-200 cursor-pointer"
          >
            <Play size={12} /> {t('ai.analyze', { word })}
          </button>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
            <Loader2 size={13} className="animate-spin text-primary" />
            {t('ai.analyzing', { word })}
          </div>
        )}

        {analysis && (
          <div className="text-[0.6875rem] text-foreground/85 leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto
                          prose prose-sm prose-invert max-w-none
                          [&_strong]:text-foreground [&_strong]:font-semibold
                          [&_em]:text-foreground/60
                          [&_ul]:pl-3 [&_li]:text-muted-foreground [&_li]:my-0.5">
            {analysis}
          </div>
        )}

        {error && <p className="text-[0.6875rem] text-destructive/80">{error}</p>}
      </div>
    </div>
  )
}

// ── Streaming ──

async function streamOpenAI(baseUrl: string, apiKey: string, model: string, word: string, sentence: string, ctxBefore: string, ctxAfter: string, onChunk: (t: string) => void, signal?: AbortSignal, language?: UILanguage, t?: (key: string, vars?: Record<string, string | number>) => string) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: buildPrompt(word, sentence, ctxBefore, ctxAfter, language || 'en') }], stream: true, max_tokens: 600, temperature: 0.7 }),
    signal,
  })
  if (!res.ok) throw new Error(t ? t('ai.openaiError', { status: res.status }) : `API error: ${res.status}`)
  const reader = res.body?.getReader(); if (!reader) return
  const d = new TextDecoder(); let b = ''
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { done, value } = await reader.read(); if (done) break
    b += d.decode(value, { stream: true }); const lines = b.split('\n'); b = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      if (line.slice(6) === '[DONE]') return
      try { const c = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content; if (c) onChunk(c) } catch {}
    }
  }
}

async function streamClaude(baseUrl: string, apiKey: string, model: string, word: string, sentence: string, ctxBefore: string, ctxAfter: string, onChunk: (t: string) => void, signal?: AbortSignal, language?: UILanguage, t?: (key: string, vars?: Record<string, string | number>) => string) {
  const res = await fetch(`${baseUrl}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: buildPrompt(word, sentence, ctxBefore, ctxAfter, language || 'en') }], stream: true }),
    signal,
  })
  if (!res.ok) throw new Error(t ? t('ai.claudeError', { status: res.status }) : `API error: ${res.status}`)
  const reader = res.body?.getReader(); if (!reader) return
  const d = new TextDecoder(); let b = ''
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { done, value } = await reader.read(); if (done) break
    b += d.decode(value, { stream: true }); const lines = b.split('\n'); b = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try { const p = JSON.parse(line.slice(6)); if (p.type === 'content_block_delta') { const t = p.delta?.text; if (t) onChunk(t) } } catch {}
    }
  }
}

function buildPrompt(word: string, sentence: string, ctxBefore: string, ctxAfter: string, lang: UILanguage): string {
  const ctx = []
  if (ctxBefore) ctx.push(lang === 'zh' ? `上一句："${ctxBefore}"` : `Previous: "${ctxBefore}"`)
  ctx.push(lang === 'zh' ? `当前句："${sentence}"` : `Current: "${sentence}"`)
  if (ctxAfter) ctx.push(lang === 'zh' ? `下一句："${ctxAfter}"` : `Next: "${ctxAfter}"`)

  if (lang === 'zh') {
    return `你是一位专业的英语老师。请分析视频字幕句子中出现的单词 **"${word}"**：

${ctx.join('\n')}

请说明：
1. **"${word}"** 在此语境下的具体含义
2. 说话者为什么选这个词——它带来了什么语气或细微差别
3. 1-2 个常见搭配或相近表达

用中文回答，简洁（3-5 句），语气自然、适合初学者，重点说明学习者在正确使用这个词时需要理解什么。`
  }

  return `You are an expert English teacher. Analyze the word **"${word}"** in this sentence from a video:

${ctx.join('\n')}

Explain:
1. The specific meaning of **"${word}"** in this context
2. Why the speaker chose this word — what nuance or tone does it add
3. 1-2 common collocations or similar expressions

Be concise (3-5 sentences), natural tone, beginner-friendly. Focus on what a learner needs to understand to USE this word correctly.`
}
