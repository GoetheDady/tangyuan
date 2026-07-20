import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['@tangyuan/agent-runtime', '@tangyuan/contracts']
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ['@tangyuan/contracts']
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    server: {
      host: '0.0.0.0'
    }
  }
})
