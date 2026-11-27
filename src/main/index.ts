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
  protocol,
  clipboard,
  nativeImage,
  net,
  type Rectangle
} from 'electron'
import { basename, extname, join } from 'path'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import winIcon from '../../resources/icon.ico?asset'
const windowIcon = process.platform === 'win32' ? winIcon : icon
import {
  callAgentJsonStep,
  checkOllamaStatus,
  deleteApiKey,
  fetchOpenAIModelConfig,
  hasApiKey,
  isEncryptionAvailable,
  runAIRequest,
  saveApiKey
} from './llmRouter'
import { cancelAgentRun, runAgentLoop } from './agent/agentHarness'
import { createAgentTools } from './agent/toolRegistry'
import { checkCodeRuntimes, runCodeSnippet } from './codeRunner'
import { runSmartBeautify, runSmartBeautifyCritique } from './smartBeautify'
import { recognizeHandwritingLocal } from './localOcr'
import { testWebSearch, webSearch } from './webSearch'
import {
  configureSkillPaths,
  deleteSkill,
  exportSkillToTarget,
  getSkillDetail,
  listAllSkills,
  saveSkill
} from './skillManager'
import {
  getCompanionStatus,
  saveCompanionSelectionCapture,
  startCompanionServer,
  stopCompanionServer,
  updateCompanionSnapshot
} from './companionServer'
import { dbManager } from './db'
import { fetchYouTubeInfo, parseDocumentBuffer, parseDocumentFile } from './mediaService'
import { AgentRunRequestSchema } from '../shared/agentSchema'
import type {
  AIRequest,
  ByokProvider,
  CodeExecutionRequest,
  CompanionBoardCapturePreparedPayload,
  CompanionBoardCaptureResult,
  CompanionSelectionCapturePayload,
  DisplayMode,
  LocalOcrRequest,
  SavedBoardImageResult,
  SmartBeautifyRequest,
  VectorCritiqueRequest
} from '../shared/ipc'

/* ---------------- Hardware & WebGPU flags (must precede app ready) ---------------- */
app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vexel-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
])

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
const pendingSelectionCaptures = new Map<
  string,
  (payload: CompanionSelectionCapturePayload) => void
>()
const pendingBoardCaptures = new Map<
  string,
  (payload: CompanionBoardCapturePreparedPayload) => void
>()

function isExternalBrowserUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
      return false
    }
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl && rawUrl.startsWith(devUrl)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function attachExternalLinkGuards(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler((details) => {
    if (isExternalBrowserUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isExternalBrowserUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
}

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
  ipcMain.handle('ocr:localHandwriting', (_e, request: LocalOcrRequest) =>
    recognizeHandwritingLocal(request)
  )

  ipcMain.handle('code:run', (_e, request: CodeExecutionRequest) => runCodeSnippet(request))
  ipcMain.handle('code:checkRuntimes', () => checkCodeRuntimes())
  ipcMain.handle('shell:openExternal', async (_e, rawUrl: string) => {
    if (typeof rawUrl === 'string' && isExternalBrowserUrl(rawUrl)) {
      await shell.openExternal(rawUrl)
      return { ok: true }
    }
    return { ok: false }
  })

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
        action?.type === 'openKnowledgeHub' ||
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

  // --- Smart Sketch-to-Vector Converter (Content-Aware Router + Spatial Compiler + Critique + VTracer + SVGO) ---
  ipcMain.handle('canvas:smart-beautify', async (_e, req: SmartBeautifyRequest) => {
    return await runSmartBeautify(req)
  })
  ipcMain.handle('canvas:smart-beautify-critique', async (_e, req: VectorCritiqueRequest) => {
    return await runSmartBeautifyCritique(req)
  })

  // --- Multi-Step Unified AI Agent Harness ---
  const agentTools = createAgentTools()
  ipcMain.handle('agent:run', async (event, rawReq: unknown) => {
    const parsed = AgentRunRequestSchema.safeParse(rawReq)
    if (!parsed.success) {
      return {
        ok: false,
        runId: (rawReq as any)?.runId || 'invalid',
        answer: '',
        stepsCount: 0,
        mutations: [],
        usedTools: [],
        error: `Invalid agent request: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
      }
    }
    const reqData = parsed.data
    const srcCount =
      reqData.boardSnapshot.knowledgeSourceCount > 0
        ? reqData.boardSnapshot.knowledgeSourceCount
        : dbManager.getKnowledgeSources(
            reqData.boardSnapshot.boardId,
            reqData.boardSnapshot.projectId
          ).length
    const enrichedRequest = {
      ...reqData,
      boardSnapshot: {
        ...reqData.boardSnapshot,
        knowledgeSourceCount: srcCount
      }
    }
    return await runAgentLoop({
      request: enrichedRequest,
      tools: agentTools,
      callLlmStep: callAgentJsonStep,
      onEvent: (stepEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:event', stepEvent)
        }
      }
    })
  })
  ipcMain.handle('agent:cancel', (_e, runId: string) => {
    return { ok: cancelAgentRun(runId) }
  })
  ipcMain.handle('web:search', async (_e, q: string, opts?: any, settings?: any) => {
    return await webSearch(q, opts ?? {}, settings ?? {})
  })
  ipcMain.handle('web:testSearch', async (_e, settings?: any) => {
    return await testWebSearch(settings ?? {})
  })
  ipcMain.handle('skills:list', () => listAllSkills())
  ipcMain.handle('skills:detail', (_e, idOrName: string, referenceFile?: string) =>
    getSkillDetail(idOrName, referenceFile)
  )
  ipcMain.handle('skills:save', (_e, input: any) => saveSkill(input))
  ipcMain.handle('skills:delete', (_e, idOrName: string) => deleteSkill(idOrName))
  ipcMain.handle(
    'skills:exportAntigravity',
    (_e, idOrName: string, target: 'workspace' | 'antigravity') =>
      exportSkillToTarget(idOrName, target)
  )
  ipcMain.handle('companion:status', () => getCompanionStatus())
  ipcMain.on('companion:syncSnapshot', (_e, snapshot: any) => {
    if (snapshot && typeof snapshot === 'object') {
      updateCompanionSnapshot(snapshot)
    }
  })
  ipcMain.handle(
    'companion:pushSelectionCapture',
    (_e, payload: CompanionSelectionCapturePayload) => {
      return saveCompanionSelectionCapture(
        payload,
        join(app.getPath('userData'), 'companion-captures')
      )
    }
  )
  ipcMain.on('companion:selectionCaptureResponse', (_e, data: any) => {
    const requestId = typeof data?.requestId === 'string' ? data.requestId : ''
    const resolver = pendingSelectionCaptures.get(requestId)
    if (resolver) {
      pendingSelectionCaptures.delete(requestId)
      resolver(
        data?.capture ?? {
          ok: false,
          boardId: 'unknown',
          selectedIds: [],
          error: 'Empty capture response from renderer'
        }
      )
    }
  })
  ipcMain.on('companion:boardCapturePrepared', (_e, data: any) => {
    const requestId = typeof data?.requestId === 'string' ? data.requestId : ''
    const resolver = pendingBoardCaptures.get(requestId)
    if (resolver) {
      pendingBoardCaptures.delete(requestId)
      resolver(
        data?.payload ?? {
          ok: false,
          boardId: 'unknown',
          mode: 'board',
          elementCount: 0,
          error: 'Empty board capture response from renderer'
        }
      )
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

  const getBoardImagesDir = (): string => {
    const dir = join(app.getPath('userData'), 'board-images')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  const persistImageBuffer = (buf: Buffer, extHint = 'png', nameHint?: string): SavedBoardImageResult => {
    try {
      const cleanExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(
        extHint.toLowerCase().replace(/^\./, '')
      )
        ? extHint.toLowerCase().replace(/^\./, '')
        : 'png'
      const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${cleanExt}`
      const dest = join(getBoardImagesDir(), id)
      writeFileSync(dest, buf)
      let width = 480
      let height = 320
      if (cleanExt !== 'svg') {
        const nImg = nativeImage.createFromBuffer(buf)
        const sz = nImg.getSize()
        if (sz.width > 0 && sz.height > 0) {
          width = sz.width
          height = sz.height
        }
      }
      return {
        ok: true,
        src: `vexel-media://board-images/${id}`,
        width,
        height,
        name: nameHint
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to save board image' }
    }
  }

  ipcMain.handle(
    'media:saveBoardImage',
    async (_e, dataUrlOrBase64: string, suggestedName?: string): Promise<SavedBoardImageResult> => {
      if (!dataUrlOrBase64) return { ok: false, error: 'Empty image payload' }
      const match = /^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/.exec(dataUrlOrBase64)
      let ext = 'png'
      let rawB64 = dataUrlOrBase64
      if (match) {
        ext = match[1].includes('svg') ? 'svg' : match[1].replace('jpeg', 'jpg')
        rawB64 = match[2]
      }
      const buf = Buffer.from(rawB64, 'base64')
      return persistImageBuffer(buf, ext, suggestedName)
    }
  )

  ipcMain.handle('media:readClipboardImage', async (): Promise<SavedBoardImageResult> => {
    try {
      const electronClipboard = clipboard as unknown as {
        readImage: () => Electron.NativeImage
      }
      const img = electronClipboard.readImage()
      if (img.isEmpty()) {
        return { ok: false, error: 'No image or snippet found in clipboard.' }
      }
      const pngBuf = img.toPNG()
      const sz = img.getSize()
      const saved = persistImageBuffer(pngBuf, 'png', 'Clipboard Snippet')
      return {
        ...saved,
        width: sz.width || saved.width,
        height: sz.height || saved.height
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to read clipboard image' }
    }
  })

  ipcMain.handle('media:pickBoardImages', async (e) => {
    const targetWin = BrowserWindow.fromWebContents(e.sender) || mainWindow
    if (!targetWin) return { ok: false, images: [] }
    const result = await dialog.showOpenDialog(targetWin, {
      title: 'Insert Image or Screenshot',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg']
        }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true, canceled: true, images: [] }
    }
    const images: SavedBoardImageResult[] = []
    for (const fp of result.filePaths) {
      try {
        const buf = readFileSync(fp)
        const ext = extname(fp).replace(/^\./, '') || 'png'
        const saved = persistImageBuffer(buf, ext, basename(fp))
        if (saved.ok) images.push(saved)
      } catch {
        /* skip unreadable file */
      }
    }
    return { ok: images.length > 0, images }
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

  ipcMain.handle('db:indexFilesFromDialog', async (e, boardId?: string) => {
    const targetWin = BrowserWindow.fromWebContents(e.sender) || mainWindow
    if (!targetWin) return { ok: false, indexed: [], errors: ['No active window'] }

    const result = await dialog.showOpenDialog(targetWin, {
      title: 'Select Books, PDFs, Notes or Code Files to Index',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Supported Documents & Code',
          extensions: ['pdf', 'txt', 'md', 'markdown', 'json', 'csv', 'ts', 'tsx', 'js', 'jsx', 'py', 'html', 'css']
        }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true, canceled: true, indexed: [] }
    }

    const indexed: Array<{ source: any; chunkCount: number }> = []
    const errors: string[] = []

    for (const filePath of result.filePaths) {
      const parsed = await parseDocumentFile(filePath)
      if (!parsed.ok) {
        errors.push(`${parsed.fileName}: ${parsed.error || 'Could not parse file'}`)
        continue
      }

      const sourceId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const text = parsed.text || ''
      const createdAt = Date.now()
      const tokenCount = Math.round(text.length / 4)
      const sourceType = parsed.fileType === 'pdf' ? 'pdf' : 'file'

      const dbSource = {
        id: sourceId,
        boardId,
        title: parsed.fileName,
        sourceType: sourceType as 'pdf' | 'file',
        sourceUrl: filePath,
        rawContent: text.slice(0, 3000),
        tokenCount,
        createdAt
      }

      const chunks = (parsed.chunks || []).map((c) => ({
        id: `chunk-${sourceId}-${c.chunkIndex}`,
        sourceId,
        chunkIndex: c.chunkIndex,
        chunkText: c.text,
        metadata: { page: c.page, fileName: parsed.fileName, filePath }
      }))

      dbManager.addKnowledgeSource(dbSource, chunks)

      // Return lightweight metadata only — never hold full book text in renderer RAM
      indexed.push({
        source: {
          ...dbSource,
          rawContent: '',
          isActive: true
        },
        chunkCount: chunks.length
      })
    }

    return { ok: indexed.length > 0 || errors.length === 0, indexed, errors }
  })

  ipcMain.handle('db:getKnowledgeSources', async (_e, boardId?: string, projectId?: string) => {
    return dbManager.getKnowledgeSources(boardId, projectId, { includeRawContent: false })
  })

  ipcMain.handle('db:deleteKnowledgeSource', async (_e, sourceId: string) => {
    try {
      const { deletedChunks } = dbManager.deleteKnowledgeSource(sourceId)
      return { ok: true, deletedChunks }
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

  protocol.handle('vexel-media', (request) => {
    try {
      const parsed = new URL(request.url)
      const safeFile = basename(decodeURIComponent(parsed.pathname.replace(/^\/+/, '')))
      const fullPath = join(app.getPath('userData'), 'board-images', safeFile)
      if (!safeFile || !existsSync(fullPath)) {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(fullPath).toString())
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })

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

  app.on('web-contents-created', (_e, contents) => {
    attachExternalLinkGuards(contents)
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

  configureSkillPaths({
    userDataDir: app.getPath('userData'),
    workspaceDir: process.cwd()
  })

  registerIpc()
  createWindow()

  void startCompanionServer({
    captureDir: join(app.getPath('userData'), 'companion-captures'),
    onMutations: (mutations, source) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('companion:applyMutations', { mutations, source })
        return true
      }
      return false
    },
    requestLiveSelectionCapture: async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return null
      const requestId = `selcap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      return await new Promise<CompanionSelectionCapturePayload | null>((resolve) => {
        const timer = setTimeout(() => {
          pendingSelectionCaptures.delete(requestId)
          resolve(null)
        }, 3000)
        pendingSelectionCaptures.set(requestId, (payload) => {
          clearTimeout(timer)
          resolve(payload)
        })
        mainWindow!.webContents.send('companion:requestSelectionCapture', requestId)
      })
    },
    requestLiveBoardCapture: async ({ mode, region }): Promise<CompanionBoardCaptureResult | null> => {
      if (!mainWindow || mainWindow.isDestroyed()) return null
      const requestId = `boardcap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      try {
        const prepared = await new Promise<CompanionBoardCapturePreparedPayload | null>((resolve) => {
          const timer = setTimeout(() => {
            pendingBoardCaptures.delete(requestId)
            resolve(null)
          }, 5000)
          pendingBoardCaptures.set(requestId, (payload) => {
            clearTimeout(timer)
            resolve(payload)
          })
          mainWindow!.webContents.send('companion:prepareBoardCapture', {
            requestId,
            mode,
            region
          })
        })
        if (!prepared || !prepared.ok) {
          return {
            ok: false,
            mode,
            boardId: prepared?.boardId,
            projectId: prepared?.projectId,
            boardBounds: prepared?.boardBounds,
            elementCount: prepared?.elementCount ?? 0,
            error: prepared?.error || 'Renderer failed to prepare board capture.'
          }
        }
        const image = await mainWindow.webContents.capturePage()
        const pngBuf = image.toPNG()
        const size = image.getSize()
        const captureDir = join(app.getPath('userData'), 'companion-captures')
        mkdirSync(captureDir, { recursive: true })
        const fileName = mode === 'viewport' ? 'latest-viewport.png' : 'latest-board.png'
        const filePath = join(captureDir, fileName)
        writeFileSync(filePath, pngBuf)
        return {
          ok: true,
          mode,
          boardId: prepared.boardId,
          projectId: prepared.projectId,
          boardBounds: prepared.boardBounds,
          capturedBounds: prepared.capturedBounds,
          elementCount: prepared.elementCount,
          filePath,
          mimeType: 'image/png',
          width: size.width,
          height: size.height,
          base64Png: pngBuf.toString('base64'),
          capturedAt: Date.now()
        }
      } finally {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('companion:finishBoardCapture', requestId)
        }
      }
    }
  })

  // Global OS click-through toggle
  globalShortcut.register('Alt+Space', () => setClickThrough(!clickThrough))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  stopCompanionServer()
  globalShortcut.unregisterAll()
  dbManager.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
