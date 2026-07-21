import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import {
  Field,
  FieldContent,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'

function AccessibleField(props: { invalid?: boolean; disabled?: boolean }): React.JSX.Element {
  return (
    <Field controlId="provider" invalid={props.invalid} disabled={props.disabled}>
      <FieldLabel>模型服务</FieldLabel>
      <FieldContent>
        <FieldControl>
          <Input />
        </FieldControl>
        <FieldDescription>选择用于当前 Agent 的模型服务。</FieldDescription>
        <FieldError>模型服务不可用。</FieldError>
      </FieldContent>
    </Field>
  )
}

describe('Field', () => {
  it('renders a vertical field by default and forwards root props and ref', () => {
    const ref = createRef<HTMLDivElement>()

    render(
      <Field ref={ref} className="custom-field" data-testid="field">
        <FieldLabel htmlFor="name">名称</FieldLabel>
        <FieldContent>
          <Input id="name" />
        </FieldContent>
      </Field>
    )

    const field = screen.getByTestId('field')
    expect(field).toHaveAttribute('role', 'group')
    expect(field).toHaveAttribute('data-slot', 'field')
    expect(field).toHaveAttribute('data-orientation', 'vertical')
    expect(field.className).toContain('custom-field')
    expect(ref.current).toBe(field)
  })

  it('preserves a native control id and keeps the generated label association in sync', async () => {
    const user = userEvent.setup()

    render(
      <Field>
        <FieldLabel>邮箱</FieldLabel>
        <FieldContent>
          <FieldControl>
            <Input id="email-address" />
          </FieldControl>
        </FieldContent>
      </Field>
    )

    const input = screen.getByRole('textbox', { name: '邮箱' })
    const label = screen.getByText('邮箱')
    expect(input).toHaveAttribute('id', 'email-address')
    expect(label).toHaveAttribute('for', 'email-address')

    await user.click(label)
    expect(input).toHaveFocus()
  })

  it('supports horizontal fields inside a responsive FieldGroup', () => {
    render(
      <FieldGroup data-testid="field-group">
        <Field orientation="horizontal" data-testid="field">
          <FieldLabel>默认模型</FieldLabel>
          <FieldContent>
            <FieldControl>
              <Input />
            </FieldControl>
          </FieldContent>
        </Field>
      </FieldGroup>
    )

    expect(screen.getByTestId('field-group')).toHaveAttribute('data-slot', 'field-group')
    expect(screen.getByTestId('field')).toHaveAttribute('data-orientation', 'horizontal')
    expect(screen.getByTestId('field').className).toContain('grid-cols-[120px_minmax(0,1fr)]')
  })

  it('associates the label, description, and error with the control', async () => {
    const user = userEvent.setup()
    render(<AccessibleField invalid />)

    const input = screen.getByRole('textbox', { name: '模型服务' })
    const label = screen.getByText('模型服务')
    const description = screen.getByText('选择用于当前 Agent 的模型服务。')
    const error = screen.getByRole('alert')

    expect(label).toHaveAttribute('for', 'provider')
    expect(input).toHaveAttribute(
      'aria-describedby',
      `${description.getAttribute('id')} ${error.getAttribute('id')}`
    )
    await user.click(label)
    expect(input).toHaveFocus()
  })

  it('pairs invalid field structure with aria-invalid on the control', () => {
    render(<AccessibleField invalid />)

    expect(screen.getByRole('group')).toHaveAttribute('data-invalid', 'true')
    expect(screen.getByRole('textbox', { name: '模型服务' })).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'field-error')
  })

  it('pairs disabled field structure with the disabled control', () => {
    render(<AccessibleField disabled />)

    const field = screen.getByRole('group')
    expect(field).toHaveAttribute('data-disabled', 'true')
    expect(field).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('textbox', { name: '模型服务' })).toBeDisabled()
  })

  it('renders required and optional markers without changing Label core API', () => {
    render(
      <FieldGroup>
        <Field required>
          <FieldLabel>API Key</FieldLabel>
          <FieldContent>
            <FieldControl>
              <Input />
            </FieldControl>
          </FieldContent>
        </Field>
        <Field optional>
          <FieldLabel>备注</FieldLabel>
          <FieldContent>
            <FieldControl>
              <Input />
            </FieldControl>
          </FieldContent>
        </Field>
      </FieldGroup>
    )

    const requiredInput = screen.getByRole('textbox', { name: 'API Key' })
    const requiredMarker = screen.getByText('*')
    expect(requiredInput).toBeRequired()
    expect(requiredMarker).toHaveAttribute('data-slot', 'field-required')
    expect(requiredMarker).toHaveAttribute('aria-hidden', 'true')

    expect(screen.getByRole('textbox', { name: /备注.*可选/ })).not.toBeRequired()
    expect(screen.getByText('（可选）')).toHaveAttribute('data-slot', 'field-optional')
  })
})
