import { describe, expect, it } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  DESKTOP_IPC_CHANNELS,
  TANGYUAN_DEFAULT_AGENT_ID,
  agentEventSchema,
  agentSkillsStatusSchema,
  applyTranscriptDelta,
  buildTranscriptSnapshot,
  createAgentProfileStatus,
  createSessionRequestSchema,
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  getSoulRequestSchema,
  listAgentSkillsRequestSchema,
  migrateConfigV1ToV2,
  persistedConfigurationV2Schema,
  profileMaintenanceResultSchema,
  runTurnSchema,
  runtimeSnapshotSchema,
  skillSummarySchema,
  skillApprovalRequestSchema,
  skillOperationParamsSchema,
  skillInstallRecordSchema,
  soulContentSchema,
  transcriptDeltaSchema,
  transcriptEntrySchema,
  turnStepSchema,
  updateSoulRequestSchema,
  updateUserProfileRequestSchema,
  userProfileContentSchema,
  type AgentReplyEntry,
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

  it('accepts run-state-changed events with the queued state', () => {
    expect(
      agentEventSchema.parse({
        type: 'run-state-changed',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        state: 'queued',
        occurredAt: '2026-07-17T00:00:00.000Z',
      }),
    ).toEqual({
      type: 'run-state-changed',
      agentId: 'tangyuan',
      sessionId: 'session-1',
      state: 'queued',
      occurredAt: '2026-07-17T00:00:00.000Z',
    })
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
      sessionsAnswerClarification: 'tangyuan:sessions:answer-clarification',
      sessionsApproveBash: 'tangyuan:sessions:approve-bash',
      sessionsCancelClarification: 'tangyuan:sessions:cancel-clarification',
      sessionsRejectBash: 'tangyuan:sessions:reject-bash',
      sessionsGetPendingApprovals: 'tangyuan:sessions:get-pending-approvals',
      sessionsGetPendingClarifications: 'tangyuan:sessions:get-pending-clarifications',
      sessionsGetTranscript: 'tangyuan:sessions:get-transcript',
      sessionsRetryMessage: 'tangyuan:sessions:retry-message',
      agentsArchive: 'tangyuan:agents:archive',
      agentsClaimDirectory: 'tangyuan:agents:claim-directory',
      agentsList: 'tangyuan:agents:list',
      agentsRebuildTangyuan: 'tangyuan:agents:rebuild-tangyuan',
      agentsReconcile: 'tangyuan:agents:reconcile',
      agentsRecover: 'tangyuan:agents:recover',
      agentsUpdateConfig: 'tangyuan:agents:update-config',
      sessionsGetModelInfo: 'tangyuan:sessions:get-model-info',
      sessionsSetModel: 'tangyuan:sessions:set-model',
      sessionsSetThinkingLevel: 'tangyuan:sessions:set-thinking-level',
      profileGetSoul: 'tangyuan:profile:get-soul',
      profileGetUser: 'tangyuan:profile:get-user',
      profileUpdateSoul: 'tangyuan:profile:update-soul',
      profileUpdateUser: 'tangyuan:profile:update-user',
      skillsListAgent: 'tangyuan:skills:list-agent',
      skillsListShared: 'tangyuan:skills:list-shared',
      skillsInstall: 'tangyuan:skills:install',
      skillsDelete: 'tangyuan:skills:delete',
      skillsApproveOperation: 'tangyuan:skills:approve-operation',
      skillsRejectOperation: 'tangyuan:skills:reject-operation',
      skillsGetPendingApprovals: 'tangyuan:skills:get-pending-approvals',
      skillsGetInstallRecords: 'tangyuan:skills:get-install-records',
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

describe('profile schemas', () => {
  it('accepts valid soul content', () => {
    expect(
      soulContentSchema.parse({
        agentId: 'agent-1',
        content: '# Soul\n\nAgent identity rules.',
        updatedAt: '2026-07-17T00:00:00.000Z',
      }),
    ).toEqual({
      agentId: 'agent-1',
      content: '# Soul\n\nAgent identity rules.',
      updatedAt: '2026-07-17T00:00:00.000Z',
    })
  })

  it('accepts valid user profile content', () => {
    expect(
      userProfileContentSchema.parse({
        content: '# User\n\nUser preferences.',
        updatedAt: '2026-07-17T00:00:00.000Z',
      }),
    ).toEqual({
      content: '# User\n\nUser preferences.',
      updatedAt: '2026-07-17T00:00:00.000Z',
    })
  })

  it('accepts successful profile maintenance result', () => {
    expect(
      profileMaintenanceResultSchema.parse({
        target: 'soul',
        success: true,
      }),
    ).toEqual({ target: 'soul', success: true })
  })

  it('accepts failed profile maintenance result with reason', () => {
    expect(
      profileMaintenanceResultSchema.parse({
        target: 'user',
        success: false,
        reason: '缺少更新前备份',
      }),
    ).toEqual({ target: 'user', success: false, reason: '缺少更新前备份' })
  })

  it('rejects empty soul content in update request', () => {
    expect(() =>
      updateSoulRequestSchema.parse({
        agentId: 'agent-1',
        content: '   ',
      }),
    ).toThrow()
  })

  it('accepts valid update soul request', () => {
    expect(
      updateSoulRequestSchema.parse({
        agentId: 'agent-1',
        content: 'New soul content.',
      }),
    ).toEqual({ agentId: 'agent-1', content: 'New soul content.' })
  })

  it('rejects empty user profile content in update request', () => {
    expect(() =>
      updateUserProfileRequestSchema.parse({
        content: '   ',
      }),
    ).toThrow()
  })

  it('accepts valid update user profile request', () => {
    expect(
      updateUserProfileRequestSchema.parse({
        content: 'New user profile.',
      }),
    ).toEqual({ content: 'New user profile.' })
  })

  it('rejects get soul request without agentId', () => {
    expect(() =>
      getSoulRequestSchema.parse({
        agentId: '',
      }),
    ).toThrow()
  })

  it('accepts valid get soul request', () => {
    expect(
      getSoulRequestSchema.parse({
        agentId: 'agent-1',
      }),
    ).toEqual({ agentId: 'agent-1' })
  })

  it('accepts valid skill summary with agent source', () => {
    expect(
      skillSummarySchema.parse({
        name: 'my-skill',
        description: 'A useful skill.',
        source: 'agent',
        path: '/skills/my-skill/SKILL.md',
        hasScripts: false,
      }),
    ).toEqual({
      name: 'my-skill',
      description: 'A useful skill.',
      source: 'agent',
      path: '/skills/my-skill/SKILL.md',
      hasScripts: false,
    })
  })

  it('accepts skill summary with conflict info', () => {
    expect(
      skillSummarySchema.parse({
        name: 'shared-skill',
        description: 'Description.',
        source: 'agent',
        path: '/agents/a1/skills/shared-skill/SKILL.md',
        conflict: {
          overriddenPath: '/skills/shared-skill/SKILL.md',
          overriddenSource: 'shared',
        },
        hasScripts: true,
      }),
    ).toEqual({
      name: 'shared-skill',
      description: 'Description.',
      source: 'agent',
      path: '/agents/a1/skills/shared-skill/SKILL.md',
      conflict: {
        overriddenPath: '/skills/shared-skill/SKILL.md',
        overriddenSource: 'shared',
      },
      hasScripts: true,
    })
  })

  it('rejects skill summary with invalid source', () => {
    expect(() =>
      skillSummarySchema.parse({
        name: 'skill',
        description: 'desc',
        source: 'invalid',
        path: '/path',
        hasScripts: false,
      }),
    ).toThrow()
  })

  it('accepts valid agent skills status', () => {
    expect(
      agentSkillsStatusSchema.parse({
        agentId: 'agent-1',
        skills: [
          {
            name: 'skill-1',
            description: 'A skill.',
            source: 'agent',
            path: '/agents/a1/skills/skill-1/SKILL.md',
            hasScripts: false,
          },
        ],
        sharedSkillsCount: 3,
        agentSkillsCount: 1,
        conflictsCount: 0,
      }),
    ).toEqual({
      agentId: 'agent-1',
      skills: [
        {
          name: 'skill-1',
          description: 'A skill.',
          source: 'agent',
          path: '/agents/a1/skills/skill-1/SKILL.md',
          hasScripts: false,
        },
      ],
      sharedSkillsCount: 3,
      agentSkillsCount: 1,
      conflictsCount: 0,
    })
  })

  it('accepts valid list agent skills request', () => {
    expect(listAgentSkillsRequestSchema.parse({ agentId: 'agent-1' })).toEqual({
      agentId: 'agent-1',
    })
  })

  it('rejects list agent skills request without agentId', () => {
    expect(() => listAgentSkillsRequestSchema.parse({ agentId: '' })).toThrow()
  })
})

describe('Skill schemas', () => {
  it('accepts a valid skill approval request', () => {
    expect(
      skillApprovalRequestSchema.parse({
        approvalId: 'approval-1',
        agentId: 'tangyuan',
        operation: 'install',
        source: 'shared',
        skillName: 'code-review',
        description: 'Review code changes',
        hasScripts: false,
        status: 'pending',
        createdAt: '2026-07-17T00:00:00.000Z',
      }),
    ).toBeTruthy()
  })

  it('accepts a skill approval request with conflict info', () => {
    expect(
      skillApprovalRequestSchema.parse({
        approvalId: 'approval-2',
        agentId: 'agent-1',
        operation: 'install',
        source: 'agent',
        targetAgentId: 'agent-1',
        skillName: 'code-review',
        description: 'Review code changes',
        hasScripts: true,
        conflict: {
          overriddenPath: '/shared/skills/code-review',
          overriddenSource: 'shared',
        },
        status: 'pending',
        createdAt: '2026-07-17T00:00:00.000Z',
      }),
    ).toBeTruthy()
  })

  it('rejects skill approval request with invalid operation', () => {
    expect(() =>
      skillApprovalRequestSchema.parse({
        approvalId: 'approval-1',
        agentId: 'tangyuan',
        operation: 'invalid',
        source: 'shared',
        skillName: 'test',
        description: '',
        hasScripts: false,
        status: 'pending',
        createdAt: '2026-07-17T00:00:00.000Z',
      }),
    ).toThrow()
  })

  it('accepts valid skill operation params for install', () => {
    expect(
      skillOperationParamsSchema.parse({
        operation: 'install',
        source: 'shared',
        agentId: 'tangyuan',
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
        agentId: 'tangyuan',
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

  it('buildTranscriptSnapshot produces turns array', () => {
    const result = buildTranscriptSnapshot(
      [
        {
          messageId: 'm1',
          agentId: 'a1',
          sessionId: 's1',
          role: 'agent',
          content: 'hello world',
          createdAt: '2026-07-21T00:00:00.000Z',
        },
      ],
      's1',
      'a1',
      '2026-07-21T00:00:00.000Z',
    )
    const entry = result.entries[0]
    expect(entry).toBeDefined()
    const reply =
      entry && (entry as { kind: string }).kind === 'agent-reply'
        ? (entry as AgentReplyEntry)
        : null
    expect(reply).not.toBeNull()
    if (reply) {
      expect(reply.turns).toEqual([])
    }
  })

  it('parses step-appended delta with schema', () => {
    expect(
      transcriptDeltaSchema.parse({
        type: 'step-appended',
        index: 1,
        turnIndex: 0,
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

describe('agent event with deltaKind', () => {
  it('parses message-delta with deltaKind thinking', () => {
    expect(
      agentEventSchema.parse({
        type: 'message-delta',
        agentId: 'a1',
        sessionId: 's1',
        runId: 'r1',
        messageId: 'm1',
        delta: '正在思考…',
        deltaKind: 'thinking',
        occurredAt: '2026-07-21T00:00:00.000Z',
      }),
    ).toBeTruthy()
  })

  it('parses message-delta without deltaKind (backward compat)', () => {
    expect(
      agentEventSchema.parse({
        type: 'message-delta',
        agentId: 'a1',
        sessionId: 's1',
        runId: 'r1',
        messageId: 'm1',
        delta: 'hello',
        occurredAt: '2026-07-21T00:00:00.000Z',
      }),
    ).toBeTruthy()
  })

  it('parses activity-updated with optional stepId', () => {
    expect(
      agentEventSchema.parse({
        type: 'activity-updated',
        agentId: 'a1',
        sessionId: 's1',
        runId: 'r1',
        activity: {
          kind: 'tool',
          state: 'running',
          label: '正在读取文件',
          stepId: 'step-1',
        },
        occurredAt: '2026-07-21T00:00:00.000Z',
      }),
    ).toBeTruthy()
  })
})
