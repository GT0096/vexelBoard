import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: [
          'better-sqlite3',
          'sqlite-vec',
          'node:sqlite',
          '@visioncortex/vtracer',
          'svgo',
          '@huggingface/transformers',
          'onnxruntime-node',
          'sharp',
          'linkedom',
          '@mozilla/readability'
        ]
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
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              if (id.includes('@xyflow/')) return 'vendor-xyflow'
              if (
                id.includes('codemirror') ||
                id.includes('@codemirror/') ||
                id.includes('@lezer/')
              ) {
                return 'vendor-codemirror'
              }
              if (id.includes('katex') || id.includes('rehype-katex') || id.includes('remark-math')) {
                return 'vendor-katex'
              }
              if (
                id.includes('react-markdown') ||
                id.includes('remark-') ||
                id.includes('rehype-') ||
                id.includes('unified') ||
                id.includes('mdast') ||
                id.includes('hast')
              ) {
                return 'vendor-markdown'
              }
              if (
                id.includes('/react/') ||
                id.includes('/react-dom/') ||
                id.includes('\\react\\') ||
                id.includes('\\react-dom\\')
              ) {
                return 'vendor-react'
              }
            }
            return undefined
          }
        }
      }
    },
    plugins: [react()]
  }
})
