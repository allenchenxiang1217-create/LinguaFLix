import { useEffect, useRef, useState } from 'react'
import { apiCall } from './stream-resolver'
import { useSettingsStore } from '../stores/settingsStore'

/**
 * 生词释义拉取 + 缓存（跟随界面语言）。
 *
 * VocabWord 上没有持久化释义字段，这里按需查离线 ECDICT（lookupLocalDict 返回
 * data.zh / data.en 两个 EcdictSense[]），web 模式走 /api/dict/lookup 兜底。结果
 * 先写内存 Map，再落到 localStorage（linguaflix-gloss-v2）。一次查询同时拿到中英
 * /英英两套释义，切换界面语言时直接复用另一套、无需重新请求。
 */

interface EcdictSense { pos?: string; meanings: string[] }

/** 一个词的中英/英英两套释义（ECDICT 一次查询同时返回两者）。 */
interface GlossEntry { zh: string | null; en: string | null }

const CACHE_KEY = 'linguaflix-gloss-v2'

/** 会话级缓存：undefined = 未查过，GlossEntry = 释义（zh/en 可能为 null）。 */
const memCache = new Map<string, GlossEntry | undefined>()
let persistedLoaded = false

function ensurePersisted(): void {
  if (persistedLoaded) return
  persistedLoaded = true
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as Record<string, { zh?: unknown; en?: unknown }>
      for (const [k, v] of Object.entries(data)) {
        memCache.set(k.toLowerCase(), {
          zh: typeof v.zh === 'string' ? v.zh : null,
          en: typeof v.en === 'string' ? v.en : null,
        })
      }
    }
  } catch { /* ignore */ }
}

function persist(): void {
  try {
    const obj: Record<string, GlossEntry> = {}
    for (const [k, v] of memCache) if (v !== undefined) obj[k] = v
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj))
  } catch { /* ignore */ }
}

/** 提取第一个非空释义（各 sense 的 meanings 扁平化后取首条非空）。 */
function extractGloss(senses?: EcdictSense[] | null): string | null {
  if (!Array.isArray(senses) || senses.length === 0) return null
  for (const sense of senses) {
    for (const m of sense.meanings ?? []) {
      const clean = String(m).trim()
      if (clean) return clean
    }
  }
  return null
}

async function lookupGloss(key: string): Promise<GlossEntry> {
  const api = (window as any).electronAPI
  const empty: GlossEntry = { zh: null, en: null }
  try {
    let data: any = null
    if (api?.lookupLocalDict) {
      const r = await api.lookupLocalDict(key)
      if (!r.error && r.data) data = r.data
    } else {
      const r = await apiCall<any>(`/api/dict/lookup?word=${encodeURIComponent(key)}`)
      if (!r.error && r.data) data = r.data
    }
    if (!data) return empty
    return { zh: extractGloss(data.zh), en: extractGloss(data.en) }
  } catch {
    return empty
  }
}

/** 返回 undefined = 尚未查询；string|null = 已缓存的结果（null 表示无释义）。 */
export function getCachedGloss(word: string): string | null | undefined {
  ensurePersisted()
  const e = memCache.get(word.trim().toLowerCase())
  if (e === undefined) return undefined
  return e[useSettingsStore.getState().language]
}

/** 取一个词在当前界面语言下的释义（命中缓存立即返回，否则查询并写回缓存）。 */
export async function getGloss(word: string): Promise<string | null> {
  const key = word.trim().toLowerCase()
  if (!key) return null
  ensurePersisted()
  const cached = memCache.get(key)
  if (cached !== undefined) return cached[useSettingsStore.getState().language]
  const gloss = await lookupGloss(key)
  memCache.set(key, gloss)
  persist()
  return gloss[useSettingsStore.getState().language]
}

/** 清空全部释义缓存（内存 + localStorage），下次查询重新请求。 */
export function clearGlossCache(): void {
  memCache.clear()
  persistedLoaded = false
  try { localStorage.removeItem(CACHE_KEY) } catch { /* ignore */ }
}

/**
 * 给一批词批量解析当前界面语言下的释义。返回 { 小写词 → 释义|null }。
 * 缓存同时保存 zh+en，切换语言时直接用另一套即时重渲染，无需重新请求。
 */
export function useWordGlosses(words: string[]): Record<string, string | null> {
  const language = useSettingsStore((s) => s.language)
  const [, forceRender] = useState(0)
  const fetchedRef = useRef<Set<string>>(new Set())

  const keys = Array.from(new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean)))
  const keysKey = JSON.stringify(keys)

  useEffect(() => {
    ensurePersisted()
    const missing = keys.filter((k) => memCache.get(k) === undefined && !fetchedRef.current.has(k))
    if (missing.length === 0) return
    missing.forEach((k) => fetchedRef.current.add(k))
    Promise.all(
      missing.map(async (k) => {
        const g = await lookupGloss(k)
        memCache.set(k, g)
        return g
      }),
    ).then(() => {
      persist()
      forceRender((n) => n + 1)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysKey])

  const glosses: Record<string, string | null> = {}
  for (const k of keys) {
    const e = memCache.get(k)
    glosses[k] = e ? e[language] : null
  }
  return glosses
}
