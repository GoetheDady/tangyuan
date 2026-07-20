import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const contentPropsSpy = vi.hoisted(() => vi.fn())
const subContentPropsSpy = vi.hoisted(() => vi.fn())
const subPropsSpy = vi.hoisted(() => vi.fn())

vi.mock('@radix-ui/react-dropdown-menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@radix-ui/react-dropdown-menu')>()
  const ReactModule = await import('react')
  const Content = ReactModule.forwardRef<
    React.ComponentRef<typeof actual.Content>,
    React.ComponentPropsWithoutRef<typeof actual.Content>
  >((props, ref) => {
    contentPropsSpy(props)
    return ReactModule.createElement(actual.Content, { ...props, ref })
  })
  Content.displayName = actual.Content.displayName

  function Sub(props: React.ComponentProps<typeof actual.Sub>) {
    subPropsSpy(props)
    return ReactModule.createElement(actual.Sub, props)
  }

  const SubContent = ReactModule.forwardRef<
    React.ComponentRef<typeof actual.SubContent>,
    React.ComponentPropsWithoutRef<typeof actual.SubContent>
  >((props, ref) => {
    subContentPropsSpy(props)
    return ReactModule.createElement(actual.SubContent, { ...props, ref })
  })
  SubContent.displayName = actual.SubContent.displayName

  return { ...actual, Content, Sub, SubContent }
})

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

describe('DropdownMenu', () => {
  beforeEach(() => {
    contentPropsSpy.mockClear()
    subContentPropsSpy.mockClear()
    subPropsSpy.mockClear()
  })

  it('preserves the public composition API, Portal behavior, props, className and refs', () => {
    const triggerRef = createRef<HTMLButtonElement>()
    const contentRef = createRef<HTMLDivElement>()
    const { container } = render(
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger ref={triggerRef}>打开操作菜单</DropdownMenuTrigger>
        <DropdownMenuContent
          ref={contentRef}
          data-testid="dropdown-menu-content"
          className="custom-content"
        >
          <DropdownMenuLabel>Agent 操作</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem>
              重命名
              <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const trigger = screen.getByRole('button', { name: '打开操作菜单' })
    const content = screen.getByTestId('dropdown-menu-content')

    expect(DropdownMenu).toBeDefined()
    expect(DropdownMenuTrigger).toBeDefined()
    expect(DropdownMenuPortal).toBeDefined()
    expect(DropdownMenuItemIndicator).toBeDefined()
    expect(triggerRef.current).toBe(trigger)
    expect(contentRef.current).toBe(content)
    expect(container).not.toContainElement(content)
    expect(document.body).toContainElement(content)
    expect(content).toHaveAttribute('data-slot', 'dropdown-menu-content')
    expect(content).toHaveAttribute('data-level', '2')
    expect(content).toHaveClass('custom-content')
    expect(screen.getByRole('menuitem', { name: /重命名/ })).toBeInTheDocument()
  })

  it('uses the required Level 2 menu geometry and distinguishable item states', () => {
    render(
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>打开样式菜单</DropdownMenuTrigger>
        <DropdownMenuContent data-testid="dropdown-menu-content">
          <DropdownMenuLabel>Agent 操作</DropdownMenuLabel>
          <DropdownMenuItem>普通操作</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">归档 Agent</DropdownMenuItem>
          <DropdownMenuItem disabled>禁用操作</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>显示时间戳</DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="detailed">
            <DropdownMenuRadioItem value="compact" onSelect={(event) => event.preventDefault()}>
              紧凑
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="detailed" onSelect={(event) => event.preventDefault()}>
              详细
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const content = screen.getByTestId('dropdown-menu-content')
    for (const className of ['min-w-32', 'rounded-[6px]', 'p-1', 'shadow-level-2']) {
      expect(content.className).toContain(className)
    }
    expect(contentPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ sideOffset: 4 }))

    const regularItem = screen.getByRole('menuitem', { name: '普通操作' })
    for (const className of ['h-8', 'px-2', 'text-sm']) {
      expect(regularItem.className).toContain(className)
    }

    const destructiveItem = screen.getByRole('menuitem', { name: '归档 Agent' })
    expect(destructiveItem).toHaveAttribute('data-variant', 'destructive')
    expect(destructiveItem.className).toContain('data-[variant=destructive]:text-destructive')

    const disabledItem = screen.getByRole('menuitem', { name: '禁用操作' })
    expect(disabledItem).toHaveAttribute('data-disabled')
    expect(disabledItem.className).toContain('data-[disabled]:pointer-events-none')

    const checkbox = screen.getByRole('menuitemcheckbox', { name: '显示时间戳' })
    expect(checkbox).toHaveAttribute('data-state', 'checked')
    expect(checkbox.querySelector('[data-slot="dropdown-menu-item-indicator"]')).toBeInTheDocument()

    const selectedRadio = screen.getByRole('menuitemradio', { name: '详细' })
    expect(selectedRadio).toHaveAttribute('data-state', 'checked')
  })

  it('forwards item, checkbox and radio callbacks while disabled items stay inactive', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onDisabledSelect = vi.fn()
    const onCheckedChange = vi.fn()
    const onValueChange = vi.fn()

    render(
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>打开回调菜单</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>重命名</DropdownMenuItem>
          <DropdownMenuItem disabled onSelect={onDisabledSelect}>
            禁用操作
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            defaultChecked={false}
            onCheckedChange={onCheckedChange}
            onSelect={(event) => event.preventDefault()}
          >
            显示时间戳
          </DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup defaultValue="compact" onValueChange={onValueChange}>
            <DropdownMenuRadioItem value="compact" onSelect={(event) => event.preventDefault()}>
              紧凑
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="detailed" onSelect={(event) => event.preventDefault()}>
              详细
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByRole('menuitemcheckbox', { name: '显示时间戳' }))
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    await user.click(screen.getByRole('menuitem', { name: '禁用操作' }))
    expect(onDisabledSelect).not.toHaveBeenCalled()

    await user.click(screen.getByRole('menuitemradio', { name: '详细' }))
    expect(onValueChange).toHaveBeenCalledWith('detailed')

    await user.click(screen.getByRole('menuitem', { name: '重命名' }))
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('supports controlled and uncontrolled submenu state with the required public composition', () => {
    const onControlledOpenChange = vi.fn()

    const uncontrolled = render(
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>打开非受控子菜单</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub defaultOpen>
            <DropdownMenuSubTrigger>移动到</DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-testid="uncontrolled-submenu">
              <DropdownMenuItem>归档区</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    expect(subPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ defaultOpen: true }))
    expect(screen.getByRole('menuitem', { name: '移动到' })).toHaveAttribute(
      'data-slot',
      'dropdown-menu-sub-trigger'
    )

    uncontrolled.unmount()
    subContentPropsSpy.mockClear()
    subPropsSpy.mockClear()

    render(
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>打开受控子菜单</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub open onOpenChange={onControlledOpenChange}>
            <DropdownMenuSubTrigger>共享到</DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-testid="controlled-submenu" sideOffset={8}>
              <DropdownMenuItem>工作空间</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    expect(subPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ open: true, onOpenChange: onControlledOpenChange })
    )
    expect(screen.getByTestId('controlled-submenu')).toHaveAttribute('data-level', '2')
    expect(subContentPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ sideOffset: 8 }))
    expect(onControlledOpenChange).toHaveBeenCalledWith(false)
  })
})
