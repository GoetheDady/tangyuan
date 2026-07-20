import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

function renderSelect({
  defaultValue,
  placeholder,
  disabled,
  invalid,
  className,
  size,
  onValueChange,
  children
}: {
  defaultValue?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  size?: 'sm' | 'default'
  onValueChange?: (value: string) => void
  children?: React.ReactNode
} = {}) {
  return render(
    <Select defaultValue={defaultValue} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label="测试选择器"
        disabled={disabled}
        aria-invalid={invalid ? 'true' : undefined}
        className={className}
        size={size}
      >
        <SelectValue placeholder={placeholder ?? '请选择'} />
      </SelectTrigger>
      <SelectContent>
        {children ?? (
          <>
            <SelectItem value="a">选项 A</SelectItem>
            <SelectItem value="b">选项 B</SelectItem>
            <SelectItem value="c">选项 C</SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  )
}

describe('Select', () => {
  it('renders a combobox trigger element', () => {
    renderSelect()

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    expect(trigger).toBeInTheDocument()
    expect(trigger.tagName).toBe('BUTTON')
  })

  it('renders placeholder when no default value is set', () => {
    renderSelect({ placeholder: '选择一个选项' })

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    expect(trigger).toHaveTextContent('选择一个选项')
  })

  it('renders the selected value when defaultValue is provided', () => {
    renderSelect({ defaultValue: 'b' })

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    expect(trigger).toHaveTextContent('选项 B')
  })

  it('forwards ref to the trigger element', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Select>
        <SelectTrigger ref={ref} aria-label="Ref 选择器">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
      </Select>
    )

    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current?.tagName).toBe('BUTTON')
  })

  it('merges className without snapshotting full class string', () => {
    renderSelect({ className: 'custom-select-class' })

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    expect(trigger.className).toContain('custom-select-class')
    // 不断言完整的 Tailwind class 字符串，只验证合并行为
    expect(trigger.className).toContain('flex')
  })

  it('matches Input hover and keyboard-focus treatment while preserving the open state ring', () => {
    render(
      <>
        <Input aria-label="参照输入框" />
        <Select>
          <SelectTrigger aria-label="测试选择器">
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
        </Select>
      </>
    )

    const input = screen.getByRole('textbox', { name: '参照输入框' })
    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    const sharedInteractionClasses = [
      'hover:border-input-hover',
      'focus-visible:outline-none',
      'focus-visible:border-ring',
      'focus-visible:ring-[3px]',
      'focus-visible:ring-ring/25'
    ]

    for (const className of sharedInteractionClasses) {
      expect(input.className).toContain(className)
      expect(trigger.className).toContain(className)
    }

    expect(trigger.className).toContain('data-[state=open]:border-ring')
    expect(trigger.className).toContain('data-[state=open]:ring-[3px]')
    expect(trigger.className).toContain('data-[state=open]:ring-ring/25')
    expect(trigger.className).not.toContain('shadow-level-0')
  })

  it('supports the Pencil small trigger size', () => {
    renderSelect({ size: 'sm' })

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    expect(trigger).toHaveAttribute('data-size', 'sm')
    expect(trigger.className).toContain('data-[size=sm]:h-8')
    expect(trigger.className).toContain('data-[size=default]:h-9')
    expect(trigger.className).toContain('data-[size=sm]:text-xs')
    expect(trigger.className).toContain('data-[size=default]:md:text-sm')
  })

  it('uses the Pencil popup height and item highlight states', async () => {
    const user = userEvent.setup()
    renderSelect({ defaultValue: 'b' })

    await user.click(screen.getByRole('combobox', { name: '测试选择器' }))

    const listbox = screen.getByRole('listbox')
    const selectedOption = screen.getByRole('option', { name: '选项 B' })

    expect(listbox.className).toContain('max-h-80')
    expect(selectedOption.className).toContain('data-[highlighted]:bg-accent')
    expect(selectedOption.className).toContain('data-[state=checked]:bg-accent')
  })

  it('renders disabled state', () => {
    renderSelect({ disabled: true })

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    expect(trigger).toBeDisabled()
  })

  it('renders aria-invalid state', () => {
    renderSelect({ invalid: true })

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
  })

  it('opens content on click and shows items in portal', async () => {
    const user = userEvent.setup()
    renderSelect()

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    await user.click(trigger)

    // Content 通过 Portal 渲染到 document.body
    expect(screen.getByRole('option', { name: '选项 A' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '选项 B' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '选项 C' })).toBeInTheDocument()
  })

  it('calls onValueChange when an item is selected', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    renderSelect({ onValueChange })

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    await user.click(trigger)

    const optionB = screen.getByRole('option', { name: '选项 B' })
    await user.click(optionB)

    expect(onValueChange).toHaveBeenCalledWith('b')
  })

  it('does not call onValueChange when a disabled item is clicked', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger aria-label="测试选择器">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">选项 A</SelectItem>
          <SelectItem value="b" disabled>
            选项 B（禁用）
          </SelectItem>
          <SelectItem value="c">选项 C</SelectItem>
        </SelectContent>
      </Select>
    )

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    await user.click(trigger)

    const optionB = screen.getByRole('option', { name: '选项 B（禁用）' })
    expect(optionB).toHaveAttribute('aria-disabled', 'true')

    await user.click(optionB)

    // 禁用项点击不应触发 onValueChange
    expect(onValueChange).not.toHaveBeenCalledWith('b')
  })

  it('renders SelectGroup with SelectLabel', async () => {
    const user = userEvent.setup()

    render(
      <Select>
        <SelectTrigger aria-label="测试选择器">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>水果</SelectLabel>
            <SelectItem value="apple">苹果</SelectItem>
            <SelectItem value="banana">香蕉</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>蔬菜</SelectLabel>
            <SelectItem value="carrot">胡萝卜</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    )

    await user.click(screen.getByRole('combobox', { name: '测试选择器' }))

    expect(screen.getByText('水果')).toBeInTheDocument()
    expect(screen.getByText('蔬菜')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '苹果' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '香蕉' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '胡萝卜' })).toBeInTheDocument()
  })

  it('renders SelectSeparator between items', async () => {
    const user = userEvent.setup()

    render(
      <Select>
        <SelectTrigger aria-label="测试选择器">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">选项 A</SelectItem>
          <SelectSeparator data-testid="select-separator" />
          <SelectItem value="b">选项 B</SelectItem>
        </SelectContent>
      </Select>
    )

    await user.click(screen.getByRole('combobox', { name: '测试选择器' }))

    // Radix Select.Separator 渲染为 role="presentation" + aria-hidden
    const separator = screen.getByTestId('select-separator')
    expect(separator).toBeInTheDocument()
    expect(separator).toHaveAttribute('aria-hidden', 'true')
  })

  it('closes content on Escape key', async () => {
    const user = userEvent.setup()
    renderSelect()

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    await user.click(trigger)

    expect(screen.getByRole('option', { name: '选项 A' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('option', { name: '选项 A' })).not.toBeInTheDocument()
  })

  it('does not open when disabled', async () => {
    const user = userEvent.setup()
    renderSelect({ disabled: true })

    const trigger = screen.getByRole('combobox', { name: '测试选择器' })
    await user.click(trigger)

    // 禁用时不应渲染选项
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('exports all public sub-components', () => {
    // 验证所有公共 API 都存在
    expect(Select).toBeDefined()
    expect(SelectGroup).toBeDefined()
    expect(SelectValue).toBeDefined()
    expect(SelectTrigger).toBeDefined()
    expect(SelectContent).toBeDefined()
    expect(SelectLabel).toBeDefined()
    expect(SelectItem).toBeDefined()
    expect(SelectSeparator).toBeDefined()
  })
})
