import { useToastStore } from '../stores/toastStore'
import { CheckCircle2 } from 'lucide-react'

/** Global transient toast (bottom-center, above the transcript bar). */
export function Toast() {
  const message = useToastStore((s) => s.message)
  if (!message) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-background/95 backdrop-blur-md
                      border border-success/30 text-sm text-foreground shadow-xl shadow-black/50 animate-fade-in">
        <CheckCircle2 size={14} className="text-success shrink-0" />
        {message}
      </div>
    </div>
  )
}
