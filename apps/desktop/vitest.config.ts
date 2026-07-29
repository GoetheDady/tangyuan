import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': new URL('./src/renderer/src', import.meta.url).pathname,
      '@renderer': new URL('./src/renderer/src', import.meta.url).pathname,
    },
  },
  test: {
    // 断言本地时间格式化结果的用例（如 CompactionIndicator）依赖运行环境时区，
    // 开发机在 UTC+8、CI runner 在 UTC，不固定就会两边结果不一致。
    env: {
      TZ: 'Asia/Shanghai',
    },
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
