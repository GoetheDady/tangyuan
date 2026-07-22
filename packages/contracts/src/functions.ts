import type {
  AgentHomeBootstrapStatus,
  AgentProfileStatus,
  AgentReplyEntry,
  AgentSessionSummary,
  ApiKeyState,
  InternalRuntimeConfig,
  PersistedConfigurationV1,
  RuntimeAuthSnapshot,
  RuntimeAuthState,
  RuntimeSnapshot,
  RuntimeSnapshotInput,
  RuntimeStatus,
  TranscriptDelta,
  TranscriptEntry,
  TranscriptSnapshot,
} from './types'
import { CURRENT_SCHEMA_VERSION, TANGYUAN_DEFAULT_AGENT_ID } from './types'

/**
 * 根据运行时配置生成 Renderer 可直接展示的就绪状态。
 *
 * 只有同时满足以下条件才返回 `ready`：
 * 1. 已选择默认 Provider 和 Model
 * 2. 所选 Provider 的凭据已配置
 *
 * @param snapshot - 当前运行时资源快照，不包含派生状态。
 * @returns 满足会话启动条件时返回 `ready`，否则返回 `missing-config`。
 * @throws 此方法不会主动抛出错误。
 */
export function getRuntimeStatus(
  snapshot: RuntimeSnapshotInput,
): RuntimeStatus {
  const { selectedProviderId, selectedModelId } = snapshot.settings
  if (!selectedProviderId || !selectedModelId) return 'missing-config'
  const configuredProviders = snapshot.configuredProviders ?? {}
  return configuredProviders[selectedProviderId]?.configured
    ? 'ready'
    : 'missing-config'
}

/**
 * 根据 API Key 配置状态生成认证状态。
 *
 * @param apiKey - API Key 的配置和脱敏展示状态。
 * @returns 已配置时返回 `api-key-configured`，否则返回 `missing-api-key`。
 * @throws 此方法不会主动抛出错误。
 */
export function getRuntimeAuthState(apiKey: ApiKeyState): RuntimeAuthState {
  return apiKey.configured ? 'api-key-configured' : 'missing-api-key'
}

/**
 * 生成带有默认状态字段的运行时资源快照。
 *
 * `auth` 字段从 `configuredProviders` 和当前选中的 Provider 派生：
 * - 如果选中 Provider 在 `configuredProviders` 中，`auth.apiKey` 取其值
 * - 否则 `auth.apiKey` 为未配置状态
 *
 * @param snapshot - 不包含派生状态的运行时资源数据。
 * @returns 带有 `status` 的完整运行时资源快照。
 * @throws 此方法不会主动抛出错误。
 */
export function createRuntimeSnapshot(
  snapshot: RuntimeSnapshotInput,
): RuntimeSnapshot {
  const configuredProviders = snapshot.configuredProviders ?? {}

  // 从选中 Provider 派生向后兼容的 auth 字段
  const selectedProviderId = snapshot.settings.selectedProviderId
  const selectedProviderAuth = selectedProviderId
    ? configuredProviders[selectedProviderId]
    : undefined
  const derivedApiKey: ApiKeyState = selectedProviderAuth ?? {
    configured: false,
    maskedValue: null,
  }
  const derivedAuth: RuntimeAuthSnapshot = {
    state: snapshot.auth.state ?? getRuntimeAuthState(derivedApiKey),
    apiKey: derivedApiKey,
  }

  return {
    ...snapshot,
    agents: snapshot.agents ?? [
      {
        agentId: snapshot.activeAgent.agentId,
        displayName: snapshot.activeAgent.displayName,
        status: 'active' as const,
        defaultProviderId: snapshot.settings.selectedProviderId,
        defaultModelId: snapshot.settings.selectedModelId,
        homePath: snapshot.activeAgent.homePath,
        archivedAt: null,
        directoryStatus: 'healthy' as const,
      },
    ],
    configuredProviders,
    auth: derivedAuth,
    status: getRuntimeStatus({ ...snapshot, configuredProviders }),
    configRecovery: snapshot.configRecovery ?? {
      state: 'ok',
      hasBackup: false,
    },
  }
}

/**
 * 生成适合 Renderer 展示的 Agent profile 状态。
 *
 * @param status - 默认 Agent Home 的 bootstrap 和 profile 文件状态。
 * @returns 适合写入 RuntimeSnapshot 的 profile 状态。
 * @throws 此方法不会主动抛出错误。
 */
export function createAgentProfileStatus(
  status: AgentHomeBootstrapStatus,
): AgentProfileStatus {
  return {
    initialized: status.initialized,
    bootstrapRequired: status.bootstrapRequired,
    soulUpdatedAt: status.soulUpdatedAt,
    userUpdatedAt: status.userUpdatedAt,
  }
}

/**
 * 创建 v1 默认 Agent 的本地会话摘要。
 *
 * @param input - 会话标识、标题和更新时间。
 * @returns 默认归属 `tangyuan` Agent 且处于空闲状态的会话摘要。
 * @throws 此方法不会主动抛出错误。
 */
export function createDefaultSessionSummary(input: {
  sessionId: string
  title: string
  updatedAt: string
}): AgentSessionSummary {
  return {
    agentId: TANGYUAN_DEFAULT_AGENT_ID,
    sessionId: input.sessionId,
    title: input.title,
    updatedAt: input.updatedAt,
    state: 'idle',
  }
}

/**
 * 将 v1 格式的配置迁移为 v2 内部运行时配置。
 *
 * v1 的单个 providerId/modelId/apiKey 被迁移为：
 * - providers[providerId] = { apiKey, updatedAt: now }
 * - agents.tangyuan = { defaultProviderId: providerId, defaultModelId: modelId, ... }
 *
 * 迁移后 API Key 仍为明文（未加密），需由 Runtime 在下次写入时加密。
 *
 * @param v1 - v1 磁盘配置格式。
 * @param now - 当前时间戳，用于填充 updatedAt 字段。
 * @returns v2 内部运行时配置。
 * @throws 此方法不会主动抛出错误。
 */
export function migrateConfigV1ToV2(
  v1: PersistedConfigurationV1,
  now: string,
): InternalRuntimeConfig {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    providers: {
      [v1.providerId]: {
        apiKey: v1.apiKey,
        updatedAt: now,
      },
    },
    agents: {
      [TANGYUAN_DEFAULT_AGENT_ID]: {
        displayName: '汤圆',
        defaultProviderId: v1.providerId,
        defaultModelId: v1.modelId,
        status: 'active',
        archivedAt: null,
      },
    },
  }
}

/**
 * 将 TranscriptDelta 应用到 TranscriptSnapshot 上。
 *
 * 纯函数，不修改原始 snapshot。
 *
 * @param snapshot - 当前快照。
 * @param delta - 需要应用的增量更新。
 * @returns 应用增量后的新快照。
 * @throws 当 delta.index 越界时可能返回未修改的快照。
 */
export function applyTranscriptDelta(
  snapshot: TranscriptSnapshot,
  delta: TranscriptDelta,
): TranscriptSnapshot {
  const entries = [...snapshot.entries]

  switch (delta.type) {
    case 'entry-appended': {
      return {
        ...snapshot,
        entries: [...entries, delta.entry],
      }
    }

    case 'entry-updated': {
      if (delta.index >= 0 && delta.index < entries.length) {
        entries[delta.index] = delta.entry
      }
      return { ...snapshot, entries }
    }

    case 'delta-appended': {
      if (delta.index >= 0 && delta.index < entries.length) {
        const entry = entries[delta.index]
        if (entry) {
          entries[delta.index] = {
            ...entry,
            content: `${entry.kind === 'agent-reply' || entry.kind === 'user-message' ? (entry as { content: string }).content + delta.delta : delta.delta}`,
          } as TranscriptEntry
        }
      }
      return { ...snapshot, entries }
    }

    case 'attempt-status-changed': {
      if (delta.index >= 0 && delta.index < entries.length) {
        const entry = entries[delta.index]
        if (entry && entry.kind === 'agent-reply') {
          entries[delta.index] = {
            ...entry,
            attempt: delta.attempt,
          } as AgentReplyEntry
        }
      }
      return { ...snapshot, entries }
    }

    case 'step-appended': {
      if (delta.index >= 0 && delta.index < entries.length) {
        const entry = entries[delta.index]
        if (entry && entry.kind === 'agent-reply') {
          const turns = [...entry.turns]
          const existingTurn = turns[delta.turnIndex]
          if (existingTurn) {
            turns[delta.turnIndex] = {
              ...existingTurn,
              steps: [...existingTurn.steps, delta.step],
            }
          } else if (delta.turnIndex === turns.length) {
            // Auto-create turn if index points to the next slot
            turns.push({
              index: delta.turnIndex,
              runId: delta.runId,
              steps: [delta.step],
              status: 'running',
              startedAt: delta.step.startedAt,
              completedAt: null,
            })
          }
          entries[delta.index] = { ...entry, turns } as AgentReplyEntry
        }
      }
      return { ...snapshot, entries }
    }

    case 'step-updated': {
      if (delta.index >= 0 && delta.index < entries.length) {
        const entry = entries[delta.index]
        if (entry && entry.kind === 'agent-reply') {
          const turns = [...entry.turns]
          const turn = turns[delta.turnIndex]
          if (turn) {
            const steps = [...turn.steps]
            if (delta.stepIndex >= 0 && delta.stepIndex < steps.length) {
              steps[delta.stepIndex] = delta.step
            }
            turns[delta.turnIndex] = { ...turn, steps }
          }
          entries[delta.index] = { ...entry, turns } as AgentReplyEntry
        }
      }
      return { ...snapshot, entries }
    }

    case 'reply-finalized': {
      if (delta.index >= 0 && delta.index < entries.length) {
        const entry = entries[delta.index]
        if (entry && entry.kind === 'agent-reply') {
          const lastTurn = entry.turns[entry.turns.length - 1]
          const turns = lastTurn
            ? [
                ...entry.turns.slice(0, -1),
                {
                  ...lastTurn,
                  status: 'completed' as const,
                  completedAt: lastTurn.completedAt ?? new Date().toISOString(),
                },
              ]
            : entry.turns
          entries[delta.index] = {
            ...entry,
            turns,
          } as AgentReplyEntry
        }
      }
      return { ...snapshot, entries }
    }

    default:
      return snapshot
  }
}
