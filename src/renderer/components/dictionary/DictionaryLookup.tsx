import { useState, useEffect, useCallback } from 'react'
import type { DictionaryResult, ZhDictResult } from '@shared/types'
import { Volume2, Loader2, AlertCircle } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useI18n } from '../../i18n/useI18n'
import { apiCall } from '../../services/stream-resolver'

interface DictionaryLookupProps {
  word: string
}

/** Map ECDICT/WordNet part-of-speech abbreviations to full words for EN mode. */
function mapEnPos(pos?: string): string {
  switch (pos) {
    case 'n.': return 'noun'
    case 'v.': return 'verb'
    case 'a.': case 'adj.': case 's.': return 'adjective'
    case 'r.': case 'adv.': case 'ad.': return 'adverb'
    case 'prep.': return 'preposition'
    case 'conj.': return 'conjunction'
    case 'pron.': return 'pronoun'
    case 'interj.': case 'int.': return 'interjection'
    case 'num.': return 'numeral'
    case 'art.': return 'article'
    case 'aux.': return 'auxiliary'
    case 'vt.': return 'verb (transitive)'
    case 'vi.': return 'verb (intransitive)'
    case 'abbr.': return 'abbreviation'
    default: return pos || ''
  }
}

/** 在线查询超时（毫秒）：到点返回 null，避免断网/限流时释义长时间卡住（#3 崩溃根因之一）。 */
const ONLINE_TIMEOUT_MS = 4000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => { setTimeout(() => resolve(null), ms) }),
  ])
}

/** 有道中英在线（桌面走 IPC，web 走 /api/dict/zh 代理）。失败/超时返回 null，绝不抛出。 */
async function lookupZhOnline(word: string, api: any): Promise<ZhDictResult | null> {
  try {
    const r = await withTimeout((async () => {
      if (api?.lookupZhDict) {
        const res = await api.lookupZhDict(word)
        return (res.error || !res.data) ? null : res.data as ZhDictResult
      }
      const res = await apiCall<any>(`/api/dict/zh?word=${encodeURIComponent(word)}`)
      return (res.error || !res.data) ? null : res.data as ZhDictResult
    })(), ONLINE_TIMEOUT_MS)
    return r
  } catch {
    return null
  }
}

/** 英英在线（dictionaryapi.dev，CORS 偶发 → 桌面 IPC / web /api/dict/en 代理）。失败/超时返回 null。 */
async function lookupEnOnline(word: string, api: any): Promise<DictionaryResult | null> {
  try {
    const r = await withTimeout((async () => {
      if (api?.lookupEnDict) {
        const res = await api.lookupEnDict(word)
        return (res.error || !res.data) ? null : res.data as DictionaryResult
      }
      const res = await apiCall<any>(`/api/dict/en?word=${encodeURIComponent(word)}`)
      return (res.error || !res.data) ? null : res.data as DictionaryResult
    })(), ONLINE_TIMEOUT_MS)
    return r
  } catch {
    return null
  }
}

/** 合并中英：离线释义为主，叠加有道的例句（离线无例句列）与音标兜底。 */
function mergeZh(base: ZhDictResult, online: ZhDictResult | null): ZhDictResult {
  if (!online) return base
  return {
    word: base.word || online.word,
    phonetic: base.phonetic || online.phonetic,
    translations: base.translations,
    examples: online.examples?.length ? online.examples : base.examples,
  }
}

/** 合并英英：dictionaryapi.dev 结果严格更全（例句/近义词/发音），在线命中即整体采用。 */
function mergeEn(base: DictionaryResult, online: DictionaryResult | null): DictionaryResult {
  if (!online) return base
  return {
    word: online.word || base.word,
    phonetic: online.phonetic || base.phonetic,
    phonetics: online.phonetics?.length ? online.phonetics : [],
    meanings: online.meanings,
  }
}

export function DictionaryLookup({ word }: DictionaryLookupProps) {
  const language = useSettingsStore((s) => s.language)
  const dictMode = useSettingsStore((s) => s.dictMode)
  const { t } = useI18n()
  const [result, setResult] = useState<DictionaryResult | null>(null)
  const [zhResult, setZhResult] = useState<ZhDictResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lookup = useCallback(async (w: string) => {
    setLoading(true); setError(null); setResult(null); setZhResult(null)
    const api = (window as any).electronAPI
    // #3 离线模式：完全跳过在线服务，只查内置 ECDICT。
    const online = dictMode === 'online'
    try {
      // 1. Offline ECDICT (bundled SQLite, rich) — desktop (IPC) or web (HTTP backend).
      let local: any = null
      if (api?.lookupLocalDict) {
        const r = await api.lookupLocalDict(w)
        if (!r.error && r.data) local = r.data
      } else {
        try {
          const r = await apiCall<any>(`/api/dict/lookup?word=${encodeURIComponent(w)}`)
          if (!r.error && r.data) local = r.data
        } catch {
          local = null // backend unreachable → online
        }
      }

      if (local) {
        if (language === 'zh' && local.zh?.length) {
          // ① 离线中英先出（离线优先）
          const base: ZhDictResult = { word: local.word || w, phonetic: local.phonetic, translations: local.zh, examples: [] }
          setLoading(false); setZhResult(base)
          // ② 在线补全：有道例句/音标（离线模式跳过）
          if (online) setZhResult(mergeZh(base, await lookupZhOnline(w, api)))
          return
        }
        if (language === 'en' && local.en?.length) {
          // ① 离线英英先出（ECDICT definition 偏薄，仅作离线兜底）
          const base: DictionaryResult = {
            word: local.word || w,
            phonetic: local.phonetic,
            phonetics: [],
            meanings: local.en.map((s: any) => ({
              partOfSpeech: mapEnPos(s.pos),
              definitions: s.meanings.map((m: string) => ({ definition: m, synonyms: [] })),
            })),
          }
          setLoading(false); setResult(base)
          // ② 在线补全：dictionaryapi.dev 完整释义/例句/近义词/发音（离线模式跳过）
          if (online) setResult(mergeEn(base, await lookupEnOnline(w, api)))
          return
        }
        // Local hit but no senses for this language — fall through to online.
      }

      // 2. Online-only fallback (no usable offline senses). 离线模式：无离线释义即 not_found。
      if (language === 'zh') {
        const r = online ? await lookupZhOnline(w, api) : null
        if (!r) throw new Error('not_found')
        setZhResult(r)
      } else {
        const r = online ? await lookupEnOnline(w, api) : null
        if (!r) throw new Error('not_found')
        setResult(r)
      }
    } catch (err: any) {
      setError(err?.message === 'not_found' ? 'not_found' : 'failed')
    } finally { setLoading(false) }
  }, [language, dictMode])

  useEffect(() => { if (word) lookup(word) }, [word, lookup])

  if (loading) {
    return (
      <div className="p-4 flex items-center gap-2 text-xs text-muted-foreground animate-pulse-soft">
        <Loader2 size={13} className="animate-spin" /> {t('dict.lookingUp', { word })}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-bold text-foreground">{word}</span>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-destructive/80">
          <AlertCircle size={11} /> {t(error === 'not_found' ? 'dict.notFound' : 'dict.failed')}
        </p>
      </div>
    )
  }

  // ── 中英词典（中文界面） ──
  if (zhResult) {
    return (
      <div className="p-4 border-b border-border/30">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base font-bold text-foreground">{zhResult.word}</span>
          {zhResult.phonetic && <span className="text-[0.6875rem] text-muted-foreground/60">/{zhResult.phonetic}/</span>}
        </div>
        <div className="space-y-2.5">
          {zhResult.translations.map((tr, i) => (
            <div key={i}>
              {tr.pos && (
                <span className="inline-block text-[0.625rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md
                                 bg-primary/10 text-primary/80 mb-1.5">
                  {tr.pos}
                </span>
              )}
              <ul className="space-y-1.5">
                {tr.meanings.map((m, j) => (
                  <li key={j} className="text-[0.6875rem] text-muted-foreground leading-relaxed pl-2.5 border-l-2 border-border/50">
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {zhResult.examples && zhResult.examples.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/30 space-y-1.5">
            {zhResult.examples.map((ex, i) => (
              <div key={i}>
                <p className="text-[0.6875rem] text-foreground/80">{ex.en}</p>
                <p className="text-[0.625rem] text-muted-foreground/60">{ex.zh}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!result) return null

  // ── 英英词典（英文界面） ──
  return (
    <div className="p-4 border-b border-border/30">
      {/* Word + phonetic */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base font-bold text-foreground">{result.word}</span>
        {result.phonetic && <span className="text-[0.6875rem] text-muted-foreground/60">{result.phonetic}</span>}
        {result.phonetics?.[0]?.audio && (
          <button
            onClick={() => new Audio(result.phonetics[0].audio).play()}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors cursor-pointer text-primary/70"
          >
            <Volume2 size={14} />
          </button>
        )}
      </div>

      {/* Meanings */}
      <div className="space-y-2.5">
        {result.meanings?.slice(0, 3).map((meaning, mi) => (
          <div key={mi}>
            <span className="inline-block text-[0.625rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md
                             bg-primary/10 text-primary/80 mb-1.5">
              {meaning.partOfSpeech}
            </span>
            <ul className="space-y-1.5">
              {meaning.definitions.slice(0, 3).map((def, di) => (
                <li key={di} className="text-[0.6875rem] text-muted-foreground leading-relaxed pl-2.5 border-l-2 border-border/50">
                  <p>{def.definition}</p>
                  {def.example && <p className="text-[0.625rem] text-foreground/25 italic mt-0.5">"{def.example}"</p>}
                  {def.synonyms.length > 0 && (
                    <p className="text-[0.625rem] text-primary/50 mt-0.5">{t('dict.syn')}: {def.synonyms.slice(0, 5).join(', ')}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
