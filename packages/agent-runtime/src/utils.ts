import type { PiSdkStreamEvent } from './index'
import { TANGYUAN_DEFAULT_AGENT_ID, type AgentMessage } from '@tangyuan/contracts'

export function mapPiSdkSessionEntryToAgentMessage(
  entry: unknown,
  sessionId: string,
): AgentMessage[] {
  const candidate = entry as {
    type?: unknown
    id?: unknown
    timestamp?: unknown
    message?: {
      role?: unknown
      content?: unknown
    }
  }

  if (candidate.type !== 'message' || !candidate.message) {
    return []
  }

  const role = mapPiSdkMessageRole(candidate.message.role)
  const content = stringifyPiSdkMessageContent(candidate.message.content)

  if (!content) {
    return []
  }

  return [
    {
      messageId:
        typeof candidate.id === 'string'
          ? candidate.id
          : `${sessionId}-sdk-message-${content.length}`,
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId,
      role,
      content,
      createdAt:
        typeof candidate.timestamp === 'string'
          ? candidate.timestamp
          : new Date(0).toISOString(),
    },
  ]
}

/**
 * 将 Pi SDK 消息角色映射成汤圆标准角色。
 *
 * @param role - SDK 消息里的未知角色值。
 * @returns 汤圆 transcript 使用的消息角色。
 * @throws 此方法不会主动抛出错误。
 */
export function mapPiSdkMessageRole(role: unknown): AgentMessage['role'] {
  if (role === 'user') {
    return 'user'
  }

  if (role === 'assistant') {
    return 'agent'
  }

  return 'system'
}

/**
 * 将 Pi SDK 消息内容压成 Renderer 可展示的纯文本。
 *
 * @param content - SDK 消息里的未知 content 值。
 * @returns 可展示的纯文本内容。
 * @throws 此方法不会主动抛出错误。
 */
export function stringifyPiSdkMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * 判断错误是否来自 AbortController 取消。
 *
 * @param error - 捕获到的未知错误。
 * @returns 如果是取消错误则返回 true。
 * @throws 此方法不会主动抛出错误。
 */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

/**
 * 把错误消息转换成不含 API Key 的用户可读文案。
 *
 * @param error - 捕获到的未知错误。
 * @param apiKey - 需要从消息中移除的原始 API Key；非配置错误可省略。
 * @returns 脱敏后的错误消息。
 * @throws 此方法不会主动抛出错误。
 */
export function sanitizeErrorMessage(error: unknown, apiKey?: string): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '请检查 Provider、Model 和 API Key 后重试。'
  const redactedMessage = apiKey
    ? rawMessage.split(apiKey).join('[API Key 已隐藏]')
    : rawMessage

  return redactedMessage || '请检查 Provider、Model 和 API Key 后重试。'
}

/**
 * 把 Pi SDK 流式事件转换成 Renderer 可展示的简略活动。
 *
 * @param event - Pi SDK 网关产出的最小流式事件。
 * @returns 不包含原始参数和 JSON 的活动摘要。
 * @throws 此方法不会主动抛出错误。
 */
export function mapPiSdkStreamEventToActivity(event: PiSdkStreamEvent) {
  if (event.type === 'thinking-started') {
    return {
      kind: 'thinking' as const,
      state: 'running' as const,
      label: '思考中',
    }
  }

  if (event.type === 'thinking-delta') {
    return {
      kind: 'thinking' as const,
      state: 'running' as const,
      label: '思考中',
    }
  }

  if (event.type === 'text-delta') {
    return {
      kind: 'thinking' as const,
      state: 'running' as const,
      label: '思考中',
    }
  }

  if (event.type === 'tool-started') {
    return {
      kind: 'tool' as const,
      state: 'running' as const,
      label: createToolActivityLabel(event.toolName, 'running'),
    }
  }

  if (event.type === 'tool-completed') {
    return {
      kind: 'tool' as const,
      state: 'completed' as const,
      label: createToolActivityLabel(event.toolName, 'completed'),
    }
  }

  return {
    kind: 'tool' as const,
    state: 'failed' as const,
    label: createToolActivityLabel(event.toolName, 'failed'),
  }
}

/**
 * 根据工具名生成不含参数的中文活动文案。
 *
 * @param toolName - Pi SDK 报告的工具名。
 * @param state - 工具执行状态。
 * @returns 可展示给用户的简略工具状态。
 * @throws 此方法不会主动抛出错误。
 */
export function createToolActivityLabel(
  toolName: string,
  state: 'running' | 'completed' | 'failed',
): string {
  if (state === 'failed') {
    return '工具失败'
  }

  if (state === 'completed') {
    return '工具完成'
  }

  const labels: Record<string, string> = {
    read: '正在读取文件',
    write: '正在写入文件',
    edit: '正在编辑文件',
    bash: '正在运行命令',
    search: '正在搜索',
  }

  return labels[toolName] ?? '正在使用工具'
}

/**
 * 把真实 Pi SDK session 事件宽松解析成 v1 所需的最小流式事件。
 *
 * @param event - SDK subscribe 回调收到的未知事件对象。
 * @returns 一个或多个可映射到汤圆事件的最小流式事件。
 * @throws 此方法不会主动抛出错误。
 */
export function normalizePiSdkSessionEvent(event: unknown): PiSdkStreamEvent[] {
  if (!isRecord(event)) {
    return []
  }

  if (
    event.type === 'message_update' &&
    isRecord(event.assistantMessageEvent)
  ) {
    const assistantEvent = event.assistantMessageEvent

    if (
      assistantEvent.type === 'text_delta' &&
      typeof assistantEvent.delta === 'string'
    ) {
      return [{ type: 'text-delta', delta: assistantEvent.delta }]
    }

    if (assistantEvent.type === 'thinking_start') {
      return [{ type: 'thinking-started' }]
    }

    if (
      assistantEvent.type === 'thinking_delta' &&
      typeof assistantEvent.delta === 'string'
    ) {
      return [{ type: 'thinking-delta', delta: assistantEvent.delta }]
    }
  }

  if (
    event.type === 'tool_execution_start' &&
    typeof event.toolName === 'string'
  ) {
    const toolInput = isRecord(event.toolInput)
      ? event.toolInput
      : isRecord(event.input)
        ? event.input
        : undefined
    return [
      {
        type: 'tool-started' as const,
        toolName: event.toolName,
        ...(toolInput !== undefined ? { toolInput } : {}),
      },
    ]
  }

  if (
    event.type === 'tool_execution_end' &&
    typeof event.toolName === 'string'
  ) {
    return [
      {
        type: event.isError ? 'tool-failed' : 'tool-completed',
        toolName: event.toolName,
      },
    ]
  }

  return []
}

/**
 * 判断未知值是否是可读取字段的普通对象。
 *
 * @param value - 需要判断的未知值。
 * @returns 如果值是非 null 对象则返回 true。
 * @throws 此方法不会主动抛出错误。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 分析 bash 命令的风险等级并生成中文风险说明。
 *
 * @param command - 待执行的 bash 命令。
 * @returns 面向用户的中文风险说明。
 * @throws 此方法不会主动抛出错误。
 */
export function describeBashRisk(command: string): string {
  const highRiskPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\brm\s+-rf\b/, label: '递归强制删除' },
    { pattern: /\bsudo\b/, label: '提权操作' },
    { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/, label: '远程脚本直接执行' },
    { pattern: /\bwget\b.*\|\s*(ba)?sh\b/, label: '远程脚本直接执行' },
    { pattern: /\bdd\s+if=/, label: '磁盘直接写入' },
    { pattern: /\bmkfs\b/, label: '格式化文件系统' },
    { pattern: />\s*\/dev\//, label: '设备文件写入' },
    { pattern: /\bchmod\s+777/, label: '危险权限修改' },
    { pattern: /\bpasswd\b/, label: '密码修改' },
  ]

  const mediumRiskPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\brm\b/, label: '删除文件' },
    { pattern: /\bmv\b/, label: '移动/重命名文件' },
    { pattern: /\bchmod\b/, label: '修改权限' },
    { pattern: /\bchown\b/, label: '修改所有者' },
    { pattern: /\bkill\b/, label: '终止进程' },
    { pattern: /\bpkill\b/, label: '终止进程' },
    { pattern: /\bnpm\s+(install|uninstall)\b.*-g/, label: '全局包管理' },
    { pattern: /\bpip\s+install\b/, label: 'Python 包安装' },
    { pattern: /\bgit\s+push\b.*--force/, label: '强制推送' },
  ]

  const highHits = highRiskPatterns
    .filter((p) => p.pattern.test(command))
    .map((p) => p.label)

  const mediumHits = mediumRiskPatterns
    .filter((p) => p.pattern.test(command))
    .map((p) => p.label)

  if (highHits.length > 0) {
    return `高风险命令：${highHits.join('、')}。命令将以当前 macOS 用户权限执行，可能造成不可逆的系统影响。`
  }

  if (mediumHits.length > 0) {
    return `中风险命令：${mediumHits.join('、')}。命令将以当前 macOS 用户权限执行，请确认操作意图。`
  }

  return `命令将以当前 macOS 用户权限执行。`
}
