import { app, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { startMediaServer } from './media-server'

let mainWindow: BrowserWindow | null = null

// ── App icon ──
// 开发期读取仓库内 resources/icon.png；打包后从应用资源目录读取（electron-builder extraResources 拷贝）。
function getWindowIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
}

// ── Window ──

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'LinguaFlix — Immersive English Learning',
    icon: getWindowIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── WebRequest: inject streaming platform headers ──

function setupStreamHeaders(): void {
  const bilibiliFilter = {
    urls: [
      '*://*.bilivideo.com/*',
      '*://*.bilivideo.cn/*',
      '*://*.biliapi.net/*',
      '*://*.hdslb.com/*',
      '*://*.mcdn.bilivideo.cn/*',
    ],
  }
  session.defaultSession.webRequest.onBeforeSendHeaders(bilibiliFilter, (details, callback) => {
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        Referer: 'https://www.bilibili.com',
        Origin: 'https://www.bilibili.com',
        'User-Agent':
          details.requestHeaders['User-Agent'] ||
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    })
  })
}

// ── App lifecycle ──

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(getWindowIconPath())
  }
  startMediaServer()
  setupStreamHeaders()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
