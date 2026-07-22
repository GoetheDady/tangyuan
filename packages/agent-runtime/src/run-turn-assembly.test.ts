import { describe, it, expect } from 'vitest'
import { assembleRunTurn } from './run-turn-assembly'
import type { AssembleRunTurnInput } from './run-turn-assembly'

type SdkMessage = AssembleRunTurnInput['message']
type SdkToolResults = AssembleRunTurnInput['toolResults']

/**
 * 构造一个最小可用的 SDK AssistantMessage，仅关心 content 块顺序。
 */
function createMessage(
  content: SdkMessage['content'],
): SdkMessage {
  return {
    role: 'assistant',
    content,
    api: 'anthropic',
    provider: 'anthropic',
    model: 'claude',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 0,
  } as SdkMessage
}

/**
 * 构造一个最小可用的 SDK ToolResultMessage。
 */
function createToolResult(
  toolCallId: string,
  toolName: string,
  isError = false,
): SdkToolResults[number] {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text: 'raw output should never leak' }],
    isError,
    timestamp: 0,
  } as SdkToolResults[number]
}

function baseInput(
  overrides: Partial<AssembleRunTurnInput> = {},
): AssembleRunTurnInput {
  return {
    turnIndex: 0,
    runId: 'run-1',
    message: createMessage([]),
    toolResults: [],
    startedAt: '2026-07-16T00:00:00.000Z',
    completedAt: '2026-07-16T00:00:01.000Z',
    ...overrides,
  }
}

describe('assembleRunTurn', () => {
  it('组装单个 AssistantMessage + toolResults 为一个 RunTurn（携带有序 steps）', () => {
    const turn = assembleRunTurn(
      baseInput({
        turnIndex: 2,
        runId: 'run-7',
        message: createMessage([{ type: 'text', text: '你好' }]),
      }),
    )

    expect(turn.index).toBe(2)
    expect(turn.runId).toBe('run-7')
    expect(turn.status).toBe('completed')
    expect(turn.startedAt).toBe('2026-07-16T00:00:00.000Z')
    expect(turn.completedAt).toBe('2026-07-16T00:00:01.000Z')
    expect(turn.steps).toHaveLength(1)
    expect(turn.steps[0]!.index).toBe(0)
  })

  it('步骤按 content 块真实顺序排列，thinking 与 text 交错如实保留', () => {
    const turn = assembleRunTurn(
      baseInput({
        message: createMessage([
          { type: 'thinking', thinking: '先想想' },
          { type: 'text', text: '第一段回复' },
          { type: 'thinking', thinking: '再想想' },
          { type: 'text', text: '第二段回复' },
        ]),
      }),
    )

    expect(turn.steps.map((s) => s.kind)).toEqual([
      'thinking',
      'text',
      'thinking',
      'text',
    ])
    expect(turn.steps.map((s) => s.content)).toEqual([
      '先想想',
      '第一段回复',
      '再想想',
      '第二段回复',
    ])
    expect(turn.steps.map((s) => s.index)).toEqual([0, 1, 2, 3])
    expect(turn.steps.every((s) => s.status === 'completed')).toBe(true)
  })

  it('每个 toolCall 生成一个工具步骤，多工具按启动顺序排列，工具名与安全摘要正确', () => {
    const turn = assembleRunTurn(
      baseInput({
        message: createMessage([
          { type: 'thinking', thinking: '需要读文件再执行命令' },
          {
            type: 'toolCall',
            id: 'tc-1',
            name: 'read',
            arguments: { path: '/etc/passwd' },
          },
          {
            type: 'toolCall',
            id: 'tc-2',
            name: 'bash',
            arguments: { command: 'rm -rf /' },
          },
        ]),
        toolResults: [
          createToolResult('tc-1', 'read'),
          createToolResult('tc-2', 'bash'),
        ],
      }),
    )

    expect(turn.steps.map((s) => s.kind)).toEqual([
      'thinking',
      'tool-call',
      'tool-call',
    ])
    const [, read, bash] = turn.steps
    expect(read!.toolName).toBe('read')
    expect(read!.toolCallId).toBe('tc-1')
    expect(read!.content).toBe('读取文件')
    expect(bash!.toolName).toBe('bash')
    expect(bash!.toolCallId).toBe('tc-2')
    expect(bash!.content).toBe('执行命令')

    // 安全摘要不得泄漏原始参数或原始输出。
    const joined = turn.steps.map((s) => s.content).join('|')
    expect(joined).not.toContain('/etc/passwd')
    expect(joined).not.toContain('rm -rf')
    expect(joined).not.toContain('raw output')
  })

  it('工具结果决定步骤状态：isError 的工具步骤标记为 failed', () => {
    const turn = assembleRunTurn(
      baseInput({
        message: createMessage([
          {
            type: 'toolCall',
            id: 'tc-1',
            name: 'read',
            arguments: {},
          },
          {
            type: 'toolCall',
            id: 'tc-2',
            name: 'bash',
            arguments: {},
          },
        ]),
        toolResults: [
          createToolResult('tc-1', 'read', false),
          createToolResult('tc-2', 'bash', true),
        ],
      }),
    )

    const [read, bash] = turn.steps
    expect(read!.status).toBe('completed')
    expect(read!.content).toBe('读取文件')
    expect(bash!.status).toBe('failed')
    expect(bash!.content).toBe('执行命令失败')
  })

  it('缺少对应 toolResult 的工具步骤标记为 running（结果未回来）', () => {
    const turn = assembleRunTurn(
      baseInput({
        message: createMessage([
          {
            type: 'toolCall',
            id: 'tc-1',
            name: 'read',
            arguments: {},
          },
        ]),
        toolResults: [],
      }),
    )

    expect(turn.steps[0]!.status).toBe('running')
    expect(turn.steps[0]!.completedAt).toBeNull()
    expect(turn.steps[0]!.content).toBe('正在读取文件')
  })

  it('无工具的收尾回合（仅 thinking/text）也能正确组装为一个回合', () => {
    const turn = assembleRunTurn(
      baseInput({
        turnIndex: 3,
        message: createMessage([
          { type: 'thinking', thinking: '收尾思考' },
          { type: 'text', text: '这是最终答复' },
        ]),
        toolResults: [],
      }),
    )

    expect(turn.index).toBe(3)
    expect(turn.steps.map((s) => s.kind)).toEqual(['thinking', 'text'])
    expect(turn.steps.every((s) => s.kind !== 'tool-call')).toBe(true)
    expect(turn.status).toBe('completed')
  })

  it('未传 completedAt 时回合与步骤视为进行中', () => {
    const turn = assembleRunTurn(
      baseInput({
        completedAt: undefined,
        message: createMessage([{ type: 'text', text: '进行中' }]),
      }),
    )

    expect(turn.completedAt).toBeNull()
    expect(turn.status).toBe('running')
    expect(turn.steps[0]!.status).toBe('running')
    expect(turn.steps[0]!.completedAt).toBeNull()
  })
})
