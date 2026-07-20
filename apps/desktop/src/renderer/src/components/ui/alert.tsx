import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid w-full min-w-0 grid-cols-[0_minmax(0,1fr)] items-start gap-y-1 rounded-lg border px-4 py-3 text-sm shadow-level-0 has-[>svg]:grid-cols-[18px_minmax(0,1fr)] has-[>svg]:gap-x-3 [&>svg]:col-start-1 [&>svg]:row-span-2 [&>svg]:row-start-1 [&>svg]:size-[18px] [&>svg]:translate-y-px [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-card-foreground',
        info: 'border-info-border bg-info-soft text-info-foreground *:data-[slot=alert-description]:text-foreground',
        success:
          'border-success-border bg-success-soft text-success-foreground *:data-[slot=alert-description]:text-foreground',
        warning:
          'border-warning-border bg-warning-soft text-warning-foreground *:data-[slot=alert-description]:text-foreground',
        destructive:
          'border-destructive-border bg-destructive-soft text-destructive-soft-foreground *:data-[slot=alert-description]:text-foreground'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

/**
 * Alert 的公开属性：保留原生 div 属性，并提供状态语义变体。
 */
export interface AlertProps
  extends React.ComponentProps<'div'>, VariantProps<typeof alertVariants> {}

/**
 * 渲染页面内的持久状态反馈。
 *
 * @param props - 状态语义、原生 div 属性与内容组合。
 * @returns 具有 alert 默认语义的反馈容器。
 * @throws 此组件不会主动抛出错误。
 */
function Alert({ className, variant = 'default', ...props }: AlertProps): React.JSX.Element {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      data-level="0"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

/**
 * 渲染 Alert 的主要状态标题。
 *
 * @param props - 原生 div 属性。
 * @returns 可自然换行的标题区域。
 * @throws 此组件不会主动抛出错误。
 */
function AlertTitle({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'col-start-2 min-w-0 break-words text-sm font-semibold leading-5 tracking-tight',
        className
      )}
      {...props}
    />
  )
}

/**
 * 渲染 Alert 的说明与可选操作内容。
 *
 * @param props - 原生 div 属性。
 * @returns 支持多行文字、段落和操作内容的说明区域。
 * @throws 此组件不会主动抛出错误。
 */
function AlertDescription({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid min-w-0 justify-items-start gap-2 break-words text-sm leading-[22px] text-muted-foreground [&_p]:leading-[22px]',
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
