import { describe, expect, it } from 'vitest'
import {
  DESKTOP_IPC_CHANNELS,
  TANGYUAN_DEFAULT_AGENT_ID,
  agentEventSchema,
  createAgentProfileStatus,
  createSessionRequestSchema,
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  runtimeSnapshotSchema,
  type RuntimeSnapshotInput,
} from './index'

describe('contracts schemas', () => {
  it('accepts serializable Agent events and rejects malformed event payloads', () => {
    expect(
      agentEventSchema.parse({
        type: 'turn-started',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        runId: 'run-1',
        occurredAt: '2026-07-16T00:00:00.000Z',
      }),
    ).toEqual({
      type: 'turn-started',
      agentId: 'tangyuan',
      sessionId: 'session-1',
      runId: 'run-1',
      occurredAt: '2026-07-16T00:00:00.000Z',
    })

    expect(() =>
      agentEventSchema.parse({
        type: 'message-delta',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        runId: 'run-1',
        messageId: 'message-1',
        delta: 42,
        occurredAt: '2026-07-16T00:00:00.000Z',
      }),
    ).toThrow()
  })

  it('rejects an empty session title at the IPC contract boundary', () => {
    expect(() =>
      createSessionRequestSchema.parse({
        agentId: 'tangyuan',
        title: '   ',
      }),
    ).toThrow()
  })

  it('rejects malformed runtime responses before they cross IPC', () => {
    const snapshot = createRuntimeSnapshot(createRuntimeSnapshotInput())

    expect(runtimeSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(() =>
      runtimeSnapshotSchema.parse({
        ...snapshot,
        status: 'unexpected-status',
      }),
    ).toThrow()
  })
})

describe('createRuntimeSnapshot', () => {
  it('reports missing configuration until provider, model, and API key are configured', () => {
    expect(
      createRuntimeSnapshot(
        createRuntimeSnapshotInput({
          settings: {
            selectedProviderId: 'openai',
            selectedModelId: null,
          },
          auth: {
            apiKey: {
              configured: true,
              maskedValue: 'sk-...1234',
            },
          },
        }),
      ).status,
    ).toBe('missing-config')
  })

  it('derives auth state from the API key configuration', () => {
    expect(
      createRuntimeSnapshot(
        createRuntimeSnapshotInput({
          auth: {
            apiKey: {
              configured: false,
              maskedValue: null,
            },
          },
        }),
      ).auth.state,
    ).toBe('missing-api-key')
  })

  it('preserves an explicitly provided auth state', () => {
    expect(
      createRuntimeSnapshot(
        createRuntimeSnapshotInput({
          auth: {
            state: 'api-key-configured',
            apiKey: {
              configured: true,
              maskedValue: 'sk-...1234',
            },
          },
        }),
      ).auth.state,
    ).toBe('api-key-configured')
  })

  it('reports ready when the minimum runtime configuration exists', () => {
    expect(createRuntimeSnapshot(createRuntimeSnapshotInput()).status).toBe(
      'ready',
    )
  })

  it('keeps provider, model, API key, active agent, and profile status in one read model', () => {
    const snapshot = createRuntimeSnapshot(
      createRuntimeSnapshotInput({
        auth: {
          apiKey: {
            configured: false,
            maskedValue: null,
          },
        },
      }),
    )

    expect(snapshot).toMatchObject({
      activeAgent: {
        agentId: 'tangyuan',
        profile: {
          initialized: false,
          bootstrapRequired: false,
          soulUpdatedAt: null,
          userUpdatedAt: null,
        },
      },
      settings: {
        selectedProviderId: 'openai',
        selectedModelId: 'gpt-5',
      },
      auth: {
        state: 'missing-api-key',
        apiKey: {
          configured: false,
          maskedValue: null,
        },
      },
      status: 'missing-config',
    })
  })
})

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

describe('DESKTOP_IPC_CHANNELS', () => {
  it('names the IPC requests that the preload layer may invoke', () => {
    expect(DESKTOP_IPC_CHANNELS).toEqual({
      runtimeGetSnapshot: 'tangyuan:runtime:get-snapshot',
      runtimeRefresh: 'tangyuan:runtime:refresh',
      runtimeSaveConfiguration: 'tangyuan:runtime:save-configuration',
      runtimeCancelConfigurationVerification:
        'tangyuan:runtime:cancel-configuration-verification',
      runtimeRestoreFromBackup: 'tangyuan:runtime:restore-from-backup',
      runtimeResetConfiguration: 'tangyuan:runtime:reset-configuration',
      sessionsList: 'tangyuan:sessions:list',
      sessionsCreate: 'tangyuan:sessions:create',
      sessionsGetMessages: 'tangyuan:sessions:get-messages',
      sessionsSendMessage: 'tangyuan:sessions:send-message',
      sessionsCancelRun: 'tangyuan:sessions:cancel-run',
      openExternalLink: 'tangyuan:open-external-link',
    })
  })
})

/**
 * 创建共享类型测试使用的 RuntimeSnapshot 输入。
 *
 * @param overrides - 需要覆盖的运行时输入字段。
 * @returns 带有默认 Agent、Provider、Model、settings 和 auth 的 RuntimeSnapshotInput。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createRuntimeSnapshotInput(
  overrides: Partial<RuntimeSnapshotInput> = {},
): RuntimeSnapshotInput {
  return {
    activeAgent: {
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      displayName: '汤圆',
      homePath: '~/.tangyuan/agents/tangyuan',
      profile: {
        initialized: false,
        bootstrapRequired: false,
        soulUpdatedAt: null,
        userUpdatedAt: null,
        ...overrides.activeAgent?.profile,
      },
      ...overrides.activeAgent,
    },
    providers: [{ providerId: 'openai', displayName: 'OpenAI' }],
    models: [
      {
        providerId: 'openai',
        modelId: 'gpt-5',
        displayName: 'GPT-5',
      },
    ],
    settings: {
      selectedProviderId: 'openai',
      selectedModelId: 'gpt-5',
      ...overrides.settings,
    },
    auth: {
      apiKey: {
        configured: true,
        maskedValue: 'sk-...1234',
      },
      ...overrides.auth,
    },
    ...overrides,
  }
}

describe('createAgentProfileStatus', () => {
  it('maps bootstrap state into a renderable profile status', () => {
    expect(
      createAgentProfileStatus({
        initialized: true,
        bootstrapRequired: false,
        bootstrapFileExists: false,
        soulFileExists: true,
        userFileExists: true,
        soulUpdatedAt: '2026-07-08T00:00:00.000Z',
        userUpdatedAt: '2026-07-08T00:00:00.000Z',
      }),
    ).toEqual({
      initialized: true,
      bootstrapRequired: false,
      soulUpdatedAt: '2026-07-08T00:00:00.000Z',
      userUpdatedAt: '2026-07-08T00:00:00.000Z',
    })
  })
})
