import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDefaultSessionSummary } from '@tangyuan/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createReadyRuntimeSnapshot,
  installDefaultAppApi,
  resetAppTestEnvironment
} from './app.test-helpers'

describe('App independent session fork', () => {
  afterEach(resetAppTestEnvironment)
  beforeEach(installDefaultAppApi)

  it('opens the child session and prefills the source message without sending it', async () => {
    const user = userEvent.setup()
    const parent = createDefaultSessionSummary({
      sessionId: 'parent-session',
      title: '父会话',
      updatedAt: '2026-07-28T00:00:00.000Z'
    })
    const child = {
      ...createDefaultSessionSummary({
        sessionId: 'child-session',
        title: '父会话（分叉）',
        updatedAt: '2026-07-28T00:01:00.000Z'
      }),
      forkedFrom: {
        sessionId: parent.sessionId,
        entryId: 'source-user'
      }
    }
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true
    })

    window.location.hash = '#/chat/tangyuan/parent-session'
    vi.mocked(window.api.getRuntimeSnapshot).mockResolvedValue(readyRuntime)
    vi.mocked(window.api.refreshRuntime).mockResolvedValue(readyRuntime)
    vi.mocked(window.api.listSessions)
      .mockResolvedValueOnce([parent])
      .mockResolvedValueOnce([parent, child])
    vi.mocked(window.api.getTranscript).mockImplementation(async (request) => ({
      sessionId: request.sessionId,
      agentId: 'tangyuan',
      entries:
        request.sessionId === parent.sessionId
          ? [
              {
                kind: 'user-message',
                index: 0,
                messageId: 'before-user',
                content: '之前的问题',
                createdAt: '2026-07-28T00:00:00.000Z'
              },
              {
                kind: 'agent-reply',
                index: 1,
                messageId: 'before-agent',
                content: '之前的回答',
                createdAt: '2026-07-28T00:00:10.000Z',
                attempt: null,
                turns: []
              },
              {
                kind: 'user-message',
                index: 2,
                messageId: 'source-user',
                content: '换一种方式回答',
                createdAt: '2026-07-28T00:00:20.000Z'
              }
            ]
          : [
              {
                kind: 'user-message',
                index: 0,
                messageId: 'before-user',
                content: '之前的问题',
                createdAt: '2026-07-28T00:00:00.000Z'
              },
              {
                kind: 'agent-reply',
                index: 1,
                messageId: 'before-agent',
                content: '之前的回答',
                createdAt: '2026-07-28T00:00:10.000Z',
                attempt: null,
                turns: []
              }
            ],
      updatedAt: '2026-07-28T00:01:00.000Z'
    }))
    vi.mocked(window.api.forkSession).mockResolvedValue(child)

    render(<App />)

    const sourceMessage = await screen.findByText('换一种方式回答')
    await user.hover(sourceMessage)
    await user.click(
      within(sourceMessage.parentElement!).getByRole('button', {
        name: '从此处分叉'
      })
    )

    await waitFor(() => {
      expect(window.api.forkSession).toHaveBeenCalledWith({
        agentId: 'tangyuan',
        sessionId: 'parent-session',
        entryId: 'source-user'
      })
    })
    expect(await screen.findByDisplayValue('换一种方式回答')).toBeInTheDocument()
    expect(window.api.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '父会话（分叉）' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/chat/tangyuan/child-session')
    expect(screen.getAllByText('父会话（分叉）')).toHaveLength(2)
  })
})
