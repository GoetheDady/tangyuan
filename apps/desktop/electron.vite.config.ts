import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['@tangyuan/agent-runtime', '@tangyuan/shared']
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ['@tangyuan/shared']
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
