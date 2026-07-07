/**
 * 描述运行时资源是否已满足最小会话启动条件。
 */
export type RuntimeStatus = 'missing-config' | 'ready'

/**
 * Renderer 用于展示 Provider、模型、认证和 Agent 归属的运行时快照。
 */
export interface RuntimeSnapshot {
  agentId: string
  providerId: string | null
  modelId: string | null
  hasApiKey: boolean
  status: RuntimeStatus
}

/**
 * 根据运行时配置生成 Renderer 可直接展示的就绪状态。
 *
 * @param snapshot - 当前运行时资源快照。
 * @returns 如果 Provider、模型和 API Key 都存在则返回 `ready`，否则返回 `missing-config`。
 */
export function getRuntimeStatus(
  snapshot: Omit<RuntimeSnapshot, 'status'>,
): RuntimeStatus {
  return snapshot.providerId && snapshot.modelId && snapshot.hasApiKey
    ? 'ready'
    : 'missing-config'
}

/**
 * 生成带有默认状态字段的运行时资源快照。
 *
 * @param snapshot - 不包含派生状态的运行时资源数据。
 * @returns 带有 `status` 的完整运行时资源快照。
 */
export function createRuntimeSnapshot(
  snapshot: Omit<RuntimeSnapshot, 'status'>,
): RuntimeSnapshot {
  return {
    ...snapshot,
    status: getRuntimeStatus(snapshot),
  }
}
