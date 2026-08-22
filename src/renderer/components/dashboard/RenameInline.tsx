import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

/**
 * 视频重命名内联编辑：点击铅笔进入编辑态，回车/勾选保存，Esc/叉取消。
 * 用于视频库网格卡片与最近学习列表行。
 */
export function RenameInline({ initial, onSave, onCancel }: {
  initial: string
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== initial) onSave(trimmed)
    else onCancel()
  }

  return (
    <div
      className="flex items-center gap-1 min-w-0"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="textbox"
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={commit}
        maxLength={120}
        placeholder={t('dashboard.rename.placeholder')}
        className="flex-1 min-w-0 bg-black/30 border border-primary/40 rounded-md px-2 py-0.5
                   text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <button
        onClick={commit}
        onMouseDown={(e) => e.preventDefault() /* 防止 blur 先于点击触发 */}
        aria-label={t('dashboard.rename.save')}
        className="w-6 h-6 shrink-0 grid place-items-center rounded-md text-success hover:bg-success/10 transition-colors cursor-pointer"
      >
        <Check size={13} />
      </button>
      <button
        onClick={onCancel}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={t('dashboard.rename.cancel')}
        className="w-6 h-6 shrink-0 grid place-items-center rounded-md text-muted-foreground/60 hover:bg-white/10 transition-colors cursor-pointer"
      >
        <X size={13} />
      </button>
    </div>
  )
}
