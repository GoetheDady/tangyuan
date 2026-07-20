import * as React from 'react'
import * as SeparatorPrimitive from '@radix-ui/react-separator'

import { cn } from '@/lib/utils'

/**
 * 渲染低干扰的内容分隔线，并保留 Radix Separator 的方向与语义。
 *
 * @param props - Radix Separator 属性、方向、语义与样式扩展。
 * @returns 默认不向辅助技术暴露的 Level 0 分隔线。
 * @throws 此组件不会主动抛出错误。
 */
const Separator = React.forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    data-slot="separator"
    data-level="0"
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'shrink-0 bg-border shadow-level-0',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className
    )}
    {...props}
  />
))
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
