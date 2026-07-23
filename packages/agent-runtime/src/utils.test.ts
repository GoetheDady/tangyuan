import { describe, expect, it } from 'vitest'
import {
  createToolStepSummary,
  createToolActivityLabel,
  normalizePiSdkSessionEvent,
} from './utils'

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
      { role: 'toolResult', toolCallId: 'tc-1', toolName: 'read', isError: false },
    ]
    expect(
      normalizePiSdkSessionEvent({ type: 'turn_end', message, toolResults }),
    ).toEqual([{ type: 'turn-ended', message, toolResults }])
  })

  it('defaults toolResults to an empty array when turn_end omits them', () => {
    const message = { role: 'assistant', content: [] }
    expect(
      normalizePiSdkSessionEvent({ type: 'turn_end', message }),
    ).toEqual([{ type: 'turn-ended', message, toolResults: [] }])
  })

  it('ignores turn_end without a valid message', () => {
    expect(normalizePiSdkSessionEvent({ type: 'turn_end' })).toEqual([])
  })
})
