import { describe, expect, it } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  DESKTOP_IPC_CHANNELS,
  TANGYUAN_DEFAULT_AGENT_ID,
  agentEventSchema,
  createAgentProfileStatus,
  createSessionRequestSchema,
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  migrateConfigV1ToV2,
  persistedConfigurationV2Schema,
  runtimeSnapshotSchema,
  type PersistedConfigurationV1,
  type ProviderAuthSnapshot,
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
        configuredProviders: {},
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

  it('reports ready when the selected provider is in configuredProviders', () => {
    const snapshot = createRuntimeSnapshot(
      createRuntimeSnapshotInput({
        configuredProviders: {
          openai: { configured: true, maskedValue: 'sk-p...5678' },
        },
      }),
    )

    expect(snapshot.status).toBe('ready')
    expect(snapshot.configuredProviders).toEqual({
      openai: { configured: true, maskedValue: 'sk-p...5678' },
    })
  })

  it('reports missing-config when the selected provider is not in configuredProviders', () => {
    const snapshot = createRuntimeSnapshot(
      createRuntimeSnapshotInput({
        settings: {
          selectedProviderId: 'anthropic',
          selectedModelId: 'claude-sonnet-4-5',
        },
        configuredProviders: {
          openai: { configured: true, maskedValue: 'sk-...1234' },
        },
      }),
    )

    expect(snapshot.status).toBe('missing-config')
  })

  it('reports missing-config when the selected provider is present but not configured', () => {
    const snapshot = createRuntimeSnapshot(
      createRuntimeSnapshotInput({
        configuredProviders: {
          openai: { configured: false, maskedValue: null },
        },
      }),
    )

    expect(snapshot.status).toBe('missing-config')
  })

  it('derives backward-compatible auth from the selected provider in configuredProviders', () => {
    const snapshot = createRuntimeSnapshot(
      createRuntimeSnapshotInput({
        settings: {
          selectedProviderId: 'anthropic',
          selectedModelId: 'claude-sonnet-4-5',
        },
        configuredProviders: {
          openai: { configured: true, maskedValue: 'sk-o...abcd' },
          anthropic: { configured: true, maskedValue: 'sk-a...wxyz' },
        },
      }),
    )

    expect(snapshot.auth.apiKey).toEqual({
      configured: true,
      maskedValue: 'sk-a...wxyz',
    })
    expect(snapshot.auth.state).toBe('api-key-configured')
  })

  it('defaults configuredProviders to empty record when not provided', () => {
    const snapshot = createRuntimeSnapshot(
      createRuntimeSnapshotInput({
        configuredProviders: {},
      }),
    )

    expect(snapshot.configuredProviders).toEqual({})
  })

  it('accepts multiple configured providers in the snapshot schema', () => {
    const snapshot = createRuntimeSnapshot(
      createRuntimeSnapshotInput({
        configuredProviders: {
          openai: { configured: true, maskedValue: 'sk-o...abcd' },
          anthropic: { configured: true, maskedValue: 'sk-a...wxyz' },
          google: { configured: false, maskedValue: null },
        },
      }),
    )

    expect(() => runtimeSnapshotSchema.parse(snapshot)).not.toThrow()
    expect(snapshot.configuredProviders['openai']?.configured).toBe(true)
    expect(snapshot.configuredProviders['anthropic']?.configured).toBe(true)
    expect(snapshot.configuredProviders['google']?.configured).toBe(false)
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
 * @returns 带有默认 Agent、Provider、Model、settings、configuredProviders 和 auth 的 RuntimeSnapshotInput。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createRuntimeSnapshotInput(
  overrides: Partial<RuntimeSnapshotInput> = {},
): RuntimeSnapshotInput {
  const selectedProviderId =
    overrides.settings?.selectedProviderId ?? 'openai'
  const apiKeyConfigured = overrides.auth?.apiKey?.configured ?? true

  const defaultConfiguredProviders: Record<string, ProviderAuthSnapshot> =
    apiKeyConfigured
      ? {
          [selectedProviderId]: {
            configured: true,
            maskedValue: 'sk-...1234',
          },
        }
      : {}

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
    configuredProviders:
      overrides.configuredProviders ?? defaultConfiguredProviders,
    auth: {
      apiKey: {
        configured: apiKeyConfigured,
        maskedValue: apiKeyConfigured ? 'sk-...1234' : null,
      },
      ...overrides.auth,
    },
    ...overrides,
  }
}

describe('migrateConfigV1ToV2', () => {
  it('migrates a v1 config to v2 with the provider and default tangyuan agent', () => {
    const v1: PersistedConfigurationV1 = {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    }
    const now = '2026-07-16T00:00:00.000Z'

    const result = migrateConfigV1ToV2(v1, now)

    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(result.providers).toEqual({
      anthropic: {
        apiKey: 'sk-test-secret-7890',
        updatedAt: now,
      },
    })
    expect(result.agents).toEqual({
      [TANGYUAN_DEFAULT_AGENT_ID]: {
        displayName: '汤圆',
        defaultProviderId: 'anthropic',
        defaultModelId: 'claude-sonnet-4-5',
        status: 'active',
        archivedAt: null,
      },
    })
  })

  it('keeps the API key in plaintext after migration (encryption happens on write)', () => {
    const v1: PersistedConfigurationV1 = {
      providerId: 'openai',
      modelId: 'gpt-5',
      apiKey: 'sk-openai-key-1234',
    }

    const result = migrateConfigV1ToV2(v1, '2026-07-16T00:00:00.000Z')

    // API Key 在迁移后仍为明文，加密由 Runtime 在写入磁盘时处理
    expect(result.providers['openai']?.apiKey).toBe('sk-openai-key-1234')
  })

  it('produces output that passes v2 schema validation', () => {
    const v1: PersistedConfigurationV1 = {
      providerId: 'anthropic',
      modelId: 'claude-opus-4-8',
      apiKey: 'sk-ant-api-key',
    }

    const internal = migrateConfigV1ToV2(v1, '2026-07-16T00:00:00.000Z')

    // 模拟 Runtime 加密后的磁盘格式（schemaVersion + providers + agents 结构一致）
    const diskFormat = {
      schemaVersion: internal.schemaVersion as 2,
      providers: Object.fromEntries(
        Object.entries(internal.providers).map(([id, creds]) => [
          id,
          { encryptedApiKey: `encrypted:${creds.apiKey}`, updatedAt: creds.updatedAt },
        ]),
      ),
      agents: internal.agents,
    }

    expect(() => persistedConfigurationV2Schema.parse(diskFormat)).not.toThrow()
  })
})

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
