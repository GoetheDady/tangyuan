import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CompactionIndicator } from './CompactionIndicator'

describe('CompactionIndicator', () => {
  const testTimestamp = '2026-07-26T10:30:00.000Z'
  // 组件用 toLocaleTimeString 输出本地时间，因此断言值与运行时区绑定。
  // 时区由 vitest.config.ts 的 test.env.TZ 固定为 Asia/Shanghai（UTC+8）。
  const expectedTime = '18:30'

  it('渲染压缩提示文本', () => {
    render(<CompactionIndicator timestamp={testTimestamp} />)
    expect(screen.getByText(/上下文已.*自动压缩/)).toBeInTheDocument()
  })

  it('显示格式化的时间', () => {
    render(<CompactionIndicator timestamp={testTimestamp} />)
    expect(screen.getByText(new RegExp(expectedTime))).toBeInTheDocument()
  })

  it('设置 status 角色和正确的 aria-label', () => {
    render(<CompactionIndicator timestamp={testTimestamp} />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute(
      'aria-label',
      `上下文已于 ${expectedTime} 自动压缩`,
    )
  })

  it('渲染 Archive 图标', () => {
    const { container } = render(
      <CompactionIndicator timestamp={testTimestamp} />,
    )
    const archiveIcon = container.querySelector('svg.lucide-archive')
    expect(archiveIcon).toBeInTheDocument()
  })

  it('两侧有分割线', () => {
    const { container } = render(
      <CompactionIndicator timestamp={testTimestamp} />,
    )
    const separators = container.querySelectorAll('.h-px.bg-border')
    expect(separators).toHaveLength(2)
  })
})
