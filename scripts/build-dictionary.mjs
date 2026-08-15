#!/usr/bin/env node
/**
 * Build a compact offline dictionary (resources/ecdict.db) from the ECDICT CSV.
 *
 * ECDICT (https://github.com/skywind3000/ECDICT) is CC-BY-SA licensed. Its full
 * CSV (~63MB, ~770k headwords) is downloaded once, then filtered down to just the
 * exam-tagged headwords (tag != '' → zk/gk/cet4/cet6/ky/toefl/ielts/gre) — ~15k
 * words instead of 770k — and the bulky columns we don't need are dropped
 * (pos/collins/oxford/bnc/frq/detail/audio). This shrinks the bundled DB from
 * ~94MB to a few MB. The trimmed DB serves as the *offline fallback* only; the
 * primary lookup path is online (有道 / dictionaryapi.dev).
 *
 * Usage: node scripts/build-dictionary.mjs [path-to-ecdict.csv]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CSV_URL = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'
const CACHE_DIR = join(__dirname, '.cache')
const CSV_PATH = join(CACHE_DIR, 'ecdict.csv')
const OUT_DB = join(ROOT, 'resources', 'ecdict.db')

// ── Streaming CSV parser ─────────────────────────────────────────────────────
// Handles quoted fields containing commas, escaped "" and — crucially — embedded
// newlines (the `detail` column of some rows is multi-line). Yields one array of
// fields per record.
function* parseCsv(text) {
  let field = ''
  let record = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } // escaped quote
        else inQuotes = false
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      record.push(field)
      field = ''
    } else if (c === '\n') {
      record.push(field)
      field = ''
      if (record.length) yield record
      record = []
    } else if (c === '\r') {
      /* ignore CR (CRLF line endings) */
    } else {
      field += c
    }
  }
  record.push(field)
  if (record.length) yield record
}

// ECDICT escapes literal newlines as the two chars "\n" inside translation/definition.
const unescapeNl = (s) => (s || '').replace(/\\n/g, '\n')

async function main() {
  let text
  const argPath = process.argv[2]
  if (argPath) {
    text = readFileSync(argPath, 'utf-8')
    console.log('Using provided CSV:', argPath)
  } else if (existsSync(CSV_PATH)) {
    text = readFileSync(CSV_PATH, 'utf-8')
    console.log('Using cached CSV:', CSV_PATH)
  } else {
    mkdirSync(CACHE_DIR, { recursive: true })
    console.log('Downloading ECDICT CSV (~63MB)...')
    const res = await fetch(CSV_URL)
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(CSV_PATH, buf)
    text = buf.toString('utf-8')
    console.log('Downloaded', buf.length, 'bytes')
  }

  if (existsSync(OUT_DB)) rmSync(OUT_DB)

  const db = new DatabaseSync(OUT_DB)
  db.exec('PRAGMA journal_mode = OFF')
  db.exec('PRAGMA synchronous = OFF')
  db.exec(`CREATE TABLE entries (
    key         TEXT PRIMARY KEY,   -- lowercased headword (lookup key)
    word        TEXT,               -- original headword
    phonetic    TEXT,
    definition  TEXT,               -- English definitions (WordNet-style)
    translation TEXT,               -- Chinese translation
    exchange    TEXT,               -- inflected/derived forms
    tag         TEXT                -- exam tags: cet4/cet6/toefl/ielts/gre/zk/gk/ky
  )`)
  const ins = db.prepare(
    'INSERT OR IGNORE INTO entries (key, word, phonetic, definition, translation, exchange, tag) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )

  let count = 0
  let rows = 0
  db.exec('BEGIN')
  for (const f of parseCsv(text)) {
    rows++
    if (rows === 1 && f[0] === 'word') continue // header row
    if (f.length < 11) continue
    const word = f[0]
    if (!word) continue
    // 只保留考试词汇（tag 非空）。全量 77 万词里 98% 是生僻词/专有名词/地名，
    // 学习场景用不到；过滤后 ~1.5 万词，DB 从 94MB 压到几 MB，离线兜底足够。
    if (!(f[7] || '').trim()) continue
    ins.run(word.toLowerCase(), word, f[1], unescapeNl(f[2]), unescapeNl(f[3]), f[10], f[7])
    count++
  }
  db.exec('COMMIT')
  db.exec('ANALYZE')

  const total = db.prepare('SELECT COUNT(*) AS c FROM entries').get().c
  console.log(`Parsed ${rows} rows, inserted ${count} entries, total ${total} -> ${OUT_DB}`)

  // Sanity-check a couple of common words.
  for (const w of ['cat', 'run', 'good', 'abandon']) {
    const r = db.prepare('SELECT word, phonetic, translation FROM entries WHERE key = ?').get(w)
    console.log(`  [${w}]`, r ? `"${r.word}" /${r.phonetic}/ ${(r.translation || '').split('\n')[0]}` : 'NOT FOUND')
  }
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
