import { describe, expect, it } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  DESKTOP_IPC_CHANNELS,
  YUANXIAO_DEFAULT_AGENT_ID,
  archiveSessionRequestSchema,
  archiveSessionResultSchema,
  agentSessionSummarySchema,
  agentEventSchema,
  applyTranscriptDelta,
  createAgentProfileStatus,
  createSessionRequestSchema,
  listSessionsRequestSchema,
  recoverSessionRequestSchema,
  forkSessionRequestSchema,
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  executionAttemptSchema,
  migrateConfigV1ToV2,
  persistedConfigurationV2Schema,
  runTurnSchema,
  runtimeSnapshotSchema,
  skillOperationParamsSchema,
  skillInstallRecordSchema,
  transcriptDeltaSchema,
  transcriptEntrySchema,
  turnStepSchema,
  type AgentReplyEntry,
  type PersistedConfigurationV1,
  type ProviderAuthSnapshot,
  type RuntimeSnapshotInput,
} from './index'

describe('contracts schemas', () => {
  it('validates the Agent filter used to list sessions', () => {
    expect(listSessionsRequestSchema.parse({ agentId: 'agent-2' })).toEqual({
      agentId: 'agent-2',
    })
    expect(
      listSessionsRequestSchema.parse({
        agentId: 'agent-2',
        includeArchived: true,
      }),
    ).toEqual({
      agentId: 'agent-2',
      includeArchived: true,
    })
    expect(() => listSessionsRequestSchema.parse({ agentId: '' })).toThrow()
  })

  it('preserves the archive timestamp on archived session summaries', () => {
    expect(
      agentSessionSummarySchema.parse({
        agentId: 'agent-2',
        sessionId: 'session-1',
        title: '已归档会话',
        state: 'completed',
        updatedAt: '2026-07-29T02:00:00.000Z',
        archivedAt: '2026-07-29T03:00:00.000Z',
      }),
    ).toMatchObject({ archivedAt: '2026-07-29T03:00:00.000Z' })
  })

  it('validates session lineage archive and recovery payloads', () => {
    expect(
      archiveSessionRequestSchema.parse({
        agentId: 'agent-2',
        sessionId: 'session-1',
        confirmActivityStop: false,
      }),
    ).toMatchObject({ confirmActivityStop: false })
    expect(
      recoverSessionRequestSchema.parse({
        agentId: 'agent-2',
        sessionId: 'session-1',
      }),
    ).toEqual({ agentId: 'agent-2', sessionId: 'session-1' })
    expect(
      archiveSessionResultSchema.parse({
        status: 'confirmation-required',
        affectedSessionIds: ['session-1', 'session-2'],
        affectedActivities: [
          {
            sessionId: 'session-2',
            title: '子会话',
            kinds: ['running', 'queued'],
          },
        ],
      }),
    ).toMatchObject({ status: 'confirmation-required' })
  })

  it('accepts serializable Agent events and rejects malformed event payloads', () => {
    expect(
      agentEventSchema.parse({
        type: 'attempt-started',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        runId: 'run-1',
        occurredAt: '2026-07-16T00:00:00.000Z',
      }),
    ).toEqual({
      type: 'attempt-started',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      runId: 'run-1',
      occurredAt: '2026-07-16T00:00:00.000Z',
    })

    expect(() =>
      agentEventSchema.parse({
        type: 'message-delta',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        runId: 'run-1',
        messageId: 'message-1',
        delta: 42,
        occurredAt: '2026-07-16T00:00:00.000Z',
      }),
    ).toThrow()
  })

  it('accepts run-state-changed events with the queued state', () => {
    expect(
      agentEventSchema.parse({
        type: 'run-state-changed',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        state: 'queued',
        occurredAt: '2026-07-17T00:00:00.000Z',
      }),
    ).toEqual({
      type: 'run-state-changed',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      state: 'queued',
      occurredAt: '2026-07-17T00:00:00.000Z',
    })
  })

  it('requires a non-empty fork source entry at the IPC contract boundary', () => {
    expect(() =>
      forkSessionRequestSchema.parse({
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        entryId: '',
      }),
    ).toThrow()

    expect(
      forkSessionRequestSchema.parse({
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        entryId: 'entry-1',
      }),
    ).toEqual({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      entryId: 'entry-1',
    })
  })

  it('rejects an empty session title at the IPC contract boundary', () => {
    expect(() =>
      createSessionRequestSchema.parse({
        agentId: 'yuanxiao',
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
        agentId: 'yuanxiao',
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
  it('creates a yuanxiao session summary in the initial idle state', () => {
    expect(
      createDefaultSessionSummary({
        sessionId: 'session-1',
        title: '新会话',
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    ).toEqual({
      agentId: 'yuanxiao',
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
      runtimeGetSnapshot: 'yuanxiao:runtime:get-snapshot',
      runtimeRefresh: 'yuanxiao:runtime:refresh',
      runtimeSaveConfiguration: 'yuanxiao:runtime:save-configuration',
      runtimeCancelConfigurationVerification:
        'yuanxiao:runtime:cancel-configuration-verification',
      runtimeRestoreFromBackup: 'yuanxiao:runtime:restore-from-backup',
      runtimeResetConfiguration: 'yuanxiao:runtime:reset-configuration',
      runtimeSaveProvider: 'yuanxiao:runtime:save-provider',
      runtimeDeleteProvider: 'yuanxiao:runtime:delete-provider',
      sessionsList: 'yuanxiao:sessions:list',
      sessionsCreate: 'yuanxiao:sessions:create',
      sessionsSendMessage: 'yuanxiao:sessions:send-message',
      sessionsCancelRun: 'yuanxiao:sessions:cancel-run',
      sessionsGetTranscript: 'yuanxiao:sessions:get-transcript',
      sessionsRetryMessage: 'yuanxiao:sessions:retry-message',
      sessionsFork: 'yuanxiao:sessions:fork',
      sessionsArchive: 'yuanxiao:sessions:archive',
      sessionsRecover: 'yuanxiao:sessions:recover',
      sessionsDelete: 'yuanxiao:sessions:delete',
      sessionsResume: 'yuanxiao:sessions:resume',
      sessionsSetLastActive: 'yuanxiao:sessions:set-last-active',
      sessionsRename: 'yuanxiao:sessions:rename',
      agentsArchive: 'yuanxiao:agents:archive',
      agentsClaimDirectory: 'yuanxiao:agents:claim-directory',
      agentsList: 'yuanxiao:agents:list',
      agentsRebuildYuanxiao: 'yuanxiao:agents:rebuild-yuanxiao',
      agentsReconcile: 'yuanxiao:agents:reconcile',
      agentsRecover: 'yuanxiao:agents:recover',
      agentsUpdateConfig: 'yuanxiao:agents:update-config',
      sessionsGetModelInfo: 'yuanxiao:sessions:get-model-info',
      sessionsSetModel: 'yuanxiao:sessions:set-model',
      sessionsSetThinkingLevel: 'yuanxiao:sessions:set-thinking-level',
      profileGetSoul: 'yuanxiao:profile:get-soul',
      profileGetUser: 'yuanxiao:profile:get-user',
      profileUpdateSoul: 'yuanxiao:profile:update-soul',
      profileUpdateUser: 'yuanxiao:profile:update-user',
      skillsListAgent: 'yuanxiao:skills:list-agent',
      skillsListShared: 'yuanxiao:skills:list-shared',
      skillsInstall: 'yuanxiao:skills:install',
      skillsDelete: 'yuanxiao:skills:delete',
      skillsGetInstallRecords: 'yuanxiao:skills:get-install-records',
      openExternalLink: 'yuanxiao:open-external-link',
      notificationSend: 'yuanxiao:notification:send',
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
  const selectedProviderId = overrides.settings?.selectedProviderId ?? 'openai'
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
      agentId: YUANXIAO_DEFAULT_AGENT_ID,
      displayName: '元宵',
      homePath: '~/.yuanxiao/agents/yuanxiao',
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
  it('migrates a v1 config to v2 with the provider and default yuanxiao agent', () => {
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
      [YUANXIAO_DEFAULT_AGENT_ID]: {
        displayName: '元宵',
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
          {
            encryptedApiKey: `encrypted:${creds.apiKey}`,
            updatedAt: creds.updatedAt,
          },
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

describe('Skill schemas', () => {
  it('accepts valid skill operation params for install', () => {
    expect(
      skillOperationParamsSchema.parse({
        operation: 'install',
        source: 'shared',
        agentId: 'yuanxiao',
        skillName: 'test-skill',
        skillDirPath: '/tmp/test-skill',
      }),
    ).toBeTruthy()
  })

  it('accepts valid skill operation params for delete without dir path', () => {
    expect(
      skillOperationParamsSchema.parse({
        operation: 'delete',
        source: 'agent',
        agentId: 'agent-1',
        targetAgentId: 'agent-1',
        skillName: 'test-skill',
      }),
    ).toBeTruthy()
  })

  it('rejects skill operation params with invalid source', () => {
    expect(() =>
      skillOperationParamsSchema.parse({
        operation: 'install',
        source: 'invalid',
        agentId: 'yuanxiao',
        skillName: 'test',
      }),
    ).toThrow()
  })

  it('accepts a valid skill install record', () => {
    expect(
      skillInstallRecordSchema.parse({
        skillName: 'code-review',
        source: 'shared',
        installedAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
        status: 'active',
      }),
    ).toBeTruthy()
  })

  it('accepts a deleted skill install record', () => {
    expect(
      skillInstallRecordSchema.parse({
        skillName: 'code-review',
        source: 'agent',
        targetAgentId: 'agent-1',
        installedAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
        status: 'deleted',
      }),
    ).toBeTruthy()
  })

  it('rejects skill install record with invalid status', () => {
    expect(() =>
      skillInstallRecordSchema.parse({
        skillName: 'test',
        source: 'shared',
        installedAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
        status: 'removed',
      }),
    ).toThrow()
  })
})

describe('execution attempt schema', () => {
  const attempt = {
    attemptId: 'attempt-1',
    runId: 'run-1',
    status: 'running' as const,
    startedAt: '2026-07-21T00:00:00.000Z',
    completedAt: null,
  }

  it('accepts a non-negative integer retry count', () => {
    expect(
      executionAttemptSchema.parse({ ...attempt, retryCount: 2 }),
    ).toMatchObject({ retryCount: 2 })
  })

  it.each([-1, 1.5])('rejects invalid retry count %s', (retryCount) => {
    expect(() =>
      executionAttemptSchema.parse({ ...attempt, retryCount }),
    ).toThrow()
  })
})

describe('turn step and turn schemas', () => {
  it('parses a valid thinking step', () => {
    expect(
      turnStepSchema.parse({
        index: 0,
        kind: 'thinking',
        content: '正在分析用户需求…',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null,
      }),
    ).toBeTruthy()
  })

  it('parses a valid tool-call step', () => {
    expect(
      turnStepSchema.parse({
        index: 1,
        kind: 'tool-call',
        content: '正在读取文件',
        status: 'completed',
        startedAt: '2026-07-21T00:00:01.000Z',
        completedAt: '2026-07-21T00:00:02.000Z',
      }),
    ).toBeTruthy()
  })

  it('parses a valid turn with steps', () => {
    expect(
      runTurnSchema.parse({
        index: 0,
        runId: 'session-1-run-1',
        steps: [
          {
            index: 0,
            kind: 'thinking',
            content: '分析中…',
            status: 'completed',
            startedAt: '2026-07-21T00:00:00.000Z',
            completedAt: '2026-07-21T00:00:01.000Z',
          },
        ],
        status: 'completed',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: '2026-07-21T00:00:02.000Z',
      }),
    ).toBeTruthy()
  })

  it('rejects step with invalid kind', () => {
    expect(() =>
      turnStepSchema.parse({
        index: 0,
        kind: 'invalid',
        content: '',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null,
      }),
    ).toThrow()
  })
})

describe('transcript delta with turns', () => {
  const baseSnapshot = {
    sessionId: 's1',
    agentId: 'a1',
    entries: [
      {
        kind: 'user-message' as const,
        index: 0,
        messageId: 'm1',
        content: 'hello',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      {
        kind: 'agent-reply' as const,
        index: 1,
        messageId: 'm2',
        content: '',
        createdAt: '2026-07-21T00:00:00.000Z',
        attempt: null,
        turns: [],
      },
    ],
    updatedAt: '2026-07-21T00:00:00.000Z',
  }

  it('step-appended adds turn if none exists yet', () => {
    const step = {
      index: 0,
      kind: 'thinking' as const,
      content: '思考中',
      status: 'running' as const,
      startedAt: '2026-07-21T01:00:00.000Z',
      completedAt: null,
    }
    const result = applyTranscriptDelta(baseSnapshot, {
      type: 'step-appended',
      index: 1,
      turnIndex: 0,
      runId: 'run-1',
      step,
    })
    const entry = result.entries[1]
    expect(entry).toBeDefined()
    const reply =
      (entry as Exclude<typeof entry, undefined>).kind === 'agent-reply'
        ? (entry as AgentReplyEntry)
        : null
    expect(reply).not.toBeNull()
    if (reply) {
      expect(reply.turns).toHaveLength(1)
      expect(reply.turns[0]!.runId).toBe('run-1')
      expect(reply.turns[0]!.steps).toHaveLength(1)
      expect(reply.turns[0]!.steps[0]!.kind).toBe('thinking')
    }
  })

  it('step-updated replaces existing step', () => {
    const step1 = {
      index: 0,
      kind: 'thinking' as const,
      content: '初始',
      status: 'running' as const,
      startedAt: '2026-07-21T01:00:00.000Z',
      completedAt: null,
    }
    const withStep = applyTranscriptDelta(baseSnapshot, {
      type: 'step-appended',
      index: 1,
      turnIndex: 0,
      runId: 'run-1',
      step: step1,
    })

    const updated = {
      index: 0,
      kind: 'thinking' as const,
      content: '更新后',
      status: 'completed' as const,
      startedAt: '2026-07-21T01:00:00.000Z',
      completedAt: '2026-07-21T01:00:01.000Z',
    }
    const result = applyTranscriptDelta(withStep, {
      type: 'step-updated',
      index: 1,
      turnIndex: 0,
      stepIndex: 0,
      step: updated,
    })
    const entry = result.entries[1]
    expect(entry).toBeDefined()
    const reply =
      entry && (entry as { kind: string }).kind === 'agent-reply'
        ? (entry as AgentReplyEntry)
        : null
    expect(reply).not.toBeNull()
    if (reply) {
      expect(reply.turns[0]!.steps[0]!.content).toBe('更新后')
      expect(reply.turns[0]!.steps[0]!.status).toBe('completed')
    }
  })

  it('reply-finalized completes last turn', () => {
    const step = {
      index: 0,
      kind: 'text' as const,
      content: '最终回复',
      status: 'running' as const,
      startedAt: '2026-07-21T01:00:00.000Z',
      completedAt: null,
    }
    const withStep = applyTranscriptDelta(baseSnapshot, {
      type: 'step-appended',
      index: 1,
      turnIndex: 0,
      runId: 'run-1',
      step,
    })

    const result = applyTranscriptDelta(withStep, {
      type: 'reply-finalized',
      index: 1,
    })
    const entry = result.entries[1]
    expect(entry).toBeDefined()
    const reply =
      entry && (entry as { kind: string }).kind === 'agent-reply'
        ? (entry as AgentReplyEntry)
        : null
    expect(reply).not.toBeNull()
    if (reply) {
      expect(reply.turns[0]!.status).toBe('completed')
    }
  })

  it('parses step-appended delta with schema', () => {
    expect(
      transcriptDeltaSchema.parse({
        type: 'step-appended',
        index: 1,
        turnIndex: 0,
        runId: 'run-1',
        step: {
          index: 0,
          kind: 'thinking',
          content: '',
          status: 'running',
          startedAt: '2026-07-21T00:00:00.000Z',
          completedAt: null,
        },
      }),
    ).toBeTruthy()
  })

  it('parses agent-reply entry with turns in schema', () => {
    expect(
      transcriptEntrySchema.parse({
        kind: 'agent-reply',
        index: 0,
        messageId: 'm1',
        content: 'hi',
        createdAt: '2026-07-21T00:00:00.000Z',
        attempt: null,
        turns: [],
      }),
    ).toBeTruthy()
  })
})

describe('agent event with transcript-delta', () => {
  it('parses transcript-delta with entry-appended', () => {
    expect(
      agentEventSchema.parse({
        type: 'transcript-delta',
        agentId: 'a1',
        sessionId: 's1',
        delta: {
          type: 'entry-appended',
          entry: {
            kind: 'user-message',
            index: 0,
            messageId: 'm1',
            content: 'hello',
            createdAt: '2026-07-21T00:00:00.000Z',
          },
        },
        occurredAt: '2026-07-21T00:00:00.000Z',
      }),
    ).toBeTruthy()
  })

  it('parses transcript-delta with step-appended', () => {
    expect(
      agentEventSchema.parse({
        type: 'transcript-delta',
        agentId: 'a1',
        sessionId: 's1',
        delta: {
          type: 'step-appended',
          index: 0,
          turnIndex: 0,
          runId: 'run-1',
          step: {
            index: 0,
            kind: 'thinking',
            content: '思考中…',
            status: 'running',
            startedAt: '2026-07-21T00:00:00.000Z',
            completedAt: null,
          },
        },
        occurredAt: '2026-07-21T00:00:00.000Z',
      }),
    ).toBeTruthy()
  })
})
