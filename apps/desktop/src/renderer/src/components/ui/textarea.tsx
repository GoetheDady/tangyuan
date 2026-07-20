import * as React from 'react'

import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-all duration-200 ease-(--ease-standard) placeholder:text-muted-foreground hover:border-input-hover focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:text-disabled-foreground disabled:bg-disabled/25 read-only:border-split read-only:bg-background aria-invalid:border-destructive aria-invalid:ring-destructive/20 resize-vertical md:text-sm',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
