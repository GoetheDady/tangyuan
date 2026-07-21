import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

/**
 * 渲染通过 Portal 挂载的简短辅助说明，并保留 Radix Tooltip 的定位属性。
 *
 * @param props - Radix Tooltip Content 属性、方位、偏移和样式扩展。
 * @returns 默认优先显示在触发器上方的 Level 2 Tooltip 浮层。
 * @throws 此组件不会主动抛出错误。
 */
const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, side = 'top', sideOffset = 0, asChild = false, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      data-slot="tooltip-content"
      data-level="2"
      side={side}
      sideOffset={sideOffset}
      asChild={asChild}
      className={cn(
        'z-50 rounded-[6px] bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-level-2',
        className
      )}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {children}
          <TooltipPrimitive.Arrow
            data-slot="tooltip-arrow"
            width={10}
            height={5}
            className="fill-primary"
          />
        </>
      )}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
