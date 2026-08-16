import type { UILanguage } from '../stores/settingsStore'

/**
 * 共享 AI 词汇分析流式服务：AIVocabAnalysis（播放器笔记侧栏）与闪卡复习
 * （ReviewQueue）共用同一套 provider 流式解析，避免两处各自实现。
 */

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string

export interface StreamOptions {
  word: string
  sentence: string
  ctxBefore?: string
  ctxAfter?: string
  onChunk: (text: string) => void
  signal?: AbortSignal
  language?: UILanguage
  t?: TranslateFn
}

function hasElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI
}

/**
 * 核心流式调用。Web 模式把上游请求交给后端代理（Node 转发，绕开第三方 CORS）；
 * Electron 直连上游（保持原状，包装阶段再统一到后端）。两路返回的都是上游 SSE
 * 流，解析逻辑一致：OpenAI 读 choices[0].delta.content，Anthropic 读 delta.text。
 */
async function streamAi(
  type: 'openai' | 'anthropic',
  baseUrl: string,
  apiKey: string,
  model: string,
  opts: StreamOptions,
) {
  const { word, sentence, ctxBefore, ctxAfter, onChunk, signal, language, t } = opts
  const prompt = buildPrompt(word, sentence, ctxBefore || '', ctxAfter || '', language || 'en')

  const res = hasElectron()
    ? await fetchDirect(type, baseUrl, apiKey, model, prompt, signal)
    : await fetchProxy(type, baseUrl, apiKey, model, prompt, signal)

  if (!res.ok) {
    let detail: string | null = null
    try { const e = await res.json(); if (e?.error) detail = e.error } catch {}
    const fallback = type === 'anthropic'
      ? (t ? t('ai.claudeError', { status: res.status }) : `API error: ${res.status}`)
      : (t ? t('ai.openaiError', { status: res.status }) : `API error: ${res.status}`)
    throw new Error(detail || fallback)
  }

  const reader = res.body?.getReader(); if (!reader) return
  const d = new TextDecoder(); let b = ''
  const isAnthropic = type === 'anthropic'
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { done, value } = await reader.read(); if (done) break
    b += d.decode(value, { stream: true }); const lines = b.split('\n'); b = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      if (line.slice(6) === '[DONE]') return
      try {
        const p = JSON.parse(line.slice(6))
        if (isAnthropic) {
          if (p.type === 'content_block_delta') { const txt = p.delta?.text; if (txt) onChunk(txt) }
        } else {
          const c = p.choices?.[0]?.delta?.content; if (c) onChunk(c)
        }
      } catch {}
    }
  }
}

/** Electron：直连上游（OpenAI 兼容 /chat/completions 或 Anthropic /messages）。 */
async function fetchDirect(
  type: 'openai' | 'anthropic',
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<Response> {
  if (type === 'anthropic') {
    return fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: prompt }], stream: true }),
      signal,
    })
  }
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: true, max_tokens: 600, temperature: 0.7 }),
    signal,
  })
}

/** Web：同源后端代理（server /api/ai/stream 转发上游）。 */
async function fetchProxy(
  type: 'openai' | 'anthropic',
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch('/api/ai/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, baseUrl, apiKey, model, prompt }),
    signal,
  })
}

export function streamOpenAI(baseUrl: string, apiKey: string, model: string, opts: StreamOptions) {
  return streamAi('openai', baseUrl, apiKey, model, opts)
}

export function streamClaude(baseUrl: string, apiKey: string, model: string, opts: StreamOptions) {
  return streamAi('anthropic', baseUrl, apiKey, model, opts)
}

export function buildPrompt(word: string, sentence: string, ctxBefore: string, ctxAfter: string, lang: UILanguage): string {
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
