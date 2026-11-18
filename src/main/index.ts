import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  session,
  globalShortcut,
  screen,
  dialog,
  Menu,
  type Rectangle
} from 'electron'
import { join } from 'path'
import { cpSync, existsSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import winIcon from '../../resources/icon.ico?asset'
const windowIcon = process.platform === 'win32' ? winIcon : icon
import {
  checkOllamaStatus,
  deleteApiKey,
  fetchOpenAIModelConfig,
  hasApiKey,
  isEncryptionAvailable,
  runAIRequest,
  saveApiKey
} from './llmRouter'
import { checkCodeRuntimes, runCodeSnippet } from './codeRunner'
import { dbManager } from './db'
import { fetchYouTubeInfo, parseDocumentBuffer, parseDocumentFile } from './mediaService'
import type { AIRequest, ByokProvider, CodeExecutionRequest, DisplayMode } from '../shared/ipc'

/* ---------------- Hardware & WebGPU flags (must precede app ready) ---------------- */
app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')

// Set dedicated userData path to avoid collisions with default Electron cache
const userDataDir = join(app.getPath('appData'), 'virtual-board')
const legacyUserDataDir = join(app.getPath('appData'), 'virtual-glass-board')
if (!existsSync(userDataDir) && existsSync(legacyUserDataDir)) {
  try {
    cpSync(legacyUserDataDir, userDataDir, { recursive: true })
  } catch {
    /* ignore legacy data migration errors */
  }
}
app.setPath('userData', userDataDir)

// Enforce single running instance so multiple processes never fight over cache or webcam
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
  process.exit(0)
}

const MODE_A_SIZE = { width: 1440, height: 900 }

let mainWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let currentMode: DisplayMode = 'MODE_A'
let clickThrough = false
let modeABounds: Rectangle | null = null

function toggleDetachedChat(): boolean {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isVisible() && !chatWindow.isMinimized()) {
      chatWindow.hide()
      mainWindow?.webContents.send('chat:detachedChanged', false)
      return false
    } else {
      if (chatWindow.isMinimized()) chatWindow.restore()
      chatWindow.show()
      chatWindow.focus()
      mainWindow?.webContents.send('chat:detachedChanged', true)
      return true
    }
  }
  return openDetachedChat()
}

function openDetachedChat(): boolean {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isMinimized()) chatWindow.restore()
    chatWindow.show()
    chatWindow.focus()
    mainWindow?.webContents.send('chat:detachedChanged', true)
    return true
  }

  const bounds = mainWindow?.getBounds()
  const display = bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay()

  const defaultW = 410
  const defaultH = 680
  const x = bounds
    ? Math.max(0, Math.round(bounds.x + bounds.width - defaultW - 24))
    : Math.max(0, Math.round(display.bounds.x + display.bounds.width - defaultW - 24))
  const y = bounds
    ? Math.max(0, Math.round(bounds.y + bounds.height - defaultH - 30))
    : Math.max(0, Math.round(display.bounds.y + display.bounds.height - defaultH - 30))

  chatWindow = new BrowserWindow({
    width: defaultW,
    height: defaultH,
    minWidth: 320,
    minHeight: 400,
    x,
    y,
    show: false,
    transparent: true,
    frame: false,
    hasShadow: true,
    alwaysOnTop: true,
    resizable: true,
    backgroundColor: '#00000000',
    title: 'AI Research & Notes',
    ...(process.platform !== 'darwin' ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })

  chatWindow.on('ready-to-show', () => {
    chatWindow?.show()
    mainWindow?.webContents.send('chat:detachedChanged', true)
  })

  chatWindow.on('closed', () => {
    chatWindow = null
    mainWindow?.webContents.send('chat:detachedChanged', false)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    chatWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?window=detached-chat`)
  } else {
    chatWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'detached-chat' }
    })
  }

  return true
}

function createWindow(): void {
  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    ...MODE_A_SIZE,
    minWidth: 480,
    minHeight: 420,
    show: false,
    transparent: false,
    hasShadow: true,
    backgroundColor: '#FFFDF7',
    autoHideMenuBar: true,
    title: 'Vexelboard',
    ...(isWin
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#FFFDF7',
            symbolColor: '#111111',
            height: 52
          }
        }
      : isMac
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 14, y: 19 }
          }
        : {
            frame: false
          }),
    ...(process.platform !== 'darwin' ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })

  // Forward renderer console logs directly to terminal for easy diagnostics
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    // Filter benign WebGL / WASM / ONNX Runtime notices
    if (
      message.includes('powerPreference option is currently ignored') ||
      message.includes('gl_context.cc') ||
      message.includes('OpenGL error checking is disabled') ||
      message.includes('Using NORM_RECT without IMAGE_DIMENSIONS') ||
      message.includes('Graph successfully started running')
    ) {
      return
    }
    const lvl = level === 2 ? 'ERROR' : level === 1 ? 'WARN' : 'INFO'
    console.log(`[Renderer ${lvl}] ${message} (${sourceId ? sourceId.split('/').pop() : 'app'}:${line})`)
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximizedChanged', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximizedChanged', false)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.close()
      chatWindow = null
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/* ---------------- Display modes ---------------- */
function applyMode(mode: DisplayMode): DisplayMode {
  if (!mainWindow) return currentMode
  if (mode === 'MODE_B') {
    if (currentMode === 'MODE_A') modeABounds = mainWindow.getBounds()
    const display = screen.getDisplayMatching(mainWindow.getBounds())
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    mainWindow.setBounds(display.bounds)
  } else {
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setVisibleOnAllWorkspaces(false)
    setClickThrough(false)
    if (modeABounds) {
      mainWindow.setBounds(modeABounds)
    } else {
      mainWindow.setSize(MODE_A_SIZE.width, MODE_A_SIZE.height)
      mainWindow.center()
    }
  }
  currentMode = mode
  return currentMode
}

function setClickThrough(enabled: boolean): boolean {
  clickThrough = enabled
  if (mainWindow) {
    if (enabled) mainWindow.setIgnoreMouseEvents(true, { forward: true })
    else mainWindow.setIgnoreMouseEvents(false)
    mainWindow.webContents.send('board:clickThroughChanged', clickThrough)
  }
  return clickThrough
}

/* ---------------- IPC ---------------- */
function registerIpc(): void {
  ipcMain.handle('ai:checkOllama', (_e, host?: string) => checkOllamaStatus(host))
  ipcMain.handle('ai:saveKey', (_e, provider: ByokProvider, apiKey: string) =>
    saveApiKey(provider, apiKey)
  )
  ipcMain.handle('ai:hasKey', (_e, provider: ByokProvider) => hasApiKey(provider))
  ipcMain.handle('ai:deleteKey', (_e, provider: ByokProvider) => deleteApiKey(provider))
  ipcMain.handle('ai:encryptionAvailable', () => isEncryptionAvailable())
  ipcMain.handle('ai:getOpenAIModelConfig', (_e, model: string) => fetchOpenAIModelConfig(model))
  ipcMain.handle('ai:run', (_e, request: AIRequest) => runAIRequest(request))

  ipcMain.handle('code:run', (_e, request: CodeExecutionRequest) => runCodeSnippet(request))
  ipcMain.handle('code:checkRuntimes', () => checkCodeRuntimes())

  ipcMain.handle('board:setMode', (_e, mode: DisplayMode) => applyMode(mode))
  ipcMain.handle('board:setClickThrough', (_e, enabled: boolean) => setClickThrough(enabled))

  ipcMain.handle('export:saveFile', async (_e, filename: string, content: string) => {
    if (!mainWindow) return { success: false }
    const ext = filename.split('.').pop() || 'txt'
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: filename,
      filters: [{ name: ext.toUpperCase() + ' File', extensions: [ext] }]
    })
    if (!result.canceled && result.filePath) {
      if (content.startsWith('data:')) {
        const base64Data = content.replace(/^data:[^;]+;base64,/, '')
        writeFileSync(result.filePath, Buffer.from(base64Data, 'base64'))
      } else {
        writeFileSync(result.filePath, content, 'utf-8')
      }
      return { success: true, filePath: result.filePath }
    }
    return { success: false }
  })

  ipcMain.handle('export:printToPdf', async () => {
    if (!mainWindow) return null
    try {
      const pdfData = await mainWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        landscape: true
      })
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: 'notes.pdf',
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      })
      if (!result.canceled && result.filePath) {
        writeFileSync(result.filePath, pdfData)
        return result.filePath
      }
      return null
    } catch (err) {
      console.error('PDF export error:', err)
      return null
    }
  })

  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.close())

  // Detached external chat window IPC (for dragging to another monitor/screen)
  ipcMain.handle('chat:openDetached', () => openDetachedChat())
  ipcMain.handle('chat:toggleDetached', () => toggleDetachedChat())
  ipcMain.handle('chat:closeDetached', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.close()
      chatWindow = null
      return true
    }
    return false
  })
  ipcMain.handle('chat:isDetached', () => !!chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible())
  ipcMain.on('chat:sendAction', (_e, action) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (
        action?.type === 'openNotebookLM' ||
        action?.type === 'generateTutorial' ||
        action?.type === 'addYouTubeToCanvas'
      ) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
      mainWindow.webContents.send('chat:actionReceived', action)
    }
  })
  ipcMain.on('chat:minimizeDetached', () => chatWindow?.minimize())
  ipcMain.on('chat:maximizeDetached', () => {
    if (!chatWindow) return
    if (chatWindow.isMaximized()) {
      chatWindow.unmaximize()
    } else {
      chatWindow.maximize()
    }
  })
  ipcMain.on('chat:closeDetached', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.close()
      chatWindow = null
    }
  })
  ipcMain.on('chat:resizeWindow', (_e, { width, height }) => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.setSize(Math.round(width), Math.round(height))
    }
  })

  // --- Media & YouTube Transcript IPC ---
  ipcMain.handle('media:fetchYouTube', async (_e, url: string) => {
    return await fetchYouTubeInfo(url)
  })

  ipcMain.handle('media:openFileDialogAndParse', async (e) => {
    const targetWin = BrowserWindow.fromWebContents(e.sender) || mainWindow
    if (!targetWin) return { ok: false, error: 'No active window' }
    const result = await dialog.showOpenDialog(targetWin, {
      title: 'Select Document or Code File',
      properties: ['openFile'],
      filters: [
        {
          name: 'Supported Documents & Code',
          extensions: ['pdf', 'txt', 'md', 'markdown', 'json', 'csv', 'ts', 'js', 'py', 'html', 'css']
        }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }
    return await parseDocumentFile(result.filePaths[0])
  })

  ipcMain.handle('media:parseFileBuffer', async (_e, fileName: string, base64Data: string) => {
    return await parseDocumentBuffer(fileName, base64Data)
  })

  // --- SQLite & Vector Knowledge Store IPC ---
  ipcMain.handle('db:saveKnowledgeSource', async (_e, source: any, chunks: any[]) => {
    try {
      dbManager.addKnowledgeSource(source, chunks)
      return { ok: true }
    } catch (err: any) {
      console.error('[DB] saveKnowledgeSource error:', err)
      return { ok: false, error: err?.message }
    }
  })

  ipcMain.handle('db:getKnowledgeSources', async (_e, boardId?: string, projectId?: string) => {
    return dbManager.getKnowledgeSources(boardId, projectId)
  })

  ipcMain.handle('db:deleteKnowledgeSource', async (_e, sourceId: string) => {
    try {
      dbManager.deleteKnowledgeSource(sourceId)
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message }
    }
  })

  ipcMain.handle('db:hybridSearch', async (_e, query: string, opts?: any) => {
    return dbManager.hybridSearch(query, opts)
  })

  // --- Board Element Persistence & History IPC ---
  ipcMain.handle('db:saveBoardStore', async (_e, boardId: string, title: string, elements: any[]) => {
    try {
      dbManager.saveBoardElements(boardId, title, elements)
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message }
    }
  })

  ipcMain.handle('db:getBoardStore', async (_e, boardId: string) => {
    return dbManager.getBoardElements(boardId)
  })

  ipcMain.handle('db:recordHistoryEvent', async (_e, event: any) => {
    dbManager.recordHistoryEvent(event)
  })

  ipcMain.handle('db:getHistoryEvents', async (_e, boardId: string, limit?: number) => {
    return dbManager.getHistoryEvents(boardId, limit)
  })

  // --- Projects, Sections & Overall History IPC ---
  ipcMain.handle('db:listProjects', async () => {
    return dbManager.listProjects()
  })

  ipcMain.handle('db:createProject', async (_e, project: any) => {
    return dbManager.createProject(project)
  })

  ipcMain.handle('db:updateProject', async (_e, projectId: string, patch: any) => {
    return dbManager.updateProject(projectId, patch)
  })

  ipcMain.handle('db:deleteProject', async (_e, projectId: string) => {
    dbManager.deleteProject(projectId)
    return { ok: true }
  })

  ipcMain.handle('db:listSections', async (_e, projectId?: string) => {
    return dbManager.listSections(projectId)
  })

  ipcMain.handle('db:createSection', async (_e, section: any) => {
    return dbManager.createSection(section)
  })

  ipcMain.handle('db:updateSection', async (_e, sectionId: string, patch: any) => {
    return dbManager.updateSection(sectionId, patch)
  })

  ipcMain.handle('db:deleteSection', async (_e, sectionId: string) => {
    dbManager.deleteSection(sectionId)
    return { ok: true }
  })

  ipcMain.handle('db:getOverallHistory', async (_e, limit?: number) => {
    return dbManager.getOverallHistory(limit)
  })

  ipcMain.handle('db:getProjectChat', async (_e, projectId: string) => {
    return dbManager.getProjectChat(projectId)
  })

  ipcMain.handle('db:saveProjectChat', async (_e, projectId: string, messages: any[]) => {
    try {
      dbManager.saveProjectChat(projectId, messages)
      return { ok: true }
    } catch (err: any) {
      console.error('[DB] saveProjectChat error:', err)
      return { ok: false, error: err?.message }
    }
  })

  ipcMain.handle('db:getProjectChatStore', async (_e, projectId: string) => {
    return dbManager.getProjectChatStore(projectId)
  })

  ipcMain.handle('db:saveProjectChatStore', async (_e, projectId: string, store: any) => {
    try {
      dbManager.saveProjectChatStore(projectId, store)
      return { ok: true }
    } catch (err: any) {
      console.error('[DB] saveProjectChatStore error:', err)
      return { ok: false, error: err?.message }
    }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.vexelboard.app')

  if (process.platform === 'darwin') {
    try {
      app.dock?.setIcon(icon)
    } catch {
      /* ignore dock icon errors */
    }
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' }
      ])
    )
  }

  // Auto-initialize local zero-setup database on launch
  try {
    dbManager.init()
  } catch (err) {
    console.error('[DB] Failed to initialize local database:', err)
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Auto-approve camera + microphone permissions for the virtual glass board
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true)
  })
  session.defaultSession.setPermissionCheckHandler(() => true)

  // Ensure YouTube embedded players receive a valid HTTPS Referer (prevents Error 153 / blocked playback in Electron)
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://www.youtube.com/*',
        'https://www.youtube-nocookie.com/*',
        'https://youtube.com/*',
        'https://*.googlevideo.com/*'
      ]
    },
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      const existingRef = headers['Referer'] || headers['referer'] || ''
      if (
        !existingRef ||
        existingRef.startsWith('file://') ||
        existingRef.startsWith('http://localhost') ||
        existingRef.startsWith('http://127.0.0.1')
      ) {
        delete headers['referer']
        headers['Referer'] = 'https://www.youtube.com/'
      }
      callback({ requestHeaders: headers })
    }
  )

  registerIpc()
  createWindow()

  // Global OS click-through toggle
  globalShortcut.register('Alt+Space', () => setClickThrough(!clickThrough))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  dbManager.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
