import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  YUANXIAO_DEFAULT_AGENT_ID,
  type AgentRunState,
} from '@yuanxiao/contracts'
import type { ConfigStore, DirectoryLayout } from '../core'
import { extractAgentRuntimeConfig, isForkSource } from '../core'
import type { PiSdkGateway } from '../driver'
import type {
  PersistedSessionIndex,
  PersistedSessionIndexEntry,
} from './session-index-types'

/**
 * 创建 SessionIndexRebuilder 所需的依赖。
 */
export interface SessionIndexRebuilderDependencies {
  layout: DirectoryLayout
  configStore: ConfigStore
  gateway: PiSdkGateway
}

/**
 * 本地会话索引缺失或损坏时，从 Pi SDK 原生 session 目录重建索引条目。
 *
 * 重建知识集中于此：按 session header 工作目录恢复 Agent 归属、投影会话
 * 运行配置与分叉来源、保留旧索引扩展数据。SessionIndexStore 只负责把重建
 * 结果装回内存并落盘，不再直接依赖 driver 层 Gateway。
 */
export class SessionIndexRebuilder {
  private readonly layout: DirectoryLayout
  private readonly configStore: ConfigStore
  private readonly gateway: PiSdkGateway

  constructor(dependencies: SessionIndexRebuilderDependencies) {
    this.layout = dependencies.layout
    this.configStore = dependencies.configStore
    this.gateway = dependencies.gateway
  }

  /**
   * 扫描全局 Pi SDK session 目录重建索引条目。
   *
   * 按 session header 的工作目录恢复 Agent 归属；已归档 Agent 的会话同样保留
   *（listSummaries 按 agentId 过滤，不会混入当前活跃 Agent 的日常列表）。
   * 无法归属到任何已知 Agent 的 Pi 会话不进入索引。
   *
   * @returns 从 SDK 恢复出的索引条目；无配置时返回空数组。
   * @throws 当运行时配置读取或全局会话扫描失败时，Promise 会 reject。
   */
  async rebuild(): Promise<PersistedSessionIndexEntry[]> {
    const readResult = await this.configStore.read()

    if (!readResult.config) {
      return []
    }

    // 读取旧索引以保留扩展数据
    const oldEntries = await this.readOldIndex()
    const config = readResult.config
    // 工作目录 → Agent 归属；含已归档 Agent，否则其会话谱系会在重建后丢失。
    const agentIdByCwd = new Map<string, string>()

    for (const agentId of Object.keys(config.agents)) {
      const cwd =
        agentId === YUANXIAO_DEFAULT_AGENT_ID
          ? this.layout.agentHome()
          : this.layout.workspace(agentId)
      agentIdByCwd.set(resolve(cwd), agentId)
    }

    const sdkSessions = await this.gateway.listSessions({
      sessionDir: this.layout.sdkSessionDir(),
    })

    const allEntries: PersistedSessionIndexEntry[] = []

    for (const session of sdkSessions) {
      const oldEntry = oldEntries.get(session.sessionId)
      const agentId = session.cwd
        ? agentIdByCwd.get(resolve(session.cwd))
        : oldEntry?.agentId

      // 无法归属到已知 Agent 的会话（如其他工具写入的 Pi 会话）不入索引。
      if (!agentId) continue

      const runtimeConfig = extractAgentRuntimeConfig(config, agentId)
      // 会话运行配置属于会话：Pi session 自己记录的取值最可信，
      // 其次是旧索引，最后才回退到 Agent 默认配置。
      const provider =
        session.provider ||
        oldEntry?.provider ||
        (runtimeConfig?.providerId ?? '')
      const model =
        session.model || oldEntry?.model || (runtimeConfig?.modelId ?? '')
      const thinkingLevel = session.thinkingLevel ?? oldEntry?.thinkingLevel
      // 索引已有来源优先；旧单 id 来源缺 sdkEntryId 时用 Pi session 投影补齐，
      // 使重建后两种命名空间都能定位来源消息。
      const oldForkedFrom = oldEntry?.forkedFrom
      const sdkForkedFrom = session.forkedFrom
      const forkedFrom =
        oldForkedFrom !== undefined &&
        oldForkedFrom?.sdkEntryId === undefined &&
        sdkForkedFrom?.sdkEntryId !== undefined
          ? { ...oldForkedFrom, sdkEntryId: sdkForkedFrom.sdkEntryId }
          : (oldForkedFrom ?? sdkForkedFrom)

      allEntries.push({
        sessionId: session.sessionId,
        sdkSessionFile: session.sdkSessionFile,
        title: session.title?.trim() || session.sessionId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        provider,
        model,
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        agentId,
        // 保留旧扩展数据，不存在则使用默认值
        lastMessagePreview: oldEntry?.lastMessagePreview ?? '',
        status: oldEntry?.status ?? 'idle',
        ...(oldEntry?.archivedAt !== undefined
          ? { archivedAt: oldEntry.archivedAt }
          : {}),
        ...(forkedFrom !== undefined ? { forkedFrom } : {}),
      })
    }

    return allEntries
  }

  /**
   * 尝试读取旧版本地会话索引，用于重建时保留扩展数据。
   *
   * @returns 以 sessionId 为键的旧索引条目映射。
   * @throws 此方法不会主动抛出错误。
   */
  private async readOldIndex(): Promise<
    Map<string, PersistedSessionIndexEntry>
  > {
    try {
      const indexPath = this.layout.sessionIndex()
      const rawIndex = await readFile(indexPath, 'utf8')
      const parsedIndex = JSON.parse(rawIndex) as Partial<PersistedSessionIndex>
      const entries = Array.isArray(parsedIndex.sessions)
        ? parsedIndex.sessions.flatMap((entry) =>
            normalizePersistedIndexEntry(entry),
          )
        : []

      return new Map(entries.map((entry) => [entry.sessionId, entry]))
    } catch {
      return new Map()
    }
  }
}

/**
 * 判断未知值是否是可展示的 Agent 运行状态。
 *
 * @param value - 待判断的未知值。
 * @returns 是 AgentRunState 时返回 true。
 * @throws 此方法不会主动抛出错误。
 */
export function isAgentRunState(value: unknown): value is AgentRunState {
  return (
    value === 'idle' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'cancelled' ||
    value === 'failed'
  )
}

/**
 * 把未知 JSON 值规范化为合法的会话索引条目。
 *
 * @param value - 待校验的未知值。
 * @returns 合法时返回单元素数组，否则返回空数组。
 * @throws 此方法不会主动抛出错误。
 */
export function normalizePersistedIndexEntry(
  value: unknown,
): PersistedSessionIndexEntry[] {
  const entry = value as Partial<PersistedSessionIndexEntry>

  if (
    typeof entry.sessionId !== 'string' ||
    typeof entry.sdkSessionFile !== 'string' ||
    typeof entry.title !== 'string' ||
    typeof entry.createdAt !== 'string' ||
    typeof entry.updatedAt !== 'string' ||
    typeof entry.provider !== 'string' ||
    typeof entry.model !== 'string' ||
    typeof entry.agentId !== 'string' ||
    typeof entry.lastMessagePreview !== 'string' ||
    !isAgentRunState(entry.status)
  ) {
    return []
  }

  const attempts = Array.isArray(entry.attempts) ? entry.attempts : undefined
  const forkedFrom = isForkSource(entry.forkedFrom)
    ? entry.forkedFrom
    : undefined
  const thinkingLevel =
    typeof entry.thinkingLevel === 'string' ? entry.thinkingLevel : undefined
  const archivedAt =
    typeof entry.archivedAt === 'string' ? entry.archivedAt : undefined

  return [
    {
      sessionId: entry.sessionId,
      sdkSessionFile: entry.sdkSessionFile,
      title: entry.title,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      provider: entry.provider,
      model: entry.model,
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      agentId: entry.agentId,
      lastMessagePreview: entry.lastMessagePreview,
      status: entry.status,
      ...(archivedAt !== undefined ? { archivedAt } : {}),
      ...(attempts !== undefined ? { attempts } : {}),
      ...(forkedFrom !== undefined ? { forkedFrom } : {}),
    },
  ]
}
