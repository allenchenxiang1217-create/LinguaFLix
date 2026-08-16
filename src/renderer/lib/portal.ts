/**
 * Portal target that stays visible in fullscreen.
 *
 * `createPortal(..., document.body)` renders *behind* the fullscreen element,
 * because only the fullscreen element (and its descendants) are painted while
 * fullscreen is active. Anything portaled to <body> becomes invisible. Routing
 * the portal to the active fullscreen element (or body when not fullscreen)
 * keeps OCR region select, tool panels and lightboxes working in both states.
 */
export function portalTarget(): HTMLElement {
  return (document.fullscreenElement as HTMLElement) || document.body
}
