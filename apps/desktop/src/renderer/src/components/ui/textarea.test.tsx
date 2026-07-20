import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Textarea } from '@/components/ui/textarea'

describe('Textarea', () => {
  it('renders a textarea element', () => {
    render(<Textarea aria-label="测试文本域" />)

    const textarea = screen.getByRole('textbox', { name: '测试文本域' })
    expect(textarea).toBeInTheDocument()
    expect(textarea.tagName).toBe('TEXTAREA')
  })

  it('forwards ref to the textarea element', () => {
    const ref = createRef<HTMLTextAreaElement>()
    render(<Textarea ref={ref} aria-label="Ref 文本域" />)

    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
    expect(ref.current?.tagName).toBe('TEXTAREA')
  })

  it('passes through native textarea props', () => {
    render(
      <Textarea
        name="description"
        autoComplete="off"
        defaultValue="汤圆的故事"
        placeholder="请输入描述"
        rows={5}
        cols={40}
        maxLength={500}
        aria-label="描述"
      />
    )

    const textarea = screen.getByRole('textbox', { name: '描述' })
    expect(textarea).toHaveAttribute('name', 'description')
    expect(textarea).toHaveAttribute('autocomplete', 'off')
    expect(textarea).toHaveAttribute('placeholder', '请输入描述')
    expect(textarea).toHaveAttribute('rows', '5')
    expect(textarea).toHaveAttribute('cols', '40')
    expect(textarea).toHaveAttribute('maxlength', '500')
    expect(textarea).toHaveValue('汤圆的故事')
  })

  it('merges className without snapshotting full class string', () => {
    render(<Textarea className="custom-class" aria-label="合并" />)

    const textarea = screen.getByRole('textbox', { name: '合并' })
    expect(textarea.className).toContain('custom-class')
    // 不断言完整的 Tailwind class 字符串，只验证合并行为
    expect(textarea.className).toContain('flex')
  })

  it('renders disabled state', () => {
    render(<Textarea disabled aria-label="禁用文本域" />)

    const textarea = screen.getByRole('textbox', { name: '禁用文本域' })
    expect(textarea).toBeDisabled()
  })

  it('renders aria-invalid state', () => {
    render(<Textarea aria-invalid="true" aria-label="无效文本域" />)

    const textarea = screen.getByRole('textbox', { name: '无效文本域' })
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
  })

  it('renders read-only state', () => {
    render(<Textarea readOnly defaultValue="只读内容" aria-label="只读文本域" />)

    const textarea = screen.getByRole('textbox', { name: '只读文本域' })
    expect(textarea).toHaveAttribute('readonly')
    expect(textarea).toHaveValue('只读内容')
  })

  it('renders required attribute', () => {
    render(<Textarea required aria-label="必填文本域" />)

    const textarea = screen.getByRole('textbox', { name: '必填文本域' })
    expect(textarea).toHaveAttribute('required')
  })

  it('handles onChange events', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Textarea onChange={onChange} aria-label="事件文本域" />)

    const textarea = screen.getByRole('textbox', { name: '事件文本域' })
    await user.type(textarea, 'hello world')
    expect(onChange).toHaveBeenCalled()
    expect(textarea).toHaveValue('hello world')
  })

  it('does not allow typing when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Textarea disabled onChange={onChange} aria-label="禁用事件" />)

    const textarea = screen.getByRole('textbox', { name: '禁用事件' })
    await user.type(textarea, 'x')
    expect(onChange).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('')
  })

  it('does not allow typing when read-only', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Textarea readOnly onChange={onChange} defaultValue="固定" aria-label="只读事件" />)

    const textarea = screen.getByRole('textbox', { name: '只读事件' })
    await user.type(textarea, 'x')
    // readOnly 阻止用户输入变更值
    expect(onChange).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('固定')
  })

  it('renders with id and associated label', () => {
    render(
      <div>
        <label htmlFor="test-textarea-id">测试标签</label>
        <Textarea id="test-textarea-id" />
      </div>
    )

    const textarea = screen.getByLabelText('测试标签')
    expect(textarea).toHaveAttribute('id', 'test-textarea-id')
  })

  it('handles multi-line content correctly', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Textarea onChange={onChange} aria-label="多行文本域" />)

    const textarea = screen.getByRole('textbox', { name: '多行文本域' })
    await user.type(textarea, 'Line 1{Enter}Line 2{Enter}Line 3')
    expect(textarea).toHaveValue('Line 1\nLine 2\nLine 3')
  })
})
