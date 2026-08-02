import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  lastActiveSessionSchema,
  type LastActiveSession,
} from '@yuanxiao/contracts'
import type { DirectoryLayout } from '../core'

/**
 * 创建 LastActiveSessionStore 所需的依赖。
 */
export interface LastActiveSessionStoreDependencies {
  layout: DirectoryLayout
  now: () => string
}

/**
 * 最后激活会话存储：持久化用户最后一次打开的 `{agentId, sessionId}`，
 * 承载「启动恢复如何读盘、写盘与清除」这一条知识。
 * 只管理记录文件本身，不校验会话或 Agent 的可用性。
 */
export class LastActiveSessionStore {
  private readonly layout: DirectoryLayout
  private readonly now: () => string

  constructor(dependencies: LastActiveSessionStoreDependencies) {
    this.layout = dependencies.layout
    this.now = dependencies.now
  }

  /**
   * 读取持久化的最后激活会话记录。
   *
   * @returns 合法记录；文件不存在或损坏时返回 null。
   * @throws 此方法不会主动抛出错误。
   */
  async read(): Promise<LastActiveSession | null> {
    try {
      const raw = await readFile(this.layout.lastActiveSession(), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      const result = lastActiveSessionSchema.safeParse(parsed)
      return result.success ? result.data : null
    } catch {
      return null
    }
  }

  /**
   * 原子写入最后激活会话记录。
   *
   * @param record - 要持久化的记录，updatedAt 由注入的 now 生成。
   * @returns 写入后的记录。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  async write(
    record: Omit<LastActiveSession, 'updatedAt'>,
  ): Promise<LastActiveSession> {
    const path = this.layout.lastActiveSession()
    const payload: LastActiveSession = {
      agentId: record.agentId,
      sessionId: record.sessionId,
      updatedAt: this.now(),
    }

    await mkdir(dirname(path), { recursive: true })
    const tmpPath = `${path}.${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.tmp`
    await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(tmpPath, path)

    return payload
  }

  /**
   * 清除最后激活会话记录文件。
   *
   * @returns 无返回值。
   * @throws 删除记录文件失败时，Promise 会 reject。
   */
  async clear(): Promise<void> {
    await rm(this.layout.lastActiveSession(), { force: true })
  }
}
