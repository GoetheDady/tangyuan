import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  `inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200 ease-(--ease-standard) cursor-pointer outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-[--disabled-opacity] aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active disabled:bg-primary',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive-hover active:bg-destructive-active disabled:bg-destructive focus-visible:ring-destructive/20',
        outline:
          'border border-input bg-background hover:bg-secondary active:bg-split disabled:bg-background',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-split active:bg-border disabled:bg-secondary',
        ghost:
          'hover:bg-secondary active:bg-split disabled:bg-transparent',
        link: 'text-primary underline-offset-4 hover:underline active:opacity-70'
      },
      size: {
        default: 'h-9 px-3 py-2',
        xs: "h-6 gap-1 px-1.5 text-[11px] [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 px-2.5 text-xs [&_svg:not([class*="size-"])]:size-[14px]',
        lg: 'h-10 px-[18px]',
        icon: 'size-9',
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 [&_svg:not([class*="size-"])]:size-[14px]',
        'icon-lg': 'size-10'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
