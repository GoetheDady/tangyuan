import type { PiSdkStreamEvent } from './index'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type InternalRuntimeConfig,
  type RuntimeConfiguration,
} from '@tangyuan/contracts'
import { AgentRuntimeError } from './errors'
export {
  buildTranscriptSnapshotFromSdkEntries,
  buildTranscriptWithAttempts,
  mapPiSdkSessionEntryToTranscriptEntries,
  stringifyPiSdkMessageContent,
} from './session-transcript'
export { createToolStepSummary } from './tool-step-summary'

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
      toolName: event.toolName as string,
      ...(event.toolCallId !== undefined
        ? { toolCallId: event.toolCallId as string }
        : {}),
    }
  }

  if (event.type === 'tool-completed') {
    return {
      kind: 'tool' as const,
      state: 'completed' as const,
      label: createToolActivityLabel(event.toolName, 'completed'),
      toolName: event.toolName as string,
      ...(event.toolCallId !== undefined
        ? { toolCallId: event.toolCallId as string }
        : {}),
    }
  }

  if (event.type === 'tool-failed') {
    return {
      kind: 'tool' as const,
      state: 'failed' as const,
      label: createToolActivityLabel(event.toolName, 'failed'),
      toolName: event.toolName as string,
      ...(event.toolCallId !== undefined
        ? { toolCallId: event.toolCallId as string }
        : {}),
    }
  }

  // turn-started / turn-ended 不是活动事件：调用方（index.ts 的 onEvent）
  // 已在前置分支拦截它们，不会走到这里。
  throw new Error(`activity 映射不支持事件类型：${event.type}`)
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
    ask_clarification: '等待用户回答',
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
    const toolCallId =
      typeof event.toolCallId === 'string'
        ? event.toolCallId
        : typeof event.id === 'string'
          ? event.id
          : undefined
    return [
      {
        type: 'tool-started' as const,
        toolName: event.toolName,
        ...(toolCallId !== undefined ? { toolCallId } : {}),
        ...(toolInput !== undefined ? { toolInput } : {}),
      },
    ]
  }

  if (event.type === 'turn_start') {
    return [{ type: 'turn-started' as const }]
  }

  if (event.type === 'turn_end' && isRecord(event.message)) {
    type TurnEndedEvent = Extract<PiSdkStreamEvent, { type: 'turn-ended' }>
    return [
      {
        type: 'turn-ended' as const,
        message: event.message as unknown as TurnEndedEvent['message'],
        toolResults: (Array.isArray(event.toolResults)
          ? event.toolResults
          : []) as TurnEndedEvent['toolResults'],
      },
    ]
  }

  if (
    event.type === 'tool_execution_end' &&
    typeof event.toolName === 'string'
  ) {
    const toolCallId =
      typeof event.toolCallId === 'string'
        ? event.toolCallId
        : typeof event.id === 'string'
          ? event.id
          : undefined
    return [
      {
        type: event.isError ? 'tool-failed' : 'tool-completed',
        toolName: event.toolName,
        ...(toolCallId !== undefined ? { toolCallId } : {}),
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

/**
 * 规整用户输入的运行时配置：去除首尾空白，任一字段为空时抛错。
 *
 * @param configuration - 用户输入的 Provider、Model 和 API Key。
 * @returns 去除空白后的运行时配置。
 * @throws 当任一字段去空白后为空时抛出 configuration-missing。
 */
export function normalizeRuntimeConfiguration(
  configuration: RuntimeConfiguration,
): RuntimeConfiguration {
  const normalizedConfiguration = {
    providerId: configuration.providerId.trim(),
    modelId: configuration.modelId.trim(),
    apiKey: configuration.apiKey.trim(),
  }

  if (
    !normalizedConfiguration.providerId ||
    !normalizedConfiguration.modelId ||
    !normalizedConfiguration.apiKey
  ) {
    throw new AgentRuntimeError({
      code: 'configuration-missing',
      message:
        '请填写 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。',
      recoverable: true,
    })
  }

  return normalizedConfiguration
}

/**
 * 构造仅含默认汤圆 Agent 的空 v2 配置。
 *
 * @returns 默认 InternalRuntimeConfig。
 * @throws 此方法不会主动抛出错误。
 */
export function createDefaultInternalConfig(): InternalRuntimeConfig {
  return {
    schemaVersion: 2,
    providers: {},
    agents: {
      [TANGYUAN_DEFAULT_AGENT_ID]: {
        displayName: '汤圆',
        defaultProviderId: null,
        defaultModelId: null,
        status: 'active',
        archivedAt: null,
      },
    },
  }
}

/**
 * 把用户输入的运行时配置合并进内部配置，供保存到磁盘。
 *
 * @param existing - 现有内部配置；为空时基于默认配置。
 * @param runtimeConfig - 用户输入的运行时配置。
 * @param now - 当前时间的 ISO 字符串（作为 provider 更新时间）。
 * @returns 可持久化的 InternalRuntimeConfig。
 * @throws 此方法不会主动抛出错误。
 */
export function buildInternalConfigForSave(
  existing: InternalRuntimeConfig | null,
  runtimeConfig: RuntimeConfiguration,
  now: string,
): InternalRuntimeConfig {
  const config = existing ?? createDefaultInternalConfig()

  config.providers[runtimeConfig.providerId] = {
    apiKey: runtimeConfig.apiKey,
    updatedAt: now,
  }

  const agent = config.agents[TANGYUAN_DEFAULT_AGENT_ID]
  if (agent) {
    agent.defaultProviderId = runtimeConfig.providerId
    agent.defaultModelId = runtimeConfig.modelId
  }

  config.schemaVersion = 2
  return config
}

/**
 * 从内部配置提取指定 Agent 的运行时配置。
 *
 * @param config - 内部配置。
 * @param agentId - Agent 标识。
 * @returns Agent 已配置默认 Provider/Model 时返回运行时配置，否则返回 null。
 * @throws 此方法不会主动抛出错误。
 */
export function extractAgentRuntimeConfig(
  config: InternalRuntimeConfig,
  agentId: string,
): RuntimeConfiguration | null {
  const agent = config.agents[agentId]
  if (!agent?.defaultProviderId || !agent?.defaultModelId) return null
  const provider = config.providers[agent.defaultProviderId]
  if (!provider) return null
  return {
    providerId: agent.defaultProviderId,
    modelId: agent.defaultModelId,
    apiKey: provider.apiKey,
  }
}

/**
 * 判断给定路径是否存在。
 *
 * @param path - 需要检查的文件或目录路径。
 * @returns 路径存在则返回 true，不存在则返回 false。
 * @throws 当底层文件系统返回除“找不到”以外的错误时，Promise 会 reject。
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

/**
 * 判断错误是否为文件/目录不存在（ENOENT）。
 *
 * @param error - 捕获到的未知错误。
 * @returns 是 ENOENT 错误时返回 true。
 * @throws 此方法不会主动抛出错误。
 */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * 安全读取文件内容，文件不存在时返回空字符串。
 *
 * @param path - 需要读取的文件路径。
 * @returns 文件内容；文件不存在时返回空字符串。
 * @throws 当文件读取失败且不是 ENOENT 时，Promise 会 reject。
 */
export async function safeReadFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isNotFoundError(error)) {
      return ''
    }

    throw error
  }
}

/**
 * 读取目录下的文件名集合，目录不存在时返回空集合。
 *
 * @param path - 需要读取的目录路径。
 * @returns 目录中文件名的集合。
 * @throws 当目录读取失败且不是 ENOENT 时，Promise 会 reject。
 */
export async function readDirectoryFileSet(path: string): Promise<Set<string>> {
  try {
    return new Set(await readdir(path))
  } catch (error) {
    if (isNotFoundError(error)) {
      return new Set()
    }

    throw error
  }
}

/**
 * 判断文件是否存在且去除空白后内容非空。
 *
 * @param path - 需要检查的文件路径。
 * @returns 文件存在且含非空白内容时返回 true。
 * @throws 当读取报错（除 ENOENT 外）时，Promise 会 reject。
 */
export async function fileHasContent(path: string): Promise<boolean> {
  return (await safeReadFile(path)).trim() !== ''
}

/**
 * 读取文件最后修改时间。
 *
 * @param path - 需要读取更新时间的文件路径。
 * @returns 以 ISO 字符串表示的修改时间；文件不存在时返回 null。
 * @throws 当底层文件系统读取失败（除 ENOENT 外）时，Promise 会 reject。
 */
export async function getMtimeIso(path: string): Promise<string | null> {
  try {
    const fileStat = await stat(path)
    return fileStat.mtime.toISOString()
  } catch (error) {
    if (isNotFoundError(error)) {
      return null
    }

    throw error
  }
}

/**
 * 生成会话列表里展示的最后消息预览。
 *
 * @param content - 完整消息内容。
 * @returns 压缩空白并截断到 120 字符后的预览文本。
 * @throws 此方法不会主动抛出错误。
 */
export function createMessagePreview(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 120)
}
