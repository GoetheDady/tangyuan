import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentRunState,
  type AgentSessionSummary,
} from '@tangyuan/contracts'
import type { ConfigStore, DirectoryLayout } from '../core'
import type { PiSdkGateway } from '../pi-sdk-driver-contracts'
import { AgentRuntimeError } from '../core'
import {
  extractAgentRuntimeConfig,
  isForkSource,
  isNotFoundError,
} from '../core'
import type {
  PersistedAttemptEntry,
  PersistedSessionIndex,
  PersistedSessionIndexEntry,
} from './session-index-types'

export type {
  PersistedAttemptEntry,
  PersistedSessionIndex,
  PersistedSessionIndexEntry,
} from './session-index-types'

/**
 * 创建 SessionIndexStore 所需的依赖。
 */
export interface SessionIndexStoreDependencies {
  layout: DirectoryLayout
  configStore: ConfigStore
  gateway: PiSdkGateway
}

/**
 * 会话索引存储：持有持久化索引条目及其派生的会话摘要这一对孪生状态，
 * 承载「会话索引如何读盘、写盘、从 SDK 重建与规范化」这一条知识。
 * 只管理索引数据与持久化，不涉及 session handle 生命周期、运行执行或事件广播。
 */
export class SessionIndexStore {
  private readonly layout: DirectoryLayout
  private readonly configStore: ConfigStore
  private readonly gateway: PiSdkGateway
  private readonly sessionIndex = new Map<string, PersistedSessionIndexEntry>()
  private readonly sessions = new Map<string, AgentSessionSummary>()

  constructor(dependencies: SessionIndexStoreDependencies) {
    this.layout = dependencies.layout
    this.configStore = dependencies.configStore
    this.gateway = dependencies.gateway
  }

  /**
   * 读取本地会话索引；索引不存在或损坏时尝试从 Pi SDK 原生 session 重建。
   *
   * @returns 当前可展示的会话索引条目。
   * @throws 当索引 JSON 损坏且 SDK 列表读取也失败时，Promise 会 reject。
   */
  async load(): Promise<PersistedSessionIndexEntry[]> {
    const indexPath = this.layout.sessionIndex()

    try {
      const rawIndex = await readFile(indexPath, 'utf8')
      const parsedIndex = JSON.parse(rawIndex) as Partial<PersistedSessionIndex>
      const entries = Array.isArray(parsedIndex.sessions)
        ? parsedIndex.sessions.flatMap((entry) => this.normalizeEntry(entry))
        : []
      this.replaceAll(entries)

      return entries
    } catch (error) {
      if (isNotFoundError(error)) {
        return this.rebuildFromSdk()
      }

      // 索引 JSON 损坏时也触发重建
      return this.rebuildFromSdk()
    }
  }

  /**
   * 在本地索引缺失或损坏时，扫描全局 Pi SDK session 目录重建索引。
   *
   * 按 session header 的工作目录恢复 Agent 归属；已归档 Agent 的会话同样保留
   *（listSummaries 按 agentId 过滤，不会混入当前活跃 Agent 的日常列表）。
   * 无法归属到任何已知 Agent 的 Pi 会话不进入索引。
   *
   * @returns 从 SDK 恢复出的索引条目。
   * @throws 当运行时配置读取失败时，Promise 会 reject。
   */
  private async rebuildFromSdk(): Promise<PersistedSessionIndexEntry[]> {
    const readResult = await this.configStore.read()

    if (!readResult.config) {
      this.replaceAll([])
      await this.write()
      return []
    }

    // 读取旧索引以保留扩展数据
    const oldEntries = await this.tryReadOldIndex()
    const config = readResult.config
    // 工作目录 → Agent 归属；含已归档 Agent，否则其会话谱系会在重建后丢失。
    const agentIdByCwd = new Map<string, string>()

    for (const agentId of Object.keys(config.agents)) {
      const cwd =
        agentId === TANGYUAN_DEFAULT_AGENT_ID
          ? this.layout.agentHome()
          : this.layout.workspace(agentId)
      agentIdByCwd.set(resolve(cwd), agentId)
    }

    let sdkSessions: Awaited<ReturnType<PiSdkGateway['listSessions']>>

    try {
      sdkSessions = await this.gateway.listSessions({
        sessionDir: this.layout.sdkSessionDir(),
      })
    } catch {
      // 全局扫描失败时给出空索引，下次 load 仍会重试重建。
      this.replaceAll([])
      await this.write()
      return []
    }

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
      // 索引已有来源优先；否则从 Pi session 的来源记录投影。
      const forkedFrom = oldEntry?.forkedFrom ?? session.forkedFrom

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

    this.replaceAll(allEntries)
    await this.write()

    return allEntries
  }

  /**
   * 尝试读取旧版本地会话索引，用于重建时保留扩展数据。
   *
   * @returns 以 sessionId 为键的旧索引条目映射。
   * @throws 此方法不会主动抛出错误。
   */
  private async tryReadOldIndex(): Promise<
    Map<string, PersistedSessionIndexEntry>
  > {
    try {
      const indexPath = this.layout.sessionIndex()
      const rawIndex = await readFile(indexPath, 'utf8')
      const parsedIndex = JSON.parse(rawIndex) as Partial<PersistedSessionIndex>
      const entries = Array.isArray(parsedIndex.sessions)
        ? parsedIndex.sessions.flatMap((entry) => this.normalizeEntry(entry))
        : []

      return new Map(entries.map((entry) => [entry.sessionId, entry]))
    } catch {
      return new Map()
    }
  }

  /**
   * 用已读取的索引条目刷新内存中的索引与会话摘要缓存。
   *
   * @param entries - 从本地索引或 SDK 恢复出的索引条目。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private replaceAll(entries: PersistedSessionIndexEntry[]): void {
    this.sessionIndex.clear()
    this.sessions.clear()

    for (const entry of entries) {
      this.sessionIndex.set(entry.sessionId, entry)
      this.sessions.set(entry.sessionId, this.toSummary(entry))
    }
  }

  /**
   * 把索引条目转换成 Renderer 使用的会话摘要。
   *
   * @param entry - 本地持久化索引条目。
   * @returns 对应的 AgentSessionSummary。
   * @throws 此方法不会主动抛出错误。
   */
  private toSummary(entry: PersistedSessionIndexEntry): AgentSessionSummary {
    return {
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      title: entry.title,
      state: entry.status,
      updatedAt: entry.updatedAt,
      ...(entry.archivedAt !== undefined
        ? { archivedAt: entry.archivedAt }
        : {}),
      ...(entry.forkedFrom !== undefined
        ? { forkedFrom: entry.forkedFrom }
        : {}),
    }
  }

  /**
   * 将会话索引以临时文件加 rename 的方式写入 userData。
   *
   * @returns 无返回值。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  async write(): Promise<void> {
    const indexPath = this.layout.sessionIndex()
    const entries = [...this.sessionIndex.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
    const payload: PersistedSessionIndex = {
      sessions: entries,
    }

    await mkdir(dirname(indexPath), { recursive: true })
    const tempIndexPath = `${indexPath}.${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.tmp`
    await writeFile(
      tempIndexPath,
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    )
    await rename(tempIndexPath, indexPath)
  }

  /**
   * 判断指定会话的摘要是否已加载到内存。
   *
   * @param sessionId - 会话标识。
   * @returns 已加载返回 true。
   */
  hasSummary(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * 读取指定会话摘要；不存在时返回 undefined。
   *
   * @param sessionId - 会话标识。
   * @returns 会话摘要或 undefined。
   */
  getSummary(sessionId: string): AgentSessionSummary | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * 列出指定 Agent 的会话摘要，按更新时间倒序。
   *
   * @param agentId - Agent 标识。
   * @param includeArchived - 是否包含已归档会话。
   * @returns 该 Agent 的会话摘要列表。
   */
  listSummaries(
    agentId: string,
    includeArchived = false,
  ): AgentSessionSummary[] {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.agentId === agentId &&
          (includeArchived || session.archivedAt === undefined),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * 读取已加载的单个索引条目；不存在时返回 undefined。
   *
   * @param sessionId - 会话标识。
   * @returns 索引条目或 undefined。
   */
  getEntryOrNull(sessionId: string): PersistedSessionIndexEntry | undefined {
    return this.sessionIndex.get(sessionId)
  }

  /**
   * 读取已加载的单个索引条目，不存在时抛错。
   *
   * @param sessionId - 会话标识。
   * @returns 对应索引条目。
   * @throws 当索引条目不存在时抛出 AgentRuntimeError。
   */
  getEntry(sessionId: string): PersistedSessionIndexEntry {
    const indexEntry = this.sessionIndex.get(sessionId)

    if (!indexEntry) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${sessionId} 的本地索引。`,
        recoverable: true,
      })
    }

    return indexEntry
  }

  /**
   * 读取指定会话已持久化的执行尝试记录。
   *
   * @param sessionId - 会话标识。
   * @returns 执行尝试列表；无记录时返回空数组。
   */
  getAttempts(sessionId: string): PersistedAttemptEntry[] {
    const entry = this.sessionIndex.get(sessionId)
    return entry?.attempts ?? []
  }

  /**
   * 新增一个会话的索引条目与派生摘要（不写盘，由调用方统一编排持久化）。
   *
   * @param entry - 新会话的索引条目。
   * @returns 派生出的会话摘要。
   */
  addSession(entry: PersistedSessionIndexEntry): AgentSessionSummary {
    this.sessionIndex.set(entry.sessionId, entry)
    const summary = this.toSummary(entry)
    this.sessions.set(entry.sessionId, summary)
    return summary
  }

  /**
   * 更新单个会话索引条目并同步会话摘要缓存，随后写盘。
   *
   * @param sessionId - 需要更新的会话标识。
   * @param patch - 要覆盖到索引条目上的字段。
   * @returns 更新后的索引条目。
   * @throws 当会话索引不存在时抛出 AgentRuntimeError。
   */
  async updateEntry(
    sessionId: string,
    patch: Partial<PersistedSessionIndexEntry>,
  ): Promise<PersistedSessionIndexEntry> {
    const currentEntry = this.getEntry(sessionId)
    const nextEntry = {
      ...currentEntry,
      ...patch,
    }
    this.sessionIndex.set(sessionId, nextEntry)
    this.sessions.set(sessionId, this.toSummary(nextEntry))
    await this.write()

    return nextEntry
  }

  /**
   * 一次性更新一组会话的归档状态并原子写盘。
   *
   * @param sessionIds - 要更新的会话标识。
   * @param archivedAt - 归档时间；传入 null 表示恢复。
   * @returns 更新后的会话摘要。
   * @throws 任一会话不存在或索引写入失败时，Promise 会 reject。
   */
  async setArchived(
    sessionIds: readonly string[],
    archivedAt: string | null,
  ): Promise<AgentSessionSummary[]> {
    const entries = sessionIds.map((sessionId) => this.getEntry(sessionId))

    for (const entry of entries) {
      const nextEntry: PersistedSessionIndexEntry = {
        ...entry,
        ...(archivedAt === null ? {} : { archivedAt }),
      }

      if (archivedAt === null) {
        delete nextEntry.archivedAt
      }

      this.sessionIndex.set(entry.sessionId, nextEntry)
      this.sessions.set(entry.sessionId, this.toSummary(nextEntry))
    }

    await this.write()
    return sessionIds.flatMap((sessionId) => {
      const summary = this.sessions.get(sessionId)
      return summary ? [summary] : []
    })
  }

  /**
   * 从内存索引和摘要缓存中永久删除一组会话并原子写盘。
   * Pi session 文件的物理删除由调用方负责。
   *
   * @param sessionIds - 要删除的会话标识。
   * @returns 无返回值。
   * @throws 当索引写入失败时，Promise 会 reject。
   */
  async deleteSessions(sessionIds: readonly string[]): Promise<void> {
    for (const sessionId of sessionIds) {
      this.sessionIndex.delete(sessionId)
      this.sessions.delete(sessionId)
    }

    await this.write()
  }

  /**
   * 在会话索引中新增或更新一条执行尝试记录（最多保留最近 20 条）。
   *
   * @param sessionId - 所属会话标识。
   * @param attempt - 要持久化的执行尝试记录。
   * @returns 无返回值。
   * @throws 当会话索引不存在或写入失败时，Promise 会 reject。
   */
  async upsertAttempt(
    sessionId: string,
    attempt: PersistedAttemptEntry,
  ): Promise<void> {
    const currentEntry = this.getEntry(sessionId)
    const existingAttempts = currentEntry.attempts ?? []
    const existingIndex = existingAttempts.findIndex(
      (a) => a.attemptId === attempt.attemptId,
    )

    const nextAttempts =
      existingIndex >= 0
        ? [
            ...existingAttempts.slice(0, existingIndex),
            attempt,
            ...existingAttempts.slice(existingIndex + 1),
          ]
        : [...existingAttempts, attempt]

    // 只保留最近 20 条，避免无限增长
    const trimmedAttempts = nextAttempts.slice(-20)

    await this.updateEntry(sessionId, {
      attempts: trimmedAttempts,
    })
  }

  /**
   * 更新会话摘要的运行状态（仅改数据，不广播事件）。
   *
   * @param sessionId - 会话标识。
   * @param state - 新的运行状态。
   * @param updatedAt - 更新时间。
   * @returns 更新后的会话摘要。
   * @throws 当会话摘要不存在时抛出 AgentRuntimeError。
   */
  setSummaryState(
    sessionId: string,
    state: AgentRunState,
    updatedAt: string,
  ): AgentSessionSummary {
    const session = this.sessions.get(sessionId)

    if (!session) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${sessionId}。`,
        recoverable: true,
      })
    }

    const nextSession = {
      ...session,
      state,
      updatedAt,
    }
    this.sessions.set(sessionId, nextSession)
    return nextSession
  }

  /**
   * 把未知 JSON 值规范化为合法的会话索引条目。
   *
   * @param value - 待校验的未知值。
   * @returns 合法时返回单元素数组，否则返回空数组。
   * @throws 此方法不会主动抛出错误。
   */
  private normalizeEntry(value: unknown): PersistedSessionIndexEntry[] {
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
      !this.isAgentRunState(entry.status)
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

  /**
   * 判断未知值是否是可展示的 Agent 运行状态。
   *
   * @param value - 待判断的未知值。
   * @returns 是 AgentRunState 时返回 true。
   * @throws 此方法不会主动抛出错误。
   */
  private isAgentRunState(value: unknown): value is AgentRunState {
    return (
      value === 'idle' ||
      value === 'running' ||
      value === 'completed' ||
      value === 'cancelled' ||
      value === 'failed'
    )
  }
}
