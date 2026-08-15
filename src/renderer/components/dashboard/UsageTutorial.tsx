import { useState } from 'react'
import { BookOpen, ChevronDown } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

// ── In-app usage guide (mirrors USAGE.md). Rendered as a collapsible section
// at the top of the Dashboard so new users can get oriented without leaving
// the app or opening a browser.

function Section({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h4 className="flex items-center gap-2 text-sm font-bold text-foreground/90">
        <span className="w-5 h-5 rounded-md bg-primary/15 text-primary text-[0.6875rem] font-semibold flex items-center justify-center shrink-0">
          {num}
        </span>
        {title}
      </h4>
      <div className="pl-7 space-y-2.5 text-[0.8125rem] text-foreground/75 leading-relaxed">{children}</div>
    </section>
  )
}

function Table({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return (
    <div className="rounded-lg border border-border/40 overflow-hidden">
      <table className="w-full text-[0.75rem]">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} className={i % 2 ? 'bg-background/30' : 'bg-background/10'}>
              <td className="px-3 py-2 align-top font-medium text-foreground/80 whitespace-nowrap border-r border-border/30 w-1/3">{k}</td>
              <td className="px-3 py-2 align-top text-foreground/70">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-chart-3/25 bg-chart-3/8 px-3 py-2 text-[0.75rem] text-foreground/70 leading-relaxed">
      {children}
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="px-1.5 py-0.5 rounded bg-secondary text-[0.6875rem] font-mono font-semibold text-foreground/80 border border-border/40">{children}</kbd>
}

export function UsageTutorial() {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()

  return (
    <section className="rounded-2xl border border-border/50 bg-secondary/20 overflow-hidden">
      {/* Header / toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-secondary/30 transition-colors cursor-pointer"
      >
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-chart-3 flex items-center justify-center shrink-0">
          <BookOpen size={16} className="text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-foreground/90">{t('tutorial.title')}</h2>
          <p className="text-[0.6875rem] text-muted-foreground/60 mt-0.5">
            {open ? t('tutorial.open') : t('tutorial.closed')}
          </p>
        </div>
        <ChevronDown
          size={16}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Body */}
      {open && (
        <div className="px-5 pb-6 pt-1 border-t border-border/40 space-y-6 animate-fade-in">
          {/* Intro */}
          <p className="text-[0.8125rem] text-foreground/70 leading-relaxed">
            {t('tutorial.introA')}<b className="text-foreground/90">{t('tutorial.introBold')}</b>{t('tutorial.introB')}
          </p>

          <Section num="1" title={t('tutorial.s1.title')}>
            <p className="font-medium text-foreground/85">{t('tutorial.s1.dashboard')}</p>
            <Table
              rows={[
                [t('tutorial.s1.r1k'), t('tutorial.s1.r1v')],
                [t('tutorial.s1.r2k'), t('tutorial.s1.r2v')],
                [t('tutorial.s1.r3k'), <span key="1"><b>Continue</b> {t('tutorial.s1.r3vA')} · <b>Review</b> {t('tutorial.s1.r3vB')} · <b>New Video</b> {t('tutorial.s1.r3vC')}</span>],
                [t('tutorial.s1.r4k'), t('tutorial.s1.r4v')],
              ]}
            />
            <p className="font-medium text-foreground/85">{t('tutorial.s1.player')}</p>
            <pre className="rounded-lg bg-background/60 border border-border/30 p-3 text-[0.6875rem] font-mono text-foreground/70 overflow-x-auto leading-snug">{t('tutorial.s1.diagram')}</pre>
          </Section>

          <Section num="2" title={t('tutorial.s2.title')}>
            <p>{t('tutorial.s2.leadA')}<b>New Video</b>{t('tutorial.s2.leadB')}</p>
            <ol className="list-decimal list-outside pl-4 space-y-1">
              <li><b>{t('tutorial.s2.o1a')}</b>{t('tutorial.s2.o1b')}<code className="text-[0.6875rem] bg-background/60 px-1 rounded">Open Video File</code>{t('tutorial.s2.o1c')}</li>
              <li>
                <b>{t('tutorial.s2.o2a')}</b>{t('tutorial.s2.o2b')}<b>{t('tutorial.s2.o2c')}</b>{t('tutorial.s2.o2d')}<b>{t('tutorial.s2.o2e')}</b>{t('tutorial.s2.o2f')}<code className="text-[0.6875rem] bg-background/60 px-1 rounded">Install yt-dlp</code>{t('tutorial.s2.o2g')}
              </li>
              <li><b>{t('tutorial.s2.o3a')}</b>{t('tutorial.s2.o3b')}</li>
            </ol>
            <p className="text-foreground/60">{t('tutorial.s2.tipA')}<code className="text-[0.6875rem] bg-background/60 px-1 rounded">Change</code>{t('tutorial.s2.tipB')}<code className="text-[0.6875rem] bg-background/60 px-1 rounded">Subtitles</code>{t('tutorial.s2.tipC')}</p>
          </Section>

          <Section num="3" title={t('tutorial.s3.title')}>
            <ul className="list-disc list-outside pl-4 space-y-1">
              <li>{t('tutorial.s3.l1a')}<code className="text-[0.6875rem] bg-background/60 px-1 rounded">Load external subtitles (SRT/VTT)</code>{t('tutorial.s3.l1b')}<b>Subtitles</b>{t('tutorial.s3.l1c')}</li>
              <li>{t('tutorial.s3.l2a')}<code className="text-[0.6875rem] bg-background/60 px-1 rounded">.srt / .vtt / .ass / .ssa</code>{t('tutorial.s3.l2b')}</li>
              <li>{t('tutorial.s3.l3a')}<b>{t('tutorial.s3.l3zh')}</b>{t('tutorial.s3.l3b')}<b>{t('tutorial.s3.l3en')}</b>{t('tutorial.s3.l3c')}<b>Transcript</b>{t('tutorial.s3.l3d')}<b>{t('tutorial.s3.l3e')}</b>{t('tutorial.s3.l3f')}</li>
              <li>{t('tutorial.s3.l4a')}<b>Set OCR region</b>{t('tutorial.s3.l4b')}</li>
            </ul>
            <Note>{t('tutorial.s3.note')}</Note>
          </Section>

          <Section num="4" title={t('tutorial.s4.title')}>
            <p>{t('tutorial.s4.leadA')}<b>{t('tutorial.s4.leadBold')}</b>{t('tutorial.s4.leadB')}</p>
            <Table
              rows={[
                [t('tutorial.s4.r1k'), t('tutorial.s4.r1v')],
                [t('tutorial.s4.r2k'), t('tutorial.s4.r2v')],
                [<Kbd key="b">B</Kbd>, t('tutorial.s4.r3v')],
                [<Kbd key="l">L</Kbd>, t('tutorial.s4.r4v')],
                [<Kbd key="r">R</Kbd>, t('tutorial.s4.r5v')],
              ]}
            />
            <p className="font-medium text-foreground/85">{t('tutorial.s4.panel')}</p>
            <Table
              rows={[
                [t('tutorial.s4.p1k'), t('tutorial.s4.p1v')],
                [t('tutorial.s4.p2k'), t('tutorial.s4.p2v')],
                [t('tutorial.s4.p3k'), t('tutorial.s4.p3v')],
                [t('tutorial.s4.p4k'), t('tutorial.s4.p4v')],
                [t('tutorial.s4.p5k'), t('tutorial.s4.p5v')],
              ]}
            />
            <Note>{t('tutorial.s4.noteA')}<Kbd>R</Kbd>{t('tutorial.s4.noteB')}</Note>
          </Section>

          <Section num="5" title={t('tutorial.s5.title')}>
            <p className="font-medium text-foreground/85">{t('tutorial.s5.shot')}</p>
            <ul className="list-disc list-outside pl-4 space-y-1">
              <li>{t('tutorial.s5.l1a')}<Kbd>S</Kbd>{t('tutorial.s5.l1b')}</li>
              <li>{t('tutorial.s5.l2a')}<b>{t('tutorial.s5.l2b')}</b>{t('tutorial.s5.l2c')}</li>
              <li>{t('tutorial.s5.l3a')}<b>{t('tutorial.s5.l3b')}</b>{t('tutorial.s5.l3c')}</li>
              <li><b>{t('tutorial.s5.l4a')}</b>{t('tutorial.s5.l4b')}</li>
            </ul>
            <p className="font-medium text-foreground/85">{t('tutorial.s5.ocr')}</p>
            <ol className="list-decimal list-outside pl-4 space-y-1">
              <li>{t('tutorial.s5.o1a')}<b>{t('tutorial.s5.o1b')}</b>{t('tutorial.s5.o1c')}</li>
              <li>{t('tutorial.s5.o2a')}<b>Set OCR region</b>{t('tutorial.s5.o2b')}</li>
              <li>{t('tutorial.s5.o3')}</li>
              <li>{t('tutorial.s5.o4a')}<b>Save region</b>{t('tutorial.s5.o4b')}</li>
            </ol>
            <p className="font-medium text-foreground/85">{t('tutorial.s5.notes')}</p>
            <ul className="list-disc list-outside pl-4 space-y-1">
              <li>{t('tutorial.s5.n1a')}<b>{t('tutorial.s5.n1b')}</b>{t('tutorial.s5.n1c')}<b>{t('tutorial.s5.n1d')}</b>{t('tutorial.s5.n1e')}</li>
              <li>{t('tutorial.s5.n2a')}<b>{t('tutorial.s5.n2b')}</b>{t('tutorial.s5.n2c')}<b>{t('tutorial.s5.n2d')}</b>{t('tutorial.s5.n2e')}<b>Re-recognize area</b>{t('tutorial.s5.n2f')}</li>
              <li>{t('tutorial.s5.n3')}</li>
            </ul>
          </Section>

          <Section num="6" title={t('tutorial.s6.title')}>
            <ol className="list-decimal list-outside pl-4 space-y-1">
              <li>{t('tutorial.s6.o1')}</li>
              <li>{t('tutorial.s6.o2a')}<b>{t('tutorial.s6.o2b')}</b>{t('tutorial.s6.o2c')}<b>Save</b>{t('tutorial.s6.o2d')}<b>AI</b>{t('tutorial.s6.o2e')}</li>
              <li>{t('tutorial.s6.o3a')}<b>Saved Words</b>{t('tutorial.s6.o3b')}<b>Vocab</b>{t('tutorial.s6.o3c')}</li>
            </ol>
            <div>
              <p className="font-medium text-foreground/85 mb-1">{t('tutorial.s6.apiTitle')}</p>
              <pre className="rounded-lg bg-background/60 border border-border/30 p-3 text-[0.6875rem] font-mono text-foreground/70 overflow-x-auto leading-snug">{t('tutorial.s6.apiCode')}</pre>
              <p className="text-foreground/60 mt-1">{t('tutorial.s6.apiNote')}</p>
            </div>
          </Section>

          <Section num="7" title={t('tutorial.s7.title')}>
            <ul className="list-disc list-outside pl-4 space-y-1">
              <li><b>{t('tutorial.s7.l1a')}</b>{t('tutorial.s7.l1b')}</li>
              <li><b>{t('tutorial.s7.l2a')}</b>{t('tutorial.s7.l2b')}</li>
              <li>{t('tutorial.s7.l3')}</li>
            </ul>
          </Section>

          <Section num="8" title={t('tutorial.s8.title')}>
            <Table
              rows={[
                [<Kbd key="space">Space</Kbd>, t('tutorial.s8.r1v')],
                [<span key="l"><Kbd>←</Kbd> / <Kbd>→</Kbd></span>, t('tutorial.s8.r2v')],
                [<Kbd key="b">B</Kbd>, t('tutorial.s8.r3v')],
                [<Kbd key="l2">L</Kbd>, t('tutorial.s8.r4v')],
                [<Kbd key="r2">R</Kbd>, t('tutorial.s8.r5v')],
                [<Kbd key="s">S</Kbd>, t('tutorial.s8.r6v')],
              ]}
            />
            <p className="text-foreground/60">{t('tutorial.s8.tip')}</p>
          </Section>

          <Section num="9" title={t('tutorial.s9.title')}>
            <Table
              rows={[
                [t('tutorial.s9.r1k'), t('tutorial.s9.r1v')],
                [t('tutorial.s9.r2k'), t('tutorial.s9.r2v')],
                [t('tutorial.s9.r3k'), t('tutorial.s9.r3v')],
                [t('tutorial.s9.r4k'), t('tutorial.s9.r4v')],
                [t('tutorial.s9.r5k'), t('tutorial.s9.r5v')],
              ]}
            />
          </Section>
        </div>
      )}
    </section>
  )
}
