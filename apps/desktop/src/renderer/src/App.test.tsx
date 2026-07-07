import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the minimum desktop workbench shell', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '汤圆' })).toBeInTheDocument()
    expect(screen.getByText('Missing configuration')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新会话' })).toBeInTheDocument()
  })
})
