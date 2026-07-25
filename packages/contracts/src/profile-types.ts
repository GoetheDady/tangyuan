import type { AgentId } from './identifiers'

/**
 * 描述 Agent 的 soul（身份/角色）内容。
 */
export interface SoulContent {
  agentId: AgentId
  content: string
  updatedAt: string
  /** 内容版本，用于受控更新时检测旧版本覆盖。 */
  version: string
}

/**
 * 描述共享 user profile 内容。
 */
export interface UserProfileContent {
  content: string
  updatedAt: string
  /** 内容版本，用于受控更新时检测旧版本覆盖。 */
  version: string
}

/**
 * 描述 profile 更新被拒绝的原因。
 */
export interface ProfileUpdateRejection {
  code:
    | 'invalid-content'
    | 'version-conflict'
    | 'sensitive-content'
    | 'backup-failed'
    | 'write-failed'
    | 'permission-denied'
  message: string
}

/**
 * 描述受控 profile 更新结果。
 */
export type ProfileUpdateResult =
  | {
      target: 'soul' | 'user'
      status: 'updated' | 'unchanged'
      version: string
    }
  | {
      target: 'soul' | 'user'
      status: 'rejected'
      version: string
      reason: ProfileUpdateRejection
    }

/**
 * 描述更新 Agent soul 的请求。
 */
export interface UpdateSoulRequest {
  agentId: AgentId
  content: string
  /** 设置页面最后读取到的 Agent 灵魂版本。 */
  expectedVersion: string
}

/**
 * 描述更新共享 user profile 的请求。
 */
export interface UpdateUserProfileRequest {
  content: string
  /** 设置页面或会话最后读取到的共享用户画像版本。 */
  expectedVersion: string
}

/**
 * 描述读取 Agent soul 的请求。
 */
export interface GetSoulRequest {
  agentId: AgentId
}
