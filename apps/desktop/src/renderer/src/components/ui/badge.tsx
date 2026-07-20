import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  `inline-flex h-[22px] max-w-full shrink-0 items-center justify-center gap-[5px] overflow-hidden whitespace-nowrap rounded-[6px] border px-[7px] text-[11px] font-semibold leading-none shadow-level-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3`,
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        success: 'border-success-border bg-success-soft text-success-foreground',
        destructive:
          'border-destructive-border bg-destructive-soft text-destructive-soft-foreground',
        outline: 'border-border bg-transparent text-foreground'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

/**
 * Badge 的公开属性。
 *
 * 默认渲染 `div` 并接收原生 div 属性。`asChild` 为 true 时，Radix Slot 会把 Badge 的
 * 属性合并到唯一的 React 子元素上；元素专属属性应直接声明在该子元素上。
 */
export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

/**
 * 渲染用于展示状态或分类的轻量徽标。
 *
 * @param props - 徽标样式变体、原生 div 属性，以及可选的单子元素组合方式。
 * @returns 徽标组件。
 * @throws 此组件不会主动抛出错误。
 */
function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: BadgeProps): React.JSX.Element {
  const Comp = asChild ? Slot : 'div'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
