import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const fieldVariants = cva(
  'group/field grid w-full min-w-0 gap-2 data-[invalid=true]:text-destructive',
  {
    variants: {
      orientation: {
        vertical: 'grid-cols-1',
        horizontal:
          'grid-cols-1 @md/field-group:grid-cols-[120px_minmax(0,1fr)] @md/field-group:items-start @md/field-group:gap-x-3 @md/field-group:gap-y-0'
      }
    },
    defaultVariants: {
      orientation: 'vertical'
    }
  }
)

type FieldContextValue = {
  controlId: string
  fallbackControlId: string
  setControlId: React.Dispatch<React.SetStateAction<string | null>>
  descriptionIds: string[]
  errorIds: string[]
  invalid: boolean
  disabled: boolean
  required: boolean
  optional: boolean
  registerDescription: (id: string) => () => void
  registerError: (id: string) => () => void
}

const FieldContext = React.createContext<FieldContextValue | null>(null)

type FieldProps = React.ComponentPropsWithoutRef<'div'> &
  VariantProps<typeof fieldVariants> & {
    controlId?: string
    invalid?: boolean
    disabled?: boolean
    required?: boolean
    optional?: boolean
  }

const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  (
    {
      children,
      className,
      controlId,
      orientation = 'vertical',
      invalid = false,
      disabled = false,
      required = false,
      optional = false,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId()
    const fallbackControlId = controlId ?? `${generatedId}-control`
    const [registeredControlId, setControlId] = React.useState<string | null>(null)
    const [descriptionIds, registerDescription] = useRegisteredIds()
    const [errorIds, registerError] = useRegisteredIds()

    const context = React.useMemo<FieldContextValue>(
      () => ({
        controlId: registeredControlId ?? fallbackControlId,
        fallbackControlId,
        setControlId,
        descriptionIds,
        errorIds,
        invalid,
        disabled,
        required,
        optional: !required && optional,
        registerDescription,
        registerError
      }),
      [
        descriptionIds,
        disabled,
        errorIds,
        fallbackControlId,
        invalid,
        optional,
        registerDescription,
        registerError,
        registeredControlId,
        required
      ]
    )

    return (
      <FieldContext.Provider value={context}>
        <div
          ref={ref}
          role="group"
          data-slot="field"
          data-orientation={orientation}
          data-invalid={invalid || undefined}
          data-disabled={disabled || undefined}
          data-required={required || undefined}
          data-optional={!required && optional ? true : undefined}
          aria-disabled={disabled || undefined}
          className={cn(fieldVariants({ orientation }), className)}
          {...props}
        >
          {children}
        </div>
      </FieldContext.Provider>
    )
  }
)
Field.displayName = 'Field'

const FieldGroup = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="field-group"
      className={cn(
        'group/field-group @container/field-group flex w-full min-w-0 flex-col gap-5',
        className
      )}
      {...props}
    />
  )
)
FieldGroup.displayName = 'FieldGroup'

const FieldContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="field-content"
      className={cn('flex min-w-0 flex-1 flex-col gap-1', className)}
      {...props}
    />
  )
)
FieldContent.displayName = 'FieldContent'

type FieldLabelProps = React.ComponentPropsWithoutRef<typeof Label> & {
  required?: boolean
  optional?: boolean
}

const FieldLabel = React.forwardRef<React.ComponentRef<typeof Label>, FieldLabelProps>(
  ({ children, className, htmlFor, required, optional, ...props }, ref) => {
    const field = React.useContext(FieldContext)
    const isRequired = required ?? field?.required ?? false
    const isOptional = !isRequired && (optional ?? field?.optional ?? false)

    return (
      <Label
        ref={ref}
        htmlFor={htmlFor ?? field?.controlId}
        data-slot="field-label"
        data-required={isRequired || undefined}
        data-optional={isOptional || undefined}
        className={cn(
          'flex w-fit items-center gap-1 text-xs leading-5 group-data-[disabled=true]/field:text-disabled-foreground group-data-[invalid=true]/field:text-destructive group-data-[orientation=horizontal]/field:w-full',
          className
        )}
        {...props}
      >
        {children}
        {isRequired ? (
          <span
            data-slot="field-required"
            aria-hidden="true"
            className="font-semibold text-destructive"
          >
            *
          </span>
        ) : isOptional ? (
          <span
            data-slot="field-optional"
            className="ml-0.5 text-[10px] font-normal text-muted-foreground"
          >
            （可选）
          </span>
        ) : null}
      </Label>
    )
  }
)
FieldLabel.displayName = 'FieldLabel'

type FieldControlElementProps = {
  id?: string
  disabled?: boolean
  required?: boolean
  'aria-invalid'?: React.AriaAttributes['aria-invalid']
  'aria-describedby'?: string
  'aria-required'?: React.AriaAttributes['aria-required']
}

type FieldControlProps = {
  children: React.ReactElement<FieldControlElementProps>
}

function FieldControl({ children }: FieldControlProps): React.JSX.Element {
  const field = React.useContext(FieldContext)
  const setControlId = field?.setControlId
  const controlId = children.props.id ?? field?.fallbackControlId
  React.useLayoutEffect(() => {
    if (controlId) {
      setControlId?.(controlId)
    }
  }, [controlId, setControlId])

  if (!field || !controlId) {
    return children
  }

  const describedBy = mergeIds(
    children.props['aria-describedby'],
    ...field.descriptionIds,
    ...field.errorIds
  )

  return React.cloneElement(children, {
    id: controlId,
    disabled: field.disabled || children.props.disabled,
    required: field.required || children.props.required,
    'aria-required': field.required ? true : children.props['aria-required'],
    'aria-invalid': field.invalid ? true : children.props['aria-invalid'],
    'aria-describedby': describedBy
  })
}

const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<'p'>
>(({ className, id, ...props }, ref) => {
  const field = React.useContext(FieldContext)
  const generatedId = React.useId()
  const descriptionId = id ?? (field ? `${field.controlId}-description` : generatedId)

  const registerDescription = field?.registerDescription
  React.useLayoutEffect(
    () => registerDescription?.(descriptionId),
    [descriptionId, registerDescription]
  )

  return (
    <p
      ref={ref}
      id={descriptionId}
      data-slot="field-description"
      className={cn(
        'm-0 text-[11px] leading-[18px] font-normal text-muted-foreground group-data-[disabled=true]/field:text-disabled-foreground',
        className
      )}
      {...props}
    />
  )
})
FieldDescription.displayName = 'FieldDescription'

type FieldErrorProps = React.ComponentPropsWithoutRef<'div'> & {
  errors?: Array<{ message?: string } | undefined>
}

const FieldError = React.forwardRef<HTMLDivElement, FieldErrorProps>(
  ({ children, className, errors, id, ...props }, ref) => {
    const field = React.useContext(FieldContext)
    const generatedId = React.useId()
    const errorId = id ?? (field ? `${field.controlId}-error` : generatedId)
    const content = React.useMemo(() => {
      if (children) {
        return children
      }

      const uniqueMessages = [
        ...new Set(errors?.map((error) => error?.message).filter(Boolean) as string[])
      ]

      if (uniqueMessages.length === 0) {
        return null
      }

      if (uniqueMessages.length === 1) {
        return uniqueMessages[0]
      }

      return (
        <ul className="ml-4 flex list-disc flex-col gap-1">
          {uniqueMessages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )
    }, [children, errors])

    const registerError = field?.registerError
    const hasContent = Boolean(content)
    React.useLayoutEffect(
      () => (hasContent ? registerError?.(errorId) : undefined),
      [errorId, hasContent, registerError]
    )

    if (!content) {
      return null
    }

    return (
      <div
        ref={ref}
        id={errorId}
        role="alert"
        data-slot="field-error"
        className={cn('text-[11px] leading-[18px] font-normal text-destructive', className)}
        {...props}
      >
        {content}
      </div>
    )
  }
)
FieldError.displayName = 'FieldError'

function useRegisteredIds(): readonly [string[], (id: string) => () => void] {
  const [ids, setIds] = React.useState<string[]>([])
  const register = React.useCallback((id: string) => {
    setIds((currentIds) => (currentIds.includes(id) ? currentIds : [...currentIds, id]))

    return () => setIds((currentIds) => currentIds.filter((item) => item !== id))
  }, [])

  return [ids, register] as const
}

function mergeIds(...values: Array<string | undefined>): string | undefined {
  const ids = [...new Set(values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? []))]

  return ids.length > 0 ? ids.join(' ') : undefined
}

export { Field, FieldContent, FieldControl, FieldDescription, FieldError, FieldGroup, FieldLabel }
