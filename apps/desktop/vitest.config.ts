import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': new URL('./src/renderer/src', import.meta.url).pathname
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/renderer/src/**/*.test.{ts,tsx}']
  }
})
