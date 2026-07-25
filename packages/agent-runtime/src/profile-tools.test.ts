import { describe, expect, it, vi } from 'vitest'
import { createUpdateSoulTool } from './profile-tools'

describe('createUpdateSoulTool', () => {
  it('只向模型暴露完整新内容参数', () => {
    const tool = createUpdateSoulTool(vi.fn())

    expect(tool.name).toBe('update_soul')
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        content: { type: 'string', minLength: 1 },
      },
      required: ['content'],
      additionalProperties: false,
    })
  })

  it('把会话绑定回调的成功结果表达给 Agent', async () => {
    const updateSoul = vi.fn().mockResolvedValue({
      target: 'soul',
      status: 'updated',
      version: 'sha256:new',
    })
    const tool = createUpdateSoulTool(updateSoul)

    await expect(tool.execute('call-1', { content: '新的 Agent 灵魂' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Agent 灵魂已更新。' }],
    })
    expect(updateSoul).toHaveBeenCalledWith('新的 Agent 灵魂')
  })

  it('更新被拒绝时返回明确原因且不抛出', async () => {
    const tool = createUpdateSoulTool(
      vi.fn().mockResolvedValue({
        target: 'soul',
        status: 'rejected',
        version: 'sha256:current',
        reason: {
          code: 'version-conflict',
          message: '资料已被其他会话更新。',
        },
      }),
    )

    await expect(tool.execute('call-1', { content: '新内容' })).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: '更新 Agent 灵魂失败（version-conflict）：资料已被其他会话更新。请在最终回复中明确告知用户。',
        },
      ],
    })
  })

  it('底层异常时返回失败说明且不终止回复', async () => {
    const tool = createUpdateSoulTool(
      vi.fn().mockRejectedValue(new Error('磁盘不可用')),
    )

    await expect(tool.execute('call-1', { content: '新内容' })).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: '更新 Agent 灵魂失败：磁盘不可用。请在最终回复中明确告知用户。',
        },
      ],
    })
  })
})
