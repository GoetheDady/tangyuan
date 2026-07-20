import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Input } from '@/components/ui/input'

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input aria-label="测试输入" />)

    const input = screen.getByRole('textbox', { name: '测试输入' })
    expect(input).toBeInTheDocument()
    expect(input.tagName).toBe('INPUT')
  })

  it('forwards ref to the input element', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Input ref={ref} aria-label="Ref 输入" />)

    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current?.tagName).toBe('INPUT')
  })

  it('passes through native input props', () => {
    render(
      <Input
        type="text"
        name="display-name"
        autoComplete="name"
        defaultValue="汤圆"
        placeholder="请输入名称"
        aria-label="显示名称"
      />
    )

    const input = screen.getByRole('textbox', { name: '显示名称' })
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('name', 'display-name')
    expect(input).toHaveAttribute('autocomplete', 'name')
    expect(input).toHaveAttribute('placeholder', '请输入名称')
    expect(input).toHaveValue('汤圆')
  })

  it('merges className without snapshotting full class string', () => {
    render(<Input className="custom-class" aria-label="合并" />)

    const input = screen.getByRole('textbox', { name: '合并' })
    expect(input.className).toContain('custom-class')
    // 不断言完整的 Tailwind class 字符串，只验证合并行为
    expect(input.className).toContain('flex')
  })

  it('renders disabled state', () => {
    render(<Input disabled aria-label="禁用输入" />)

    const input = screen.getByRole('textbox', { name: '禁用输入' })
    expect(input).toBeDisabled()
  })

  it('renders aria-invalid state', () => {
    render(<Input aria-invalid="true" aria-label="无效输入" />)

    const input = screen.getByRole('textbox', { name: '无效输入' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('renders read-only state', () => {
    render(<Input readOnly defaultValue="只读值" aria-label="只读输入" />)

    const input = screen.getByRole('textbox', { name: '只读输入' })
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveValue('只读值')
  })

  it('renders required attribute', () => {
    render(<Input required aria-label="必填输入" />)

    const input = screen.getByRole('textbox', { name: '必填输入' })
    expect(input).toHaveAttribute('required')
  })

  it('renders password type correctly', () => {
    render(<Input type="password" aria-label="密码" />)

    // password 类型没有 textbox role，用 label 查询
    const input = screen.getByLabelText('密码')
    expect(input).toHaveAttribute('type', 'password')
  })

  it('renders file type correctly', () => {
    render(<Input type="file" aria-label="上传文件" />)

    const input = screen.getByLabelText('上传文件')
    expect(input).toHaveAttribute('type', 'file')
  })

  it('handles onChange events', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input onChange={onChange} aria-label="事件输入" />)

    const input = screen.getByRole('textbox', { name: '事件输入' })
    await user.type(input, 'hello')
    expect(onChange).toHaveBeenCalled()
    expect(input).toHaveValue('hello')
  })

  it('does not allow typing when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input disabled onChange={onChange} aria-label="禁用事件" />)

    const input = screen.getByRole('textbox', { name: '禁用事件' })
    await user.type(input, 'x')
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('')
  })

  it('does not allow typing when read-only', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input readOnly onChange={onChange} defaultValue="固定" aria-label="只读事件" />)

    const input = screen.getByRole('textbox', { name: '只读事件' })
    await user.type(input, 'x')
    // readOnly 阻止用户输入变更值
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('固定')
  })

  it('renders with id and associated label', () => {
    render(
      <div>
        <label htmlFor="test-id">测试标签</label>
        <Input id="test-id" />
      </div>
    )

    const input = screen.getByLabelText('测试标签')
    expect(input).toHaveAttribute('id', 'test-id')
  })
})
