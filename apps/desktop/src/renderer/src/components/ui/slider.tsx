import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'

import { cn } from '@/lib/utils'

/**
 * 紧凑型单值滑块：按 Pencil 规范渲染 5px 轨道与 12px thumb。
 *
 * 交互能力（来自 Radix）：拖拽 thumb、点击轨道跳转、方向键逐档调节、
 * Home/End 直达两端；禁用时由 Root 统一接管 pointer 事件。
 * `role="slider"` 位于 Thumb 上，`aria-label` 与 `aria-valuetext`
 * 会被转发到 Thumb 供无障碍与测试使用。
 *
 * @param props - Radix Slider Root 属性与样式扩展。
 * @returns 滑块组件树。
 * @throws 此组件不会主动抛出错误。
 */
const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(
  (
    {
      className,
      'aria-label': ariaLabel,
      'aria-valuetext': ariaValueText,
      ...props
    },
    ref,
  ) => (
    <SliderPrimitive.Root
      ref={ref}
      data-slot="slider"
      className={cn(
        'relative flex w-full cursor-pointer touch-none items-center select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        data-testid="slider-track"
        className="bg-border relative h-[5px] w-full grow overflow-hidden rounded-full"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-primary absolute inset-y-0 left-0 rounded-full"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={ariaLabel}
        aria-valuetext={ariaValueText}
        className="border-primary bg-background focus-visible:ring-ring/25 block size-3 rounded-full border-2 shadow-sm transition-[width,height] duration-200 ease-(--ease-standard) hover:size-3.5 focus-visible:size-3.5 focus-visible:ring-[3px] focus-visible:outline-none active:size-3.5"
      />
    </SliderPrimitive.Root>
  ),
)

Slider.displayName = 'Slider'

export { Slider }
