import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../stores/playerStore'
import { useSubtitleStore } from '../stores/subtitleStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useScreenshot } from './useScreenshot'

/**
 * Player keyboard shortcuts. Keybindings are read from settingsStore.shortcuts
 * (#2 可配置), so editing a shortcut in Settings re-binds immediately:
 * `shortcuts` is an effect dep, and every keypress reads the live map via
 * getState() — no stale `[]` closure, no manual re-subscribe needed.
 */
export function useKeyboardShortcuts() {
  const { takeSnapshot } = useScreenshot()
  // Ref to avoid stale closure
  const takeSnapshotRef = useRef(takeSnapshot)
  takeSnapshotRef.current = takeSnapshot

  const shortcuts = useSettingsStore((s) => s.shortcuts)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is typing in an input
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      const sc = useSettingsStore.getState().shortcuts
      const player = usePlayerStore.getState()
      const subtitle = useSubtitleStore.getState()
      const key = e.key.toLowerCase()

      // Only intercept keys that are actually configured — never hijack typing keys.
      if (!Object.values(sc).includes(key)) return

      switch (key) {
        case sc.playPause:
          e.preventDefault()
          if (player.isPlaying) player.pause()
          else player.play()
          break

        case sc.seekBack5:
          e.preventDefault()
          player.seek(Math.max(0, player.currentTime - 5))
          break

        case sc.seekFwd5:
          e.preventDefault()
          player.seek(Math.min(player.duration, player.currentTime + 5))
          break

        case sc.toggleBlocker:
          e.preventDefault()
          subtitle.toggleBlocker()
          break

        case sc.lockBlocker:
          e.preventDefault()
          subtitle.setBlockerLocked(!subtitle.blockerLocked)
          break

        case sc.resetBlocker:
          e.preventDefault()
          subtitle.resetBlocker()
          break

        case sc.takeScreenshot:
          e.preventDefault()
          // Take screenshot (only if video is loaded)
          if (player.videoSrc) {
            takeSnapshotRef.current()
          }
          break

        case sc.fullscreen:
          e.preventDefault()
          player.toggleFullscreen()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts])
}
