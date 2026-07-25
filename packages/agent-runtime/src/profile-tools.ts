import type { ProfileUpdateResult } from '@tangyuan/contracts'

interface UpdateSoulToolResult {
  content: Array<{ type: 'text'; text: string }>
}

/** Pi SDK 使用的轻量 `update_soul` 工具定义。 */
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
  ): Promise<UpdateSoulToolResult>
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
      try {
        const result = await updateSoul(params.content)

        if (result.status === 'rejected') {
          return textResult(
            `更新 Agent 灵魂失败（${result.reason.code}）：${result.reason.message}请在最终回复中明确告知用户。`,
          )
        }

        return textResult(
          result.status === 'updated'
            ? 'Agent 灵魂已更新。'
            : 'Agent 灵魂内容没有变化，无需更新。',
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        return textResult(
          `更新 Agent 灵魂失败：${message}。请在最终回复中明确告知用户。`,
        )
      }
    },
  }
}

function textResult(text: string): UpdateSoulToolResult {
  return { content: [{ type: 'text', text }] }
}
