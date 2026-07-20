import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'

import { cn } from '@/lib/utils'

const cardVariants = cva('overflow-hidden rounded-lg border bg-card text-card-foreground', {
  variants: {
    size: {
      default: '[--card-padding:1.25rem]',
      compact: '[--card-padding:1rem]'
    },
    interactive: {
      false: 'shadow-level-0',
      true: 'block w-full cursor-pointer appearance-none p-0 text-left font-[inherit] transition-[background-color,border-color,box-shadow,opacity] duration-200 ease-(--ease-standard) hover:border-input-hover focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 active:border-input-hover active:bg-secondary aria-pressed:border-primary aria-pressed:bg-secondary aria-selected:border-primary aria-selected:bg-secondary disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[var(--disabled-opacity)] aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-[var(--disabled-opacity)]'
    }
  },
  defaultVariants: {
    size: 'default',
    interactive: false
  }
})

type CardSizeProps = Pick<VariantProps<typeof cardVariants>, 'size'>

type StaticCardProps = React.HTMLAttributes<HTMLDivElement> &
  CardSizeProps & {
    interactive?: false
    asChild?: false
  }

type InteractiveCardProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  CardSizeProps & {
    interactive: true
    asChild?: false
  }

type InteractiveChildCardProps = React.HTMLAttributes<HTMLElement> &
  CardSizeProps & {
    interactive: true
    asChild: true
  }

type CardProps = StaticCardProps | InteractiveCardProps | InteractiveChildCardProps

type CardComponent = {
  (props: StaticCardProps & React.RefAttributes<HTMLDivElement>): React.ReactElement | null
  (props: InteractiveCardProps & React.RefAttributes<HTMLButtonElement>): React.ReactElement | null
  (props: InteractiveChildCardProps & React.RefAttributes<HTMLElement>): React.ReactElement | null
  displayName?: string
}

const Card = React.forwardRef<HTMLElement, CardProps>(
  ({ className, size = 'default', interactive = false, asChild = false, ...props }, ref) => {
    const Comp: React.ElementType = asChild ? Slot : interactive ? 'button' : 'div'
    const semanticProps =
      interactive && !asChild
        ? { type: (props as React.ButtonHTMLAttributes<HTMLButtonElement>).type ?? 'button' }
        : undefined

    return (
      <Comp
        ref={ref}
        data-slot="card"
        data-size={size}
        data-level="0"
        data-interactive={interactive ? 'true' : 'false'}
        className={cn(cardVariants({ size, interactive }), className)}
        {...props}
        {...semanticProps}
      />
    )
  }
) as CardComponent
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn(
        'flex flex-col gap-1.5 border-b border-split p-[var(--card-padding)]',
        className
      )}
      {...props}
    />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-title"
      className={cn('text-base font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
)
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-description"
      className={cn('text-[13px] leading-[1.5] text-muted-foreground', className)}
      {...props}
    />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-content"
      className={cn('p-[var(--card-padding)]', className)}
      {...props}
    />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-footer"
      className={cn(
        'flex items-center justify-end gap-2 border-t border-split p-[var(--card-padding)]',
        className
      )}
      {...props}
    />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants }
