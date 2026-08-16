import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

interface ConfirmDialogProps {
  open: boolean
  title?: string
  /** 提示正文；不传则渲染 children */
  message?: string
  /** 确认按钮文案（默认「删除」） */
  confirmLabel?: string
  /** 取消按钮文案（默认「取消」） */
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}

/**
 * 通用确认悬浮窗：窗口外背景为雾化玻璃（黑色半透明 + backdrop-blur）。
 * 用 createPortal 挂到 document.body——父级若有 backdrop-filter / transform，
 * 会成为 fixed 定位的包含块，把遮罩局限在局部，导致背景雾化失效。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
      {/* 雾化玻璃背景：点空白处关闭 */}
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-md animate-fade-in"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-[300px] rounded-2xl border border-border bg-popover shadow-2xl shadow-black/50 p-5 animate-fade-in"
      >
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-10 h-10 rounded-full bg-destructive/12 flex items-center justify-center">
            <AlertTriangle size={18} className="text-destructive" />
          </div>
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {message ?? children}
          </p>
          <div className="flex items-center gap-2 w-full mt-2">
            <button
              onClick={onCancel}
              className="flex-1 h-9 rounded-lg bg-secondary hover:bg-secondary/80 text-xs font-medium text-foreground border border-border/50 transition-colors cursor-pointer"
            >
              {cancelLabel || t('notes.confirm.cancel')}
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 h-9 rounded-lg bg-destructive hover:bg-destructive/90 text-xs font-semibold text-white transition-colors cursor-pointer"
            >
              {confirmLabel || t('notes.confirm.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
