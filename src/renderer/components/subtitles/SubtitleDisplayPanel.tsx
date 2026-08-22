import { useSubtitleStore, type SubtitleDisplayMode } from '../../stores/subtitleStore'
import { Languages } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

const MODES: SubtitleDisplayMode[] = ['none', 'bilingual', 'english', 'chinese']

/**
 * 字幕语言显示模式面板。
 * 交互采用手机设置风格的「开关」：每一行一个 toggle，选中即亮起（滑块滑动到右侧）。
 * 四个模式互斥，同时只有一个是开启状态；「无字幕」即全部关闭。
 */
export function SubtitleDisplayPanel() {
  const { t } = useI18n()
  const displayMode = useSubtitleStore((s) => s.displayMode)
  const setDisplayMode = useSubtitleStore((s) => s.setDisplayMode)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1 pb-1.5 border-b border-white/10 mb-1">
        <Languages size={12} className="text-white/50" />
        <span className="text-[0.6875rem] font-medium text-white/70">{t('subtitleDisplay.title')}</span>
      </div>

      {MODES.map((mode) => {
        const active = displayMode === mode
        const label =
          mode === 'none' ? t('subtitleDisplay.none')
          : mode === 'bilingual' ? t('subtitleDisplay.bilingual')
          : mode === 'english' ? t('subtitleDisplay.english')
          : t('subtitleDisplay.chinese')
        const hint =
          mode === 'none' ? t('subtitleDisplay.noneHint')
          : mode === 'bilingual' ? t('subtitleDisplay.bilingualHint')
          : mode === 'english' ? t('subtitleDisplay.englishHint')
          : t('subtitleDisplay.chineseHint')

        return (
          <button
            key={mode}
            data-testid={`subtitle-mode-${mode}`}
            onClick={() => setDisplayMode(mode)}
            className="flex items-center justify-between w-full px-1 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-left"
          >
            <div className="min-w-0">
              <div className="text-[0.75rem] font-medium text-white/85 leading-tight">{label}</div>
              <div className="text-[0.5625rem] text-white/40 leading-snug mt-0.5">{hint}</div>
            </div>

            {/* 手机设置风格开关：开启时轨道亮起、滑块滑到右侧 */}
            <span
              className={`relative inline-flex w-9 h-5 shrink-0 rounded-full transition-colors duration-200 cursor-pointer
                ${active ? 'bg-primary' : 'bg-white/15'}`}
              aria-hidden="true"
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-md
                  transition-transform duration-200 ease-out
                  ${active ? 'translate-x-4' : 'translate-x-0'}`}
              />
            </span>
          </button>
        )
      })}
    </div>
  )
}
