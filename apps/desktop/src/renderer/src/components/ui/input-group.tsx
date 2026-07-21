import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type InputGroupControlElement = HTMLInputElement | HTMLTextAreaElement

type InputGroupContextValue = {
  disabled: boolean
  invalid: boolean
  setControl: React.Dispatch<React.SetStateAction<InputGroupControlElement | null>>
  focusControl: () => void
}

const InputGroupContext = React.createContext<InputGroupContextValue | null>(null)

type InputGroupProps = React.ComponentPropsWithoutRef<'div'> & {
  disabled?: boolean
  invalid?: boolean
}

const InputGroup = React.forwardRef<HTMLDivElement, InputGroupProps>(
  ({ children, className, disabled = false, invalid = false, ...props }, ref) => {
    const [control, setControl] = React.useState<InputGroupControlElement | null>(null)
    const focusControl = React.useCallback(() => {
      if (control && !control.disabled) {
        control.focus()
      }
    }, [control])
    const context = React.useMemo(
      () => ({ disabled, invalid, setControl, focusControl }),
      [disabled, focusControl, invalid]
    )

    return (
      <InputGroupContext.Provider value={context}>
        <div
          ref={ref}
          role="group"
          data-slot="input-group"
          data-disabled={disabled || undefined}
          data-invalid={invalid || undefined}
          aria-disabled={disabled || undefined}
          className={cn(
            'group/input-group relative flex h-9 w-full min-w-0 items-center rounded-lg border border-input bg-transparent transition-all duration-200 ease-(--ease-standard) outline-none hover:border-input-hover focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:bg-disabled/25 data-[invalid=true]:border-destructive data-[invalid=true]:ring-[3px] data-[invalid=true]:ring-destructive/20 has-[[data-slot=input-group-control][aria-invalid=true]]:border-destructive has-[[data-slot=input-group-control][aria-invalid=true]]:ring-[3px] has-[[data-slot=input-group-control][aria-invalid=true]]:ring-destructive/20 has-[>textarea]:h-auto has-[>textarea]:items-stretch has-[>textarea]:rounded-[10px]',
            'has-[>[data-align=inline-start]]:[&>input]:pl-0 has-[>[data-align=inline-end]]:[&>input]:pr-0',
            'has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:items-stretch',
            'has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:items-stretch',
            className
          )}
          {...props}
        >
          {children}
        </div>
      </InputGroupContext.Provider>
    )
  }
)
InputGroup.displayName = 'InputGroup'

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:cursor-not-allowed group-data-[disabled=true]/input-group:text-disabled-foreground [&>svg]:pointer-events-none [&>svg]:shrink-0 [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        'inline-start': 'order-first pl-2.5 has-[>button]:-ml-2',
        'inline-end': 'order-last pr-2.5 has-[>button]:-mr-2',
        'block-start': 'order-first w-full justify-start border-b border-split px-3 pt-3 pb-2.5',
        'block-end': 'order-last w-full justify-between px-3 pt-2 pb-3'
      }
    },
    defaultVariants: {
      align: 'inline-start'
    }
  }
)

type InputGroupAddonProps = React.ComponentPropsWithoutRef<'div'> &
  VariantProps<typeof inputGroupAddonVariants>

const InputGroupAddon = React.forwardRef<HTMLDivElement, InputGroupAddonProps>(
  ({ align = 'inline-start', className, onClick, ...props }, ref) => {
    const group = React.useContext(InputGroupContext)

    return (
      <div
        ref={ref}
        role="group"
        data-slot="input-group-addon"
        data-align={align}
        className={cn(inputGroupAddonVariants({ align }), className)}
        onClick={(event) => {
          onClick?.(event)

          if (
            event.defaultPrevented ||
            group?.disabled ||
            (event.target as HTMLElement).closest('button')
          ) {
            return
          }

          group?.focusControl()
        }}
        {...props}
      />
    )
  }
)
InputGroupAddon.displayName = 'InputGroupAddon'

const inputGroupButtonVariants = cva('flex items-center gap-2 text-sm shadow-none', {
  variants: {
    size: {
      xs: "h-6 gap-1 rounded-[5px] px-2 text-[11px] [&_svg:not([class*='size-'])]:size-3.5",
      sm: 'h-8 gap-1.5 rounded-md px-2.5 text-xs [&_svg:not([class*="size-"])]:size-[14px]',
      'icon-xs': "size-6 rounded-[5px] p-0 [&_svg:not([class*='size-'])]:size-3.5",
      'icon-sm': 'size-8 rounded-md p-0 [&_svg:not([class*="size-"])]:size-[14px]'
    }
  },
  defaultVariants: {
    size: 'icon-sm'
  }
})

type InputGroupButtonProps = Omit<React.ComponentPropsWithoutRef<typeof Button>, 'size'> &
  VariantProps<typeof inputGroupButtonVariants>

const InputGroupButton = React.forwardRef<HTMLButtonElement, InputGroupButtonProps>(
  (
    { className, disabled, type = 'button', variant = 'ghost', size = 'icon-sm', ...props },
    ref
  ) => {
    const group = React.useContext(InputGroupContext)

    return (
      <Button
        ref={ref}
        type={type}
        variant={variant}
        size="default"
        data-slot="input-group-button"
        data-size={size}
        disabled={Boolean(group?.disabled || disabled)}
        className={cn(inputGroupButtonVariants({ size }), className)}
        {...props}
      />
    )
  }
)
InputGroupButton.displayName = 'InputGroupButton'

const InputGroupText = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<'span'>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="input-group-text"
      className={cn(
        "flex items-center gap-2 text-sm font-normal text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
)
InputGroupText.displayName = 'InputGroupText'

const InputGroupInput = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(
  ({ className, disabled, 'aria-invalid': ariaInvalid, ...props }, ref) => {
    const [setControlRef, isDisabled, resolvedAriaInvalid] = useInputGroupControl(
      ref,
      disabled,
      ariaInvalid
    )

    return (
      <Input
        ref={setControlRef}
        data-slot="input-group-control"
        disabled={isDisabled}
        aria-invalid={resolvedAriaInvalid}
        className={cn(
          'min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent',
          className
        )}
        {...props}
      />
    )
  }
)
InputGroupInput.displayName = 'InputGroupInput'

const InputGroupTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<'textarea'>
>(({ className, disabled, 'aria-invalid': ariaInvalid, ...props }, ref) => {
  const [setControlRef, isDisabled, resolvedAriaInvalid] = useInputGroupControl(
    ref,
    disabled,
    ariaInvalid
  )

  return (
    <Textarea
      ref={setControlRef}
      data-slot="input-group-control"
      disabled={isDisabled}
      aria-invalid={resolvedAriaInvalid}
      className={cn(
        'min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent px-3 py-3 shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent',
        className
      )}
      {...props}
    />
  )
})
InputGroupTextarea.displayName = 'InputGroupTextarea'

function useInputGroupControl<T extends InputGroupControlElement>(
  forwardedRef: React.ForwardedRef<T>,
  disabled: boolean | undefined,
  ariaInvalid: React.AriaAttributes['aria-invalid']
): readonly [React.RefCallback<T>, boolean, React.AriaAttributes['aria-invalid']] {
  const group = React.useContext(InputGroupContext)
  const setGroupControl = group?.setControl
  const setControlRef = React.useCallback(
    (node: T | null) => {
      setGroupControl?.(node)
      assignRef(forwardedRef, node)
    },
    [forwardedRef, setGroupControl]
  )

  return [
    setControlRef,
    Boolean(group?.disabled || disabled),
    group?.invalid ? true : ariaInvalid
  ] as const
}

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
    return
  }

  if (ref) {
    ref.current = value
  }
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea
}
