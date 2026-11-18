import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'sqlite-vec', 'node:sqlite']
      }
    }
  },
  preload: {},
  renderer: {
    // Root-level /public holds offline assets (MediaPipe model + wasm runtime)
    publicDir: resolve('public'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    worker: {
      format: 'es'
    },
    optimizeDeps: {
      exclude: ['@huggingface/transformers']
    },
    plugins: [react()]
  }
})
