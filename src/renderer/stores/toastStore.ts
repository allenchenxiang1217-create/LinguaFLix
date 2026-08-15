import { create } from 'zustand'

interface ToastState {
  message: string | null
  /** Show a transient toast message. Replaces any existing one. */
  showToast: (message: string, duration?: number) => void
}

let timer: ReturnType<typeof setTimeout> | null = null

export const useToastStore = create<ToastState>((set) => ({
  message: null,

  showToast: (message, duration = 2500) => {
    if (timer) clearTimeout(timer)
    set({ message })
    timer = setTimeout(() => set({ message: null }), duration)
  },
}))
