import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Stream all local media through the Vite dev server so the <video> src is
      // SAME-ORIGIN with the page. A cross-origin media URL (page: localhost:5173,
      // media: 127.0.0.1:5176) + crossOrigin="anonymous" requires a CORS handshake
      // that fails in some browsers → "Video failed to load". Same-origin needs no
      // CORS at all, so downloaded videos play reliably everywhere (same mechanism
      // that makes direct file import — blob: URLs — always work). Range requests
      // pass through unchanged, preserving seek/streaming.
      '/media': {
        target: 'http://127.0.0.1:5176',
        changeOrigin: true,
      },
      // Same-origin proxy for the HTTP backend (dictionary, screenshots, AI stream,
      // video upload). Without this, fetch('/api/...') hits the SPA fallback and
      // returns index.html instead of JSON — every backend call would break.
      '/api': {
        target: 'http://127.0.0.1:5176',
        changeOrigin: true,
      },
    },
  },
})
