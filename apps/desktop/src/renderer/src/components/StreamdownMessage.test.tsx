import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StreamdownMessage } from './StreamdownMessage'

describe('StreamdownMessage', () => {
  function defineMockApi(openExternalLink = vi.fn()) {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { openExternalLink }
    })
  }

  it('renders basic Markdown headings', () => {
    defineMockApi()
    render(<StreamdownMessage content="# Hello World" />)

    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  it('renders bold and italic text', () => {
    defineMockApi()
    render(<StreamdownMessage content="This is **bold** and *italic* text" />)

    expect(screen.getByText(/bold/)).toBeInTheDocument()
    expect(screen.getByText(/italic/)).toBeInTheDocument()
  })

  it('renders bullet lists', () => {
    defineMockApi()
    render(<StreamdownMessage content={'- Item 1\n- Item 2\n- Item 3'} />)

    // streamdown 将列表项渲染在 <ul> 中
    const list = document.querySelector('[data-streamdown="unordered-list"]')
    expect(list).toBeInTheDocument()
    expect(list?.textContent).toContain('Item 1')
    expect(list?.textContent).toContain('Item 2')
    expect(list?.textContent).toContain('Item 3')
  })

  it('renders code blocks', () => {
    defineMockApi()
    render(<StreamdownMessage content={'```ts\nconst x = 1;\n```'} />)

    // 代码块应包含 const x = 1 文本
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument()
  })

  it('renders inline code', () => {
    defineMockApi()
    render(<StreamdownMessage content="Use `console.log()` to debug" />)

    expect(screen.getByText(/console\.log\(\)/)).toBeInTheDocument()
  })

  it('renders tables', () => {
    defineMockApi()
    render(<StreamdownMessage content={'| A | B |\n| --- | --- |\n| 1 | 2 |'} />)

    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('renders task lists', () => {
    defineMockApi()
    render(<StreamdownMessage content={'- [x] Done\n- [ ] Todo'} />)

    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Todo')).toBeInTheDocument()
  })

  it('handles CJK text correctly', () => {
    defineMockApi()
    render(
      <StreamdownMessage content={'# 你好世界\n\n这是一段**中文**内容，包含*斜体*和`代码`。'} />
    )

    // 标题应包含"你好世界"
    const heading = document.querySelector('[data-streamdown="heading-1"]')
    expect(heading).toBeInTheDocument()
    expect(heading?.textContent).toContain('你好世界')
    // 粗体中文
    const strong = document.querySelector('[data-streamdown="strong"]')
    expect(strong).toBeInTheDocument()
    expect(strong?.textContent).toContain('中文')
    // 行内代码
    const code = document.querySelector('[data-streamdown="inline-code"]')
    expect(code).toBeInTheDocument()
    expect(code?.textContent).toContain('代码')
  })

  it('does not execute raw HTML', () => {
    defineMockApi()
    render(<StreamdownMessage content={'<script>alert("xss")</script>'} />)

    // 原始 HTML 不应该作为脚本执行，应被转义或移除
    expect(screen.queryByText('alert("xss")')).not.toBeInTheDocument()
  })

  it('handles unclosed code fences gracefully in streaming mode', () => {
    defineMockApi()
    // 流式模式下未闭合的代码块不应导致崩溃
    render(<StreamdownMessage content={'```js\nconst x = 1'} isAnimating />)

    // streamdown 渲染未闭合代码块，带 data-incomplete 属性
    const codeBlock = document.querySelector('[data-streamdown="code-block"]')
    expect(codeBlock).toBeInTheDocument()
    expect(codeBlock?.getAttribute('data-incomplete')).toBe('true')
  })

  it('external links call window.api.openExternalLink', async () => {
    const user = userEvent.setup()
    const openExternalLink = vi.fn().mockResolvedValue(undefined)
    defineMockApi(openExternalLink)

    render(<StreamdownMessage content="[Click here](https://example.com)" />)

    const link = screen.getByText('Click here')
    await user.click(link)

    // streamdown 会对 URL 做规范化（如添加尾部斜杠）
    expect(openExternalLink).toHaveBeenCalled()
    const callArg = openExternalLink.mock.calls[0]?.[0] as { url: string } | undefined
    expect(callArg?.url).toMatch(/^https:\/\/example\.com/)
  })

  it('renders empty content without crashing', () => {
    defineMockApi()
    render(<StreamdownMessage content="" />)

    // 空内容不应抛出错误，组件正常挂载
    expect(document.body).toBeInTheDocument()
  })

  it('renders strikethrough text', () => {
    defineMockApi()
    render(<StreamdownMessage content="~~deleted~~ text" />)

    expect(screen.getByText(/deleted/)).toBeInTheDocument()
  })

  it('renders blockquotes', () => {
    defineMockApi()
    render(<StreamdownMessage content="> This is a quote" />)

    expect(screen.getByText(/This is a quote/)).toBeInTheDocument()
  })

  it('renders horizontal rules', () => {
    defineMockApi()
    render(<StreamdownMessage content={'Before\n\n---\n\nAfter'} />)

    // streamdown 应在 Before 和 After 之间渲染 <hr>
    const hr = document.querySelector('hr')
    expect(hr).toBeInTheDocument()
  })
})
