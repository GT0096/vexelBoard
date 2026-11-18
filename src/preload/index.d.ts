import { ElectronAPI } from '@electron-toolkit/preload'
import type { GlassAPI } from '../shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    glassAPI: GlassAPI
  }
}

export {}
