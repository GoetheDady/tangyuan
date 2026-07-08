import { describe, expect, it } from 'vitest'
import {
  AgentRuntimeError,
  PiSdkDriver,
  createDefaultSessionSummary,
} from './index'

describe('createDefaultSessionSummary', () => {
  it('creates a tangyuan session summary in the initial idle state', () => {
    expect(
      createDefaultSessionSummary({
        sessionId: 'session-1',
        title: '新会话',
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    ).toEqual({
      agentId: 'tangyuan',
      sessionId: 'session-1',
      title: '新会话',
      updatedAt: '2026-07-08T00:00:00.000Z',
      state: 'idle',
    })
  })
})

describe('AgentRuntimeError', () => {
  it('serializes a stable runtime error without leaking the original cause', () => {
    const error = new AgentRuntimeError({
      code: 'configuration-missing',
      message: 'Provider and model are required before starting a run.',
      recoverable: true,
      cause: new Error('secret API key sk-test-1234'),
    })

    expect(error.toJSON()).toEqual({
      code: 'configuration-missing',
      message: 'Provider and model are required before starting a run.',
      recoverable: true,
    })
  })
})

describe('PiSdkDriver', () => {
  it('exposes the runtime and session contracts before the real SDK loop is wired', async () => {
    const driver = new PiSdkDriver({
      now: () => '2026-07-08T00:00:00.000Z',
    })

    await expect(driver.getSnapshot()).resolves.toMatchObject({
      activeAgent: {
        agentId: 'tangyuan',
      },
      status: 'missing-config',
    })
    await expect(driver.listSessions({ agentId: 'tangyuan' })).resolves.toEqual(
      [],
    )
  })
})
