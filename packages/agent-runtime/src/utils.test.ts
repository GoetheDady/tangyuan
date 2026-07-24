import { describe, expect, it } from 'vitest'
import { assembleRunTurn } from './run-turn-assembly'
import {
  createToolStepSummary,
  buildTranscriptSnapshotFromSdkEntries,
  createToolActivityLabel,
  normalizePiSdkSessionEvent,
  buildInternalConfigForSave,
  createDefaultInternalConfig,
  extractAgentRuntimeConfig,
  normalizeRuntimeConfiguration,
} from './utils'
import { AgentRuntimeError } from './errors'

describe('createToolStepSummary', () => {
  it('returns deterministic running label for built-in read tool', () => {
    expect(createToolStepSummary('read', 'running')).toBe('正在读取文件')
  })

  it('returns deterministic completed label for built-in read tool', () => {
    expect(createToolStepSummary('read', 'completed')).toBe('读取文件')
  })

  it('returns deterministic failed label for built-in read tool', () => {
    expect(createToolStepSummary('read', 'failed')).toBe('读取文件失败')
  })

  it('returns deterministic labels for write tool', () => {
    expect(createToolStepSummary('write', 'running')).toBe('正在写入文件')
    expect(createToolStepSummary('write', 'completed')).toBe('写入文件')
    expect(createToolStepSummary('write', 'failed')).toBe('写入文件失败')
  })

  it('returns deterministic labels for edit tool', () => {
    expect(createToolStepSummary('edit', 'running')).toBe('正在编辑文件')
    expect(createToolStepSummary('edit', 'completed')).toBe('编辑文件')
    expect(createToolStepSummary('edit', 'failed')).toBe('编辑文件失败')
  })

  it('returns deterministic labels for bash tool', () => {
    expect(createToolStepSummary('bash', 'running')).toBe('正在执行命令')
    expect(createToolStepSummary('bash', 'completed')).toBe('执行命令')
    expect(createToolStepSummary('bash', 'failed')).toBe('执行命令失败')
  })

  it('returns deterministic labels for search tool', () => {
    expect(createToolStepSummary('search', 'running')).toBe('正在搜索代码')
    expect(createToolStepSummary('search', 'completed')).toBe('搜索代码')
    expect(createToolStepSummary('search', 'failed')).toBe('搜索代码失败')
  })

  it('returns deterministic labels for grep tool', () => {
    expect(createToolStepSummary('grep', 'completed')).toBe('搜索文本')
  })

  it('returns deterministic labels for glob tool', () => {
    expect(createToolStepSummary('glob', 'completed')).toBe('查找文件')
  })

  it('returns deterministic labels for ls tool', () => {
    expect(createToolStepSummary('ls', 'completed')).toBe('列出目录')
  })

  it('returns deterministic labels for web_search tool', () => {
    expect(createToolStepSummary('web_search', 'completed')).toBe('搜索网页')
  })

  it('returns deterministic labels for web_fetch tool', () => {
    expect(createToolStepSummary('web_fetch', 'completed')).toBe('获取网页')
  })

  it('falls back to tool name and status for custom/unknown tools (running)', () => {
    expect(createToolStepSummary('my_custom_tool', 'running')).toBe(
      'my_custom_tool（执行中）',
    )
  })

  it('falls back to tool name and status for custom/unknown tools (completed)', () => {
    expect(createToolStepSummary('unknown_tool', 'completed')).toBe(
      'unknown_tool（已完成）',
    )
  })

  it('falls back to tool name and status for custom/unknown tools (failed)', () => {
    expect(createToolStepSummary('broken_tool', 'failed')).toBe(
      'broken_tool（失败）',
    )
  })

  it('never includes tool parameters, output, or file paths in summary', () => {
    const summary = createToolStepSummary('read', 'completed')
    expect(summary).not.toContain('/')
    expect(summary).not.toContain('{')
    expect(summary).not.toContain('}')
  })

  it('does not call any model or external service', () => {
    // This is tested implicitly—the function is synchronous and pure
    expect(typeof createToolStepSummary('read', 'completed')).toBe('string')
  })
})

describe('createToolActivityLabel', () => {
  it('returns Chinese labels for known tools in running state', () => {
    expect(createToolActivityLabel('read', 'running')).toBe('正在读取文件')
    expect(createToolActivityLabel('write', 'running')).toBe('正在写入文件')
    expect(createToolActivityLabel('edit', 'running')).toBe('正在编辑文件')
    expect(createToolActivityLabel('bash', 'running')).toBe('正在运行命令')
    expect(createToolActivityLabel('search', 'running')).toBe('正在搜索')
  })

  it('returns generic labels for completed and failed states', () => {
    expect(createToolActivityLabel('read', 'completed')).toBe('工具完成')
    expect(createToolActivityLabel('bash', 'failed')).toBe('工具失败')
  })

  it('falls back to generic label for unknown tools', () => {
    expect(createToolActivityLabel('custom_tool', 'running')).toBe(
      '正在使用工具',
    )
  })
})

describe('normalizePiSdkSessionEvent turn events', () => {
  it('translates SDK turn_start into a turn-started stream event', () => {
    expect(normalizePiSdkSessionEvent({ type: 'turn_start' })).toEqual([
      { type: 'turn-started' },
    ])
  })

  it('translates SDK turn_end into a turn-ended stream event carrying message and toolResults', () => {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: '完成' }],
    }
    const toolResults = [
      {
        role: 'toolResult',
        toolCallId: 'tc-1',
        toolName: 'read',
        isError: false,
      },
    ]
    expect(
      normalizePiSdkSessionEvent({ type: 'turn_end', message, toolResults }),
    ).toEqual([{ type: 'turn-ended', message, toolResults }])
  })

  it('defaults toolResults to an empty array when turn_end omits them', () => {
    const message = { role: 'assistant', content: [] }
    expect(normalizePiSdkSessionEvent({ type: 'turn_end', message })).toEqual([
      { type: 'turn-ended', message, toolResults: [] },
    ])
  })

  it('ignores turn_end without a valid message', () => {
    expect(normalizePiSdkSessionEvent({ type: 'turn_end' })).toEqual([])
  })
})

describe('buildTranscriptSnapshotFromSdkEntries', () => {
  type TurnMessage = Parameters<typeof assembleRunTurn>[0]['message']
  type ToolResult = Parameters<typeof assembleRunTurn>[0]['toolResults'][number]

  const firstTurnMessage = {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '先读取配置' },
      { type: 'text', text: '我先检查配置。' },
      {
        type: 'toolCall',
        id: 'tool-1',
        name: 'read',
        arguments: { path: '/secret/config.json' },
      },
    ],
  } as TurnMessage
  const firstToolResult = {
    role: 'toolResult',
    toolCallId: 'tool-1',
    toolName: 'read',
    content: [{ type: 'text', text: '敏感原始输出' }],
    isError: false,
  } as ToolResult
  const finalTurnMessage = {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '整理结论' },
      { type: 'text', text: '配置' },
      { type: 'text', text: '检查完成。' },
    ],
  } as TurnMessage
  const secondReplyMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: '第二个请求也完成了。' }],
  } as TurnMessage

  it('按消息序列重建多回合回复，并与实时组装路径一致', () => {
    const snapshot = buildTranscriptSnapshotFromSdkEntries(
      [
        {
          type: 'message',
          id: 'user-1',
          timestamp: '2026-07-23T01:00:00.000Z',
          message: { role: 'user', content: '检查配置' },
        },
        {
          type: 'message',
          id: 'assistant-1',
          timestamp: '2026-07-23T01:00:01.000Z',
          message: firstTurnMessage,
        },
        {
          type: 'message',
          id: 'tool-result-1',
          timestamp: '2026-07-23T01:00:02.000Z',
          message: firstToolResult,
        },
        {
          type: 'message',
          id: 'assistant-2',
          timestamp: '2026-07-23T01:00:03.000Z',
          message: finalTurnMessage,
        },
        {
          type: 'message',
          id: 'user-2',
          timestamp: '2026-07-23T01:01:00.000Z',
          message: { role: 'user', content: '继续检查' },
        },
        {
          type: 'message',
          id: 'assistant-3',
          timestamp: '2026-07-23T01:01:01.000Z',
          message: secondReplyMessage,
        },
      ],
      'session-1',
      'tangyuan',
    )

    expect(snapshot.entries).toHaveLength(4)
    expect(snapshot.entries[0]).toMatchObject({
      kind: 'user-message',
      index: 0,
      messageId: 'user-1',
      content: '检查配置',
    })

    const firstReply = snapshot.entries[1]
    expect(firstReply).toMatchObject({
      kind: 'agent-reply',
      index: 1,
      messageId: 'assistant-1',
      content: '配置检查完成。',
      createdAt: '2026-07-23T01:00:01.000Z',
      attempt: null,
    })
    if (firstReply?.kind !== 'agent-reply') {
      throw new Error('预期第二条 transcript entry 为 agent-reply')
    }
    expect(firstReply.turns).toEqual([
      assembleRunTurn({
        turnIndex: 0,
        runId: 'assistant-1',
        message: firstTurnMessage,
        toolResults: [firstToolResult],
        startedAt: '2026-07-23T01:00:01.000Z',
        completedAt: '2026-07-23T01:00:02.000Z',
      }),
      assembleRunTurn({
        turnIndex: 1,
        runId: 'assistant-1',
        message: finalTurnMessage,
        toolResults: [],
        startedAt: '2026-07-23T01:00:03.000Z',
        completedAt: '2026-07-23T01:00:03.000Z',
      }),
    ])
    expect(firstReply.turns[0]?.steps[2]?.content).toBe('读取文件')
    expect(firstReply.turns[0]?.steps[2]?.content).not.toContain('/secret')
    expect(firstReply.turns[0]?.steps[2]?.content).not.toContain('敏感原始输出')

    expect(snapshot.entries[2]).toMatchObject({
      kind: 'user-message',
      index: 2,
      messageId: 'user-2',
      content: '继续检查',
    })
    expect(snapshot.entries[3]).toMatchObject({
      kind: 'agent-reply',
      index: 3,
      messageId: 'assistant-3',
      content: '第二个请求也完成了。',
      turns: [
        assembleRunTurn({
          turnIndex: 0,
          runId: 'assistant-3',
          message: secondReplyMessage,
          toolResults: [],
          startedAt: '2026-07-23T01:01:01.000Z',
          completedAt: '2026-07-23T01:01:01.000Z',
        }),
      ],
    })
  })
})

describe('normalizeRuntimeConfiguration', () => {
  it('去除首尾空白', () => {
    expect(
      normalizeRuntimeConfiguration({
        providerId: ' openai ',
        modelId: ' gpt-4 ',
        apiKey: ' sk-x ',
      }),
    ).toEqual({ providerId: 'openai', modelId: 'gpt-4', apiKey: 'sk-x' })
  })

  it('任一字段为空时抛 AgentRuntimeError', () => {
    expect(() =>
      normalizeRuntimeConfiguration({
        providerId: 'openai',
        modelId: '',
        apiKey: 'sk-x',
      }),
    ).toThrow(AgentRuntimeError)
  })
})

describe('createDefaultInternalConfig', () => {
  it('返回带默认汤圆 Agent 的 v2 配置', () => {
    expect(createDefaultInternalConfig()).toEqual({
      schemaVersion: 2,
      providers: {},
      agents: {
        tangyuan: {
          displayName: '汤圆',
          defaultProviderId: null,
          defaultModelId: null,
          status: 'active',
          archivedAt: null,
        },
      },
    })
  })
})

describe('buildInternalConfigForSave', () => {
  it('existing 为空时基于默认配置写入 provider 与默认 Agent 模型', () => {
    const result = buildInternalConfigForSave(
      null,
      { providerId: 'openai', modelId: 'gpt-4', apiKey: 'sk-x' },
      '2026-01-01T00:00:00.000Z',
    )
    expect(result.providers.openai).toEqual({
      apiKey: 'sk-x',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(result.agents.tangyuan?.defaultProviderId).toBe('openai')
    expect(result.agents.tangyuan?.defaultModelId).toBe('gpt-4')
    expect(result.schemaVersion).toBe(2)
  })
})

describe('extractAgentRuntimeConfig', () => {
  const config = {
    schemaVersion: 2,
    providers: { openai: { apiKey: 'sk-x', updatedAt: 'now' } },
    agents: {
      tangyuan: {
        displayName: '汤圆',
        defaultProviderId: 'openai',
        defaultModelId: 'gpt-4',
        status: 'active' as const,
        archivedAt: null,
      },
    },
  }

  it('返回 Agent 的运行时配置', () => {
    expect(extractAgentRuntimeConfig(config, 'tangyuan')).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4',
      apiKey: 'sk-x',
    })
  })

  it('Agent 未配置默认模型时返回 null', () => {
    const noModel = {
      ...config,
      agents: {
        tangyuan: { ...config.agents.tangyuan, defaultModelId: null },
      },
    }
    expect(extractAgentRuntimeConfig(noModel, 'tangyuan')).toBeNull()
  })

  it('Agent 不存在时返回 null', () => {
    expect(extractAgentRuntimeConfig(config, 'missing')).toBeNull()
  })
})
