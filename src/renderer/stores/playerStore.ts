import { create } from 'zustand'

interface PlayerState {
  isPlaying: boolean
  isFullscreen: boolean
  currentTime: number
  duration: number
  playbackRate: number
  volume: number
  videoSrc: string | null
  videoHash: string | null
  videoRef: HTMLVideoElement | null
  /** 视频容器元素——全屏时对其 requestFullscreen（#3）。 */
  containerRef: HTMLDivElement | null
  /** 从词库/笔记跳到某个时间戳：播放器就绪后应用并清空（避开加载归零）。 */
  pendingSeekTime: number | null
}

interface PlayerActions {
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setPlaybackRate: (rate: number) => void
  setVolume: (vol: number) => void
  loadVideo: (src: string, hash: string) => void
  setVideoRef: (ref: HTMLVideoElement | null) => void
  setContainerRef: (ref: HTMLDivElement | null) => void
  clearVideo: () => void
  play: () => void
  pause: () => void
  seek: (time: number) => void
  setPendingSeekTime: (time: number | null) => void
  /** #3 全屏：对视频容器 requestFullscreen / 退出；isFullscreen 立即置位，fullscreenchange 兜底校准。 */
  setFullscreen: (fs: boolean) => void
  toggleFullscreen: () => void
}

export const usePlayerStore = create<PlayerState & PlayerActions>((set, get) => ({
  isPlaying: false,
  isFullscreen: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  volume: 1,
  videoSrc: null,
  videoHash: null,
  videoRef: null,
  containerRef: null,
  pendingSeekTime: null,

  setCurrentTime: (time) => set({ currentTime: time }),

  setDuration: (duration) => set({ duration }),

  setPlaybackRate: (rate) => {
    const { videoRef } = get()
    if (videoRef) videoRef.playbackRate = rate
    set({ playbackRate: rate })
  },

  setVolume: (vol) => {
    const { videoRef } = get()
    if (videoRef) videoRef.volume = vol
    set({ volume: vol })
  },

  loadVideo: (src, hash) => set({ videoSrc: src, videoHash: hash, currentTime: 0, duration: 0 }),

  clearVideo: () => set({ videoSrc: null, videoHash: null, isPlaying: false, currentTime: 0, duration: 0, pendingSeekTime: null }),

  setVideoRef: (ref) => set({ videoRef: ref }),

  setContainerRef: (ref) => set({ containerRef: ref }),

  setPendingSeekTime: (time) => set({ pendingSeekTime: time }),

  setFullscreen: (fs) => {
    const el = get().containerRef
    if (fs && !document.fullscreenElement) el?.requestFullscreen?.().catch(() => {})
    else if (!fs && document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    // 乐观置位；native fullscreenchange 事件会再校准一次（Escape 退出、请求失败等）。
    set({ isFullscreen: fs })
  },

  toggleFullscreen: () => get().setFullscreen(!get().isFullscreen),

  play: () => {
    const { videoRef } = get()
    if (videoRef) videoRef.play()
    set({ isPlaying: true })
  },

  pause: () => {
    const { videoRef } = get()
    if (videoRef) videoRef.pause()
    set({ isPlaying: false })
  },

  seek: (time) => {
    const { videoRef } = get()
    if (videoRef) videoRef.currentTime = time
    set({ currentTime: time })
  },
}))
