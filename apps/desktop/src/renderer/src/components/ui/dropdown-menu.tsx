import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'

import { cn } from '@/lib/utils'

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuPortal = DropdownMenuPrimitive.Portal
const DropdownMenuGroup = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Group>
>((props, ref) => (
  <DropdownMenuPrimitive.Group ref={ref} data-slot="dropdown-menu-group" {...props} />
))
DropdownMenuGroup.displayName = DropdownMenuPrimitive.Group.displayName

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>((props, ref) => (
  <DropdownMenuPrimitive.Trigger ref={ref} data-slot="dropdown-menu-trigger" {...props} />
))
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName

const menuContentClassName =
  'z-50 min-w-32 overflow-hidden rounded-[6px] border bg-popover p-1 text-popover-foreground shadow-level-2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1'

const menuItemClassName =
  'relative flex h-8 cursor-default select-none items-center rounded-md px-2 text-sm outline-none transition-colors duration-200 focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:text-disabled-foreground data-[disabled]:opacity-55 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive-soft data-[variant=destructive]:focus:text-destructive-soft-foreground data-[variant=destructive]:data-[highlighted]:bg-destructive-soft data-[variant=destructive]:data-[highlighted]:text-destructive-soft-foreground'

const menuSelectionItemClassName = `${menuItemClassName} pl-8 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground`

const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPortal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      data-slot="dropdown-menu-content"
      data-level="2"
      sideOffset={sideOffset}
      className={cn(menuContentClassName, className)}
      {...props}
    />
  </DropdownMenuPortal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    data-slot="dropdown-menu-label"
    className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

type DropdownMenuItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  variant?: 'default' | 'destructive'
}

const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ className, variant = 'default', ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    data-slot="dropdown-menu-item"
    data-variant={variant}
    className={cn(menuItemClassName, className)}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuItemIndicator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.ItemIndicator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.ItemIndicator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.ItemIndicator
    ref={ref}
    data-slot="dropdown-menu-item-indicator"
    className={cn('absolute left-2 flex size-4 items-center justify-center', className)}
    {...props}
  />
))
DropdownMenuItemIndicator.displayName = DropdownMenuPrimitive.ItemIndicator.displayName

type DropdownMenuCheckboxItemProps = Omit<
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  'checked' | 'defaultChecked' | 'onCheckedChange'
> & {
  checked?: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>['checked']
  defaultChecked?: React.ComponentPropsWithoutRef<
    typeof DropdownMenuPrimitive.CheckboxItem
  >['checked']
  onCheckedChange?: React.ComponentPropsWithoutRef<
    typeof DropdownMenuPrimitive.CheckboxItem
  >['onCheckedChange']
}

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  DropdownMenuCheckboxItemProps
>(({ className, children, checked, defaultChecked = false, onCheckedChange, ...props }, ref) => {
  const [uncontrolledChecked, setUncontrolledChecked] = React.useState(defaultChecked)
  const resolvedChecked = checked ?? uncontrolledChecked

  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      data-slot="dropdown-menu-checkbox-item"
      checked={resolvedChecked}
      onCheckedChange={(nextChecked) => {
        if (checked === undefined) {
          setUncontrolledChecked(nextChecked)
        }
        onCheckedChange?.(nextChecked)
      }}
      className={cn(menuSelectionItemClassName, className)}
      {...props}
    >
      <DropdownMenuItemIndicator>
        <Check className="size-3.5" />
      </DropdownMenuItemIndicator>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
})
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName

type DropdownMenuRadioGroupProps = Omit<
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioGroup>,
  'value' | 'defaultValue' | 'onValueChange'
> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

const DropdownMenuRadioGroup = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.RadioGroup>,
  DropdownMenuRadioGroupProps
>(({ value, defaultValue, onValueChange, ...props }, ref) => {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
  const resolvedValue = value ?? uncontrolledValue

  return (
    <DropdownMenuPrimitive.RadioGroup
      ref={ref}
      data-slot="dropdown-menu-radio-group"
      value={resolvedValue}
      onValueChange={(nextValue) => {
        if (value === undefined) {
          setUncontrolledValue(nextValue)
        }
        onValueChange?.(nextValue)
      }}
      {...props}
    />
  )
})
DropdownMenuRadioGroup.displayName = DropdownMenuPrimitive.RadioGroup.displayName

const DropdownMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    data-slot="dropdown-menu-radio-item"
    className={cn(menuSelectionItemClassName, className)}
    {...props}
  >
    <DropdownMenuItemIndicator>
      <Circle className="size-2 fill-current" />
    </DropdownMenuItemIndicator>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    data-slot="dropdown-menu-separator"
    className={cn('-mx-1 my-1 h-px bg-split', className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ml-auto pl-4 text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  )
}

const DropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    data-slot="dropdown-menu-sub-trigger"
    className={cn(
      menuItemClassName,
      'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden="true" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    data-slot="dropdown-menu-sub-content"
    data-level="2"
    sideOffset={sideOffset}
    className={cn(menuContentClassName, className)}
    {...props}
  />
))
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItemIndicator,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
}
