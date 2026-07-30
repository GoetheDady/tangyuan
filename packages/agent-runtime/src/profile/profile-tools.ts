import type { ProfileUpdateResult } from '@tangyuan/contracts'

interface ProfileToolResult {
  content: Array<{ type: 'text'; text: string }>
}

export interface UpdateSoulToolDefinition extends Record<string, unknown> {
  name: 'update_soul'
  label: string
  description: string
  promptSnippet: string
  promptGuidelines: string[]
  parameters: {
    type: 'object'
    properties: { content: { type: 'string'; minLength: number } }
    required: ['content']
    additionalProperties: false
  }
  execute(
    toolCallId: string,
    params: { content: string },
  ): Promise<ProfileToolResult>
}

export interface UpdateUserProfileToolDefinition extends Record<
  string,
  unknown
> {
  name: 'update_user_profile'
  label: string
  description: string
  promptSnippet: string
  promptGuidelines: string[]
  parameters: {
    type: 'object'
    properties: { content: { type: 'string'; minLength: number } }
    required: ['content']
    additionalProperties: false
  }
  execute(
    toolCallId: string,
    params: { content: string },
  ): Promise<ProfileToolResult>
}

/**
 * 创建只负责参数适配和结果表达的 Agent 灵魂更新工具。
 */
export function createUpdateSoulTool(
  updateSoul: (content: string) => Promise<ProfileUpdateResult>,
): UpdateSoulToolDefinition {
  return {
    name: 'update_soul',
    label: '更新 Agent 灵魂',
    description:
      '用完整的新内容更新当前 Agent 的长期身份、职责、行为规则、沟通方式或权限边界。只能更新当前 Agent。更新失败时必须在最终回复中明确告知用户失败原因。',
    promptSnippet: 'update_soul(content: string) → 更新当前 Agent 的灵魂',
    promptGuidelines: [
      '仅在长期身份、职责、行为规则、沟通方式或权限边界确实变化时调用',
      'content 必须是完整的新 Agent 灵魂内容',
      '更新失败时必须在最终回复中明确告知用户失败及原因',
    ],
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', minLength: 1 },
      },
      required: ['content'],
      additionalProperties: false,
    },
    async execute(_toolCallId: string, params: { content: string }) {
      return executeProfileUpdate(
        updateSoul,
        params.content,
        '更新 Agent 灵魂',
        'Agent 灵魂',
        'Agent 灵魂内容没有变化，无需更新。',
      )
    },
  }
}

/**
 * 创建只负责参数适配和结果表达的共享用户画像更新工具。
 */
export function createUpdateUserProfileTool(
  updateUserProfile: (content: string) => Promise<ProfileUpdateResult>,
): UpdateUserProfileToolDefinition {
  return {
    name: 'update_user_profile',
    label: '更新用户画像',
    description:
      '用完整的新内容更新所有 Agent 共享的用户画像，包括长期偏好、工作方式或边界。不能写入 API Key、密码、令牌或其他敏感凭据。更新失败时必须在最终回复中明确告知用户失败原因。',
    promptSnippet: 'update_user_profile(content: string) → 更新共享用户画像',
    promptGuidelines: [
      '仅在用户的长期偏好、工作方式或边界确实变化时调用',
      'content 必须是完整的新用户画像内容',
      '不得把 API Key、密码、令牌或其他敏感凭据写入用户画像',
      '更新失败时必须在最终回复中明确告知用户失败及原因',
    ],
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', minLength: 1 },
      },
      required: ['content'],
      additionalProperties: false,
    },
    async execute(_toolCallId: string, params: { content: string }) {
      return executeProfileUpdate(
        updateUserProfile,
        params.content,
        '更新用户画像',
        '用户画像',
        '用户画像内容没有变化，无需更新。',
      )
    },
  }
}

async function executeProfileUpdate(
  update: (content: string) => Promise<ProfileUpdateResult>,
  content: string,
  actionLabel: string,
  successLabel: string,
  unchangedMessage: string,
): Promise<ProfileToolResult> {
  try {
    const result = await update(content)

    if (result.status === 'rejected') {
      return textResult(
        `${actionLabel}失败（${result.reason.code}）：${result.reason.message}请在最终回复中明确告知用户。`,
      )
    }

    return textResult(
      result.status === 'updated'
        ? `${successLabel}已更新。`
        : unchangedMessage,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return textResult(
      `${actionLabel}失败：${message}。请在最终回复中明确告知用户。`,
    )
  }
}

function textResult(text: string): ProfileToolResult {
  return { content: [{ type: 'text', text }] }
}
