import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { GlassAPI } from '../shared/ipc'

const glassAPI: GlassAPI = {
  checkOllama: (host) => ipcRenderer.invoke('ai:checkOllama', host),
  saveKey: (provider, apiKey) => ipcRenderer.invoke('ai:saveKey', provider, apiKey),
  hasKey: (provider) => ipcRenderer.invoke('ai:hasKey', provider),
  deleteKey: (provider) => ipcRenderer.invoke('ai:deleteKey', provider),
  isEncryptionAvailable: () => ipcRenderer.invoke('ai:encryptionAvailable'),
  getOpenAIModelConfig: (model) => ipcRenderer.invoke('ai:getOpenAIModelConfig', model),
  runAI: (request) => ipcRenderer.invoke('ai:run', request),
  smartBeautify: (request) => ipcRenderer.invoke('canvas:smart-beautify', request),
  smartBeautifyCritique: (request) => ipcRenderer.invoke('canvas:smart-beautify-critique', request),
  runAgent: (request) => ipcRenderer.invoke('agent:run', request),
  cancelAgent: (runId) => ipcRenderer.invoke('agent:cancel', runId),
  onAgentEvent: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, event: any): void => callback(event)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  runCode: (request) => ipcRenderer.invoke('code:run', request),
  checkCodeRuntimes: () => ipcRenderer.invoke('code:checkRuntimes'),
  saveExportFile: (filename, content, mimeType) =>
    ipcRenderer.invoke('export:saveFile', filename, content, mimeType),
  printToPdf: () => ipcRenderer.invoke('export:printToPdf'),
  setMode: (mode) => ipcRenderer.invoke('board:setMode', mode),
  setClickThrough: (enabled) => ipcRenderer.invoke('board:setClickThrough', enabled),
  onClickThroughChanged: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, enabled: boolean): void => callback(enabled)
    ipcRenderer.on('board:clickThroughChanged', listener)
    return () => ipcRenderer.removeListener('board:clickThroughChanged', listener)
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChanged: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, isMax: boolean): void => callback(isMax)
    ipcRenderer.on('window:maximizedChanged', listener)
    return () => ipcRenderer.removeListener('window:maximizedChanged', listener)
  },
  hasNativeWindowControls: process.platform === 'win32' || process.platform === 'darwin',
  platform: process.platform,
  openDetachedChat: () => ipcRenderer.invoke('chat:openDetached'),
  toggleDetachedChat: () => ipcRenderer.invoke('chat:toggleDetached'),
  closeDetachedChat: () => ipcRenderer.invoke('chat:closeDetached'),
  isDetachedChat: () => ipcRenderer.invoke('chat:isDetached'),
  onDetachedChatChanged: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, isDetached: boolean): void => callback(isDetached)
    ipcRenderer.on('chat:detachedChanged', listener)
    return () => ipcRenderer.removeListener('chat:detachedChanged', listener)
  },
  sendDetachedAction: (action) => ipcRenderer.send('chat:sendAction', action),
  onDetachedAction: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, action: any): void => callback(action)
    ipcRenderer.on('chat:actionReceived', listener)
    return () => ipcRenderer.removeListener('chat:actionReceived', listener)
  },
  minimizeDetached: () => ipcRenderer.send('chat:minimizeDetached'),
  maximizeDetached: () => ipcRenderer.send('chat:maximizeDetached'),
  closeDetached: () => ipcRenderer.send('chat:closeDetached'),
  resizeDetachedWindow: (width, height) => ipcRenderer.send('chat:resizeWindow', { width, height }),

  // Media & Documents
  fetchYouTubeInfo: (url) => ipcRenderer.invoke('media:fetchYouTube', url),
  openFileDialogAndParse: () => ipcRenderer.invoke('media:openFileDialogAndParse'),
  parseFileBuffer: (fileName, base64Data) => ipcRenderer.invoke('media:parseFileBuffer', fileName, base64Data),

  // Knowledge Sources & Vector RAG
  saveKnowledgeSource: (source, chunks) => ipcRenderer.invoke('db:saveKnowledgeSource', source, chunks),
  indexKnowledgeFilesFromDialog: (boardId) => ipcRenderer.invoke('db:indexFilesFromDialog', boardId),
  getKnowledgeSources: (boardId, projectId) => ipcRenderer.invoke('db:getKnowledgeSources', boardId, projectId),
  deleteKnowledgeSource: (sourceId) => ipcRenderer.invoke('db:deleteKnowledgeSource', sourceId),
  hybridSearch: (query, opts) => ipcRenderer.invoke('db:hybridSearch', query, opts),

  // Board persistence & History Events
  saveBoardStore: (boardId, title, elements) => ipcRenderer.invoke('db:saveBoardStore', boardId, title, elements),
  getBoardStore: (boardId) => ipcRenderer.invoke('db:getBoardStore', boardId),
  recordHistoryEvent: (event) => ipcRenderer.invoke('db:recordHistoryEvent', event),
  getHistoryEvents: (boardId, limit) => ipcRenderer.invoke('db:getHistoryEvents', boardId, limit),

  // Projects, Sections & Overall History
  listProjects: () => ipcRenderer.invoke('db:listProjects'),
  createProject: (project) => ipcRenderer.invoke('db:createProject', project),
  updateProject: (projectId, patch) => ipcRenderer.invoke('db:updateProject', projectId, patch),
  deleteProject: (projectId) => ipcRenderer.invoke('db:deleteProject', projectId),
  listSections: (projectId) => ipcRenderer.invoke('db:listSections', projectId),
  createSection: (section) => ipcRenderer.invoke('db:createSection', section),
  updateSection: (sectionId, patch) => ipcRenderer.invoke('db:updateSection', sectionId, patch),
  deleteSection: (sectionId) => ipcRenderer.invoke('db:deleteSection', sectionId),
  getOverallHistory: (limit) => ipcRenderer.invoke('db:getOverallHistory', limit),
  getProjectChat: (projectId) => ipcRenderer.invoke('db:getProjectChat', projectId),
  saveProjectChat: (projectId, messages) => ipcRenderer.invoke('db:saveProjectChat', projectId, messages),
  getProjectChatStore: (projectId) => ipcRenderer.invoke('db:getProjectChatStore', projectId),
  saveProjectChatStore: (projectId, store) => ipcRenderer.invoke('db:saveProjectChatStore', projectId, store)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('glassAPI', glassAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.glassAPI = glassAPI
}
