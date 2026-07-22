import { z } from 'zod'
export const nonEmptyIdentifierSchema = z.string().trim().min(1)
const timestampSchema = z.string().trim().min(1)

/**
 * 校验跨进程传输的 Agent 消息。
 */
export const agentMessageSchema = z.strictObject({
  messageId: nonEmptyIdentifierSchema,
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  role: z.enum(['user', 'agent', 'system', 'compaction']),
  content: z.string(),
  createdAt: timestampSchema,
})

/**
 * 校验执行尝试的身份与状态。
 */
export const executionAttemptSchema = z.strictObject({
  attemptId: nonEmptyIdentifierSchema,
  runId: nonEmptyIdentifierSchema,
  status: z.enum(['running', 'completed', 'cancelled', 'failed']),
  startedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  error: z
    .strictObject({
      code: z.enum([
        'configuration-missing',
        'driver-unavailable',
        'provider-verification-failed',
        'session-not-found',
        'run-already-active',
        'run-cancelled',
        'unknown',
      ]),
      message: z.string(),
      recoverable: z.boolean(),
    })
    .optional(),
})

/**
 * 校验执行历史中的单个步骤。
 */
export const turnStepSchema = z.strictObject({
  index: z.number().int().min(0),
  kind: z.enum(['thinking', 'text', 'tool-call']),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed']),
  startedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
})

/**
 * 校验执行历史中的单个 turn。
 */
export const runTurnSchema = z.strictObject({
  index: z.number().int().min(0),
  runId: nonEmptyIdentifierSchema,
  steps: z.array(turnStepSchema),
  status: z.enum(['running', 'completed', 'cancelled', 'failed']),
  startedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
})

/**
 * 校验用户消息条目。
 */
export const userMessageEntrySchema = z.strictObject({
  kind: z.literal('user-message'),
  index: z.number().int().min(0),
  messageId: nonEmptyIdentifierSchema,
  content: z.string(),
  createdAt: timestampSchema,
})

/**
 * 校验 Agent 回复条目。
 */
export const agentReplyEntrySchema = z.strictObject({
  kind: z.literal('agent-reply'),
  index: z.number().int().min(0),
  messageId: nonEmptyIdentifierSchema,
  content: z.string(),
  createdAt: timestampSchema,
  attempt: executionAttemptSchema.nullable(),
  turns: z.array(runTurnSchema),
  inReplyTo: z.string().optional(),
})

/**
 * 校验压缩提示条目。
 */
export const compactionEntrySchema = z.strictObject({
  kind: z.literal('compaction'),
  index: z.number().int().min(0),
  timestamp: timestampSchema,
})

/**
 * 校验 transcript 条目。
 */
export const transcriptEntrySchema = z.discriminatedUnion('kind', [
  userMessageEntrySchema,
  agentReplyEntrySchema,
  compactionEntrySchema,
])

/**
 * 校验结构化会话快照。
 */
export const transcriptSnapshotSchema = z.strictObject({
  sessionId: nonEmptyIdentifierSchema,
  agentId: nonEmptyIdentifierSchema,
  entries: z.array(transcriptEntrySchema),
  updatedAt: timestampSchema,
})

/**
 * 校验 transcript 增量更新。
 */
export const transcriptDeltaSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('entry-appended'),
    entry: transcriptEntrySchema,
  }),
  z.strictObject({
    type: z.literal('entry-updated'),
    index: z.number().int().min(0),
    entry: transcriptEntrySchema,
  }),
  z.strictObject({
    type: z.literal('delta-appended'),
    index: z.number().int().min(0),
    delta: z.string(),
  }),
  z.strictObject({
    type: z.literal('attempt-status-changed'),
    index: z.number().int().min(0),
    attempt: executionAttemptSchema,
  }),
  z.strictObject({
    type: z.literal('step-appended'),
    index: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    step: turnStepSchema,
  }),
  z.strictObject({
    type: z.literal('step-updated'),
    index: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    stepIndex: z.number().int().min(0),
    step: turnStepSchema,
  }),
  z.strictObject({
    type: z.literal('reply-finalized'),
    index: z.number().int().min(0),
  }),
])

/**
 * 校验跨进程传输的会话摘要。
 */
export const agentSessionSummarySchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  title: z.string(),
  state: z.enum([
    'idle',
    'queued',
    'running',
    'completed',
    'cancelled',
    'failed',
  ]),
  updatedAt: timestampSchema,
})

/**
 * 校验 Agent profile 文件状态。
 */
export const agentProfileStatusSchema = z.strictObject({
  initialized: z.boolean(),
  bootstrapRequired: z.boolean(),
  soulUpdatedAt: timestampSchema.nullable(),
  userUpdatedAt: timestampSchema.nullable(),
})

/**
 * 校验当前桌面应用正在操作的 Agent profile。
 */
export const agentProfileSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  displayName: z.string(),
  homePath: z.string(),
  profile: agentProfileStatusSchema,
})

/**
 * 校验可选 Provider 描述。
 */
export const providerDescriptorSchema = z.strictObject({
  providerId: nonEmptyIdentifierSchema,
  displayName: z.string(),
})

/**
 * 校验可选模型描述。
 */
export const modelDescriptorSchema = z.strictObject({
  providerId: nonEmptyIdentifierSchema,
  modelId: nonEmptyIdentifierSchema,
  displayName: z.string(),
})

/**
 * 校验 API Key 的脱敏配置状态。
 */
export const apiKeyStateSchema = z.strictObject({
  configured: z.boolean(),
  maskedValue: z.string().nullable(),
})

/**
 * 校验单个 Provider 的认证状态（可安全传给 Renderer）。
 */
export const providerAuthSnapshotSchema = z.strictObject({
  configured: z.boolean(),
  maskedValue: z.string().nullable(),
})

/**
 * 校验运行时 Provider 与 Model 设置。
 */
export const runtimeSettingsSchema = z.strictObject({
  selectedProviderId: z.string().nullable(),
  selectedModelId: z.string().nullable(),
})

/**
 * 校验运行时认证状态。
 */
export const runtimeAuthSnapshotSchema = z.strictObject({
  state: z.enum(['missing-api-key', 'api-key-configured']),
  apiKey: apiKeyStateSchema,
})

/**
 * 校验 Renderer 可以接收的完整运行时快照。
 */
export const runtimeSnapshotSchema = z.strictObject({
  activeAgent: agentProfileSchema,
  agents: z.array(
    z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
  ),
  providers: z.array(providerDescriptorSchema),
  models: z.array(modelDescriptorSchema),
  settings: runtimeSettingsSchema,
  auth: runtimeAuthSnapshotSchema,
  configuredProviders: z.record(z.string(), providerAuthSnapshotSchema),
  status: z.enum(['missing-config', 'ready']),
  configRecovery: z.strictObject({
    state: z.enum(['ok', 'corrupted', 'migration-failed']),
    hasBackup: z.boolean(),
  }),
})

/**
 * 校验持久化在磁盘上的 v2 Provider 凭据。
 */
export const providerCredentialsSchema = z.strictObject({
  encryptedApiKey: z.string(),
  updatedAt: timestampSchema,
})

/**
 * 校验持久化在磁盘上的 Agent 配置。
 */
export const agentConfigSchema = z.strictObject({
  displayName: z.string(),
  defaultProviderId: z.string().nullable(),
  defaultModelId: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  archivedAt: z.string().nullable(),
})

/**
 * 校验 Agent soul 内容。
 */
export const soulContentSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  content: z.string(),
  updatedAt: timestampSchema,
})

/**
 * 校验共享 user profile 内容。
 */
export const userProfileContentSchema = z.strictObject({
  content: z.string(),
  updatedAt: timestampSchema,
})

/**
 * 校验 profile 维护操作结果。
 */
export const profileMaintenanceResultSchema = z.strictObject({
  target: z.enum(['soul', 'user']),
  success: z.boolean(),
  reason: z.string().optional(),
})

/**
 * 校验更新 soul 请求。
 */
export const updateSoulRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  content: z.string().refine((content) => content.trim().length > 0),
})

/**
 * 校验更新共享 user profile 请求。
 */
export const updateUserProfileRequestSchema = z.strictObject({
  content: z.string().refine((content) => content.trim().length > 0),
})

/**
 * 校验读取 soul 请求。
 */
export const getSoulRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
})

/**
 * 校验 v2 版本磁盘配置结构。
 */
export const persistedConfigurationV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  providers: z.record(z.string(), providerCredentialsSchema),
  agents: z.record(z.string(), agentConfigSchema),
})

/**
 * 校验配置恢复信息。
 */
export const configRecoveryInfoSchema = z.strictObject({
  state: z.enum(['ok', 'corrupted', 'migration-failed']),
  hasBackup: z.boolean(),
})

/**
 * 校验可以安全暴露给 Renderer 的 Runtime 错误。
 */
export const agentRuntimeErrorPayloadSchema = z.strictObject({
  code: z.enum([
    'configuration-missing',
    'driver-unavailable',
    'provider-verification-failed',
    'session-not-found',
    'run-already-active',
    'run-cancelled',
    'unknown',
  ]),
  message: z.string(),
  recoverable: z.boolean(),
})

/**
 * 校验不含敏感参数的 Agent 活动摘要。
 */
export const agentActivitySchema = z.strictObject({
  kind: z.enum(['thinking', 'tool']),
  state: z.enum(['running', 'completed', 'failed']),
  label: z.string(),
  stepId: z.string().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
})

/**
 * 校验问题澄清请求。
 */
export const questionClarificationRequestSchema = z.strictObject({
  clarificationId: nonEmptyIdentifierSchema,
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  runId: nonEmptyIdentifierSchema,
  question: z.string().min(1),
  options: z
    .array(z.string().min(1))
    .min(2)
    .max(5),
  allowCustomAnswer: z.boolean(),
  status: z.enum(['pending', 'answered', 'cancelled']),
  createdAt: timestampSchema,
})

/**
 * 校验 Bash 审批请求。
 */
export const bashApprovalRequestSchema = z.strictObject({
  approvalId: nonEmptyIdentifierSchema,
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  runId: nonEmptyIdentifierSchema,
  command: z.string().min(1),
  cwd: z.string().min(1),
  riskDescription: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: timestampSchema,
})

/**
 * 校验 Main 向 Renderer 推送的标准 Agent 事件。
 */
export const agentEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('session-created'),
    agentId: nonEmptyIdentifierSchema,
    session: agentSessionSummarySchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('message-appended'),
    agentId: nonEmptyIdentifierSchema,
    message: agentMessageSchema,
    inReplyTo: z.string().optional(),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('turn-started'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('message-delta'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    messageId: nonEmptyIdentifierSchema,
    delta: z.string(),
    deltaKind: z.enum(['text', 'thinking']).optional(),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('message-completed'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    message: agentMessageSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('turn-cancelled'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('turn-failed'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    error: agentRuntimeErrorPayloadSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('activity-updated'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    runId: nonEmptyIdentifierSchema,
    activity: agentActivitySchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('run-state-changed'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    state: z.enum([
      'idle',
      'queued',
      'running',
      'completed',
      'cancelled',
      'failed',
    ]),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('profile-updated'),
    agentId: nonEmptyIdentifierSchema,
    target: z.enum(['soul', 'user']),
    updatedAt: timestampSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('runtime-error'),
    agentId: nonEmptyIdentifierSchema,
    error: agentRuntimeErrorPayloadSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('agent-created'),
    agentId: nonEmptyIdentifierSchema,
    agent: z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('agent-config-updated'),
    agentId: nonEmptyIdentifierSchema,
    agent: z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('agent-archived'),
    agentId: nonEmptyIdentifierSchema,
    agent: z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('agent-recovered'),
    agentId: nonEmptyIdentifierSchema,
    agent: z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('approval-required'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    approval: bashApprovalRequestSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('approval-resolved'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    approvalId: nonEmptyIdentifierSchema,
    status: z.enum(['approved', 'rejected']),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('clarification-required'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    clarification: questionClarificationRequestSchema,
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('clarification-resolved'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    clarificationId: nonEmptyIdentifierSchema,
    answer: z.string(),
    status: z.enum(['answered', 'cancelled']),
    occurredAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal('transcript-delta'),
    agentId: nonEmptyIdentifierSchema,
    sessionId: nonEmptyIdentifierSchema,
    delta: transcriptDeltaSchema,
    occurredAt: timestampSchema,
  }),
])

/**
 * 校验创建会话请求。
 */
export const createSessionRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  title: z.string().trim().min(1),
})

/**
 * 校验读取会话消息请求。
 */
export const getSessionMessagesRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
})

/**
 * 校验发送消息请求，并保留用户输入的原始空白。
 */
export const sendMessageRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  content: z.string().refine((content) => content.trim().length > 0),
})

/**
 * 校验取消运行请求。
 */
export const cancelRunRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
})

/**
 * 校验重试运行请求。
 */
export const retryRunRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  userMessageId: nonEmptyIdentifierSchema,
})

/**
 * 校验保存 Runtime 配置请求。
 */
export const runtimeConfigurationSchema = z.strictObject({
  providerId: nonEmptyIdentifierSchema,
  modelId: nonEmptyIdentifierSchema,
  apiKey: z.string().refine((apiKey) => apiKey.trim().length > 0),
})

/**
 * 校验取消配置验证请求。
 */
export const cancelConfigurationVerificationRequestSchema = z.strictObject({
  verificationId: nonEmptyIdentifierSchema,
})

/**
 * 校验更新 Agent 默认配置请求。
 */
export const updateAgentConfigRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  defaultProviderId: z.string().nullable().optional(),
  defaultModelId: z.string().nullable().optional(),
})

/**
 * 校验归档 Agent 请求。
 */
export const archiveAgentRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
})

/**
 * 校验恢复 Agent 请求。
 */
export const recoverAgentRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
})

/**
 * 校验认领 Agent 目录请求。
 */
export const claimAgentDirectoryRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  displayName: z.string().trim().min(1),
})

/**
 * 校验设置 Session 模型请求。
 */
export const setSessionModelRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  providerId: nonEmptyIdentifierSchema,
  modelId: nonEmptyIdentifierSchema,
})

/**
 * 校验设置 Session Thinking Level 请求。
 */
export const setSessionThinkingLevelRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
  level: z.string().trim().min(1),
})

/**
 * 校验读取 Session 模型信息请求。
 */
export const getSessionModelInfoRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  sessionId: nonEmptyIdentifierSchema,
})

/**
 * 校验单个 Skill 摘要。
 */
export const skillSummarySchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  source: z.enum(['shared', 'agent']),
  path: z.string(),
  conflict: z
    .strictObject({
      overriddenPath: z.string(),
      overriddenSource: z.enum(['shared', 'agent']),
    })
    .optional(),
  hasScripts: z.boolean(),
})

/**
 * 校验 Agent Skills 状态。
 */
export const agentSkillsStatusSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
  skills: z.array(skillSummarySchema),
  sharedSkillsCount: z.number().int().min(0),
  agentSkillsCount: z.number().int().min(0),
  conflictsCount: z.number().int().min(0),
})

/**
 * 校验读取指定 Agent Skills 的请求。
 */
export const listAgentSkillsRequestSchema = z.strictObject({
  agentId: nonEmptyIdentifierSchema,
})

/**
 * 校验 Skill 审批请求。
 */
export const skillApprovalRequestSchema = z.strictObject({
  approvalId: nonEmptyIdentifierSchema,
  agentId: nonEmptyIdentifierSchema,
  operation: z.enum(['install', 'delete']),
  source: z.enum(['shared', 'agent']),
  targetAgentId: nonEmptyIdentifierSchema.optional(),
  skillName: z.string().min(1),
  description: z.string(),
  hasScripts: z.boolean(),
  conflict: z
    .strictObject({
      overriddenPath: z.string(),
      overriddenSource: z.enum(['shared', 'agent']),
    })
    .optional(),
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: timestampSchema,
})

/**
 * 校验 Skill 操作参数。
 */
export const skillOperationParamsSchema = z.strictObject({
  operation: z.enum(['install', 'delete']),
  source: z.enum(['shared', 'agent']),
  agentId: nonEmptyIdentifierSchema,
  targetAgentId: nonEmptyIdentifierSchema.optional(),
  skillName: z.string().min(1),
  skillDirPath: z.string().optional(),
})

/**
 * 校验 Skill 安装记录。
 */
export const skillInstallRecordSchema = z.strictObject({
  skillName: z.string().min(1),
  source: z.enum(['shared', 'agent']),
  targetAgentId: nonEmptyIdentifierSchema.optional(),
  installedAt: timestampSchema,
  updatedAt: timestampSchema,
  status: z.enum(['active', 'deleted']),
})

/**
 * 校验 Session 模型信息。
 */
export const sessionModelInfoSchema = z.strictObject({
  providerId: z.string(),
  modelId: z.string(),
  displayName: z.string(),
  thinkingLevel: z.string().nullable(),
  supportedThinkingLevels: z.array(z.string()),
  supportsThinking: z.boolean(),
})

/**
 * 描述 Renderer 请求 Main 安全打开外部链接的请求载荷。
  url: string
}

/**
 * Renderer 请求 Main 安全打开外部链接的 Zod schema。
 */
export const openExternalLinkRequestSchema = z.strictObject({
  url: z.string().min(1),
})

/**
 * 校验批准 Bash 执行的请求。
 */
export const approveBashRequestSchema = z.strictObject({
  approvalId: nonEmptyIdentifierSchema,
})

/**
 * 校验拒绝 Bash 执行的请求。
 */
export const rejectBashRequestSchema = z.strictObject({
  approvalId: nonEmptyIdentifierSchema,
})

/**
 * 校验提交澄清答案的请求。
 */
export const answerClarificationRequestSchema = z.strictObject({
  clarificationId: nonEmptyIdentifierSchema,
  answer: z.string().min(1),
})

/**
 * 校验取消澄清的请求。
 */
export const cancelClarificationRequestSchema = z.strictObject({
  clarificationId: nonEmptyIdentifierSchema,
})

/**
 * 桌面端允许 Renderer 通过 Preload API 调用的 IPC channel。
 */
