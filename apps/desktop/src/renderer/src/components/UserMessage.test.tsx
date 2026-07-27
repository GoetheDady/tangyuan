import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UserMessage } from './UserMessage'

describe('UserMessage', () => {
  it('渲染纯文本内容', () => {
    render(<UserMessage content="你好，请做自我介绍" />)
    expect(screen.getByText('你好，请做自我介绍')).toBeInTheDocument()
  })

  it('渲染多行文本时保留换行', () => {
    const content = `第一行
第二行
第三行`
    const { container } = render(<UserMessage content={content} />)
    const el = container.querySelector('p')
    expect(el).toBeInTheDocument()
    expect(el!.textContent).toContain('第一行')
    expect(el!.textContent).toContain('第二行')
    expect(el!.textContent).toContain('第三行')
    expect(el!.className).toContain('whitespace-pre-wrap')
  })

  it('渲染长文本时允许换行', () => {
    const longText = 'a'.repeat(200)
    render(<UserMessage content={longText} />)
    const el = screen.getByText(longText)
    expect(el.className).toContain('break-words')
  })

  it('渲染特殊字符', () => {
    const special = '<script>alert("xss")</script> & "quotes"'
    render(<UserMessage content={special} />)
    // 纯文本渲染，不会被解析为 HTML
    expect(screen.getByText(special)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('渲染空字符串', () => {
    const { container } = render(<UserMessage content="" />)
    const p = container.querySelector('p')
    expect(p).toBeInTheDocument()
    expect(p).toHaveTextContent('')
  })

  it('使用 p 标签包裹', () => {
    const { container } = render(<UserMessage content="hello" />)
    expect(container.querySelector('p')).toBeInTheDocument()
  })
})
