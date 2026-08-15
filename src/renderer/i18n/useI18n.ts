import { useSettingsStore } from '../stores/settingsStore'
import { translations, type Lang } from './translations'

function lookup(lang: Lang, key: string): string {
  const parts = key.split('.')
  let node: any = translations[lang]
  for (const p of parts) {
    if (node == null) return key
    node = node[p]
  }
  return typeof node === 'string' ? node : key
}

export function useI18n() {
  const language = useSettingsStore((s) => s.language)
  const t = (key: string, vars?: Record<string, string | number>) => {
    let s = lookup(language, key)
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
    }
    return s
  }
  return { language, t }
}
