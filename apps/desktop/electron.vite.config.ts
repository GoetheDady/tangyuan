import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['@yuanxiao/agent-runtime', '@yuanxiao/contracts'],
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ['@yuanxiao/contracts'],
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
    // 将 workspace 包从依赖预打包中排除，使 Vite 把它们当源码处理并启用 HMR。
    optimizeDeps: {
      exclude: ['@yuanxiao/contracts', '@yuanxiao/agent-runtime'],
    },
    server: {
      host: '0.0.0.0',
      watch: {
        // 跟随软链，监听 workspace 包源码变化。
        followSymlinks: true,
      },
    },
  },
})
