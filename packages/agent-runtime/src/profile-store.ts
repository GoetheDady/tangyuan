import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentId,
  type ProfileMaintenanceResult,
  type SoulContent,
  type UserProfileContent,
} from '@tangyuan/contracts'
import type { DirectoryLayout } from './directory-layout'
import type { ConfigStore } from './config-store'
import {
  extractAgentRuntimeConfig,
  fileHasContent,
  getMtimeIso,
  pathExists,
  readDirectoryFileSet,
  safeReadFile,
} from './utils'

/** 追加到系统提示词的 profile 上下文标题。 */
const PROFILE_CONTEXT_HEADER = '汤圆长期上下文'

/**
 * 描述默认 Agent Home 中 profile/bootstrap 文件的当前状态。
 */
export interface AgentHomeStatus {
  initialized: boolean
  bootstrapRequired: boolean
  bootstrapFileExists: boolean
  soulFileExists: boolean
  userFileExists: boolean
  soulUpdatedAt: string | null
  userUpdatedAt: string | null
}

export type ProfileMaintenanceTarget = 'soul' | 'user'

export interface ProfileMaintenanceFileSnapshot {
  target: ProfileMaintenanceTarget
  path: string
  historyPath: string
  content: string
  historyFiles: Set<string>
}

export interface ProfileMaintenanceSnapshot {
  soul: ProfileMaintenanceFileSnapshot
  user: ProfileMaintenanceFileSnapshot
}

/**
 * writeSoul / writeUserProfile 的结果：既含对外的维护结果，
 * 也标记本次是否真的写入了文件（供调用方决定是否广播事件、刷新会话）。
 */
export interface ProfileWriteOutcome {
  result: ProfileMaintenanceResult
  written: boolean
}

/**
 * 创建 ProfileStore 所需的依赖。
 */
export interface ProfileStoreDependencies {
  layout: DirectoryLayout
  configStore: ConfigStore
  now: () => string
}

/**
 * Profile 存取：soul/user profile 文件的读写、校验、脱敏、迁移、
 * bootstrap 门控与系统提示上下文构建。
 * 承载「profile 文件在磁盘上如何组织与校验」这一条知识，
 * 只返回结果，不广播事件、不触碰会话。
 */
export class ProfileStore {
  private readonly layout: DirectoryLayout
  private readonly configStore: ConfigStore
  private readonly now: () => string

  constructor(dependencies: ProfileStoreDependencies) {
    this.layout = dependencies.layout
    this.configStore = dependencies.configStore
    this.now = dependencies.now
  }

  /**
   * 确保指定 Agent Home 目录结构存在，并在缺失时写入默认 soul.md。
   *
   * @param agentId - Agent 标识。
   * @returns 无返回值。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  async ensureAgentHome(agentId: AgentId): Promise<void> {
    const homePath = this.layout.agentHome(agentId)
    const soulHistoryPath = this.layout.soulHistory(agentId)

    await mkdir(homePath, { recursive: true })
    await mkdir(soulHistoryPath, { recursive: true })
    await mkdir(join(homePath, 'memory'), { recursive: true })
    await mkdir(join(homePath, 'skills'), { recursive: true })
    await mkdir(join(homePath, 'workspace'), { recursive: true })

    // 确保 soul.md 存在
    const soulPath = this.layout.soul(agentId)

    if (!(await pathExists(soulPath))) {
      const displayName =
        agentId === TANGYUAN_DEFAULT_AGENT_ID ? '汤圆' : agentId
      const soulContent = [
        `# ${displayName}`,
        '',
        `创建时间：${this.now()}`,
        '',
        '## 身份',
        agentId === TANGYUAN_DEFAULT_AGENT_ID
          ? '汤圆是默认 Agent，负责凭据管理和创建其他 Agent。'
          : `${displayName} 是用户创建的 Agent。`,
        '',
        '## 规则',
        '遵循用户指令，在执行危险操作前先确认。',
        '',
      ].join('\n')
      await writeFile(soulPath, soulContent, 'utf8')
    }
  }

  /**
   * 从旧 tangyuan Agent 目录迁移 user.md 到共享 profile 路径。
   *
   * @returns 无返回值。
   * @throws 当文件读取、复制或写入失败时，Promise 会 reject。
   */
  async migrateLegacyUserProfile(): Promise<void> {
    const legacyUserPath = join(
      this.layout.agentHome(TANGYUAN_DEFAULT_AGENT_ID),
      'user.md',
    )
    const legacyHistoryPath = join(
      this.layout.agentHome(TANGYUAN_DEFAULT_AGENT_ID),
      'user.history',
    )
    const targetPath = this.layout.userProfile()
    const targetHistoryPath = this.layout.userHistory()

    if (!(await pathExists(legacyUserPath))) {
      return
    }

    // 迁移 user.md
    await mkdir(this.layout.sharedProfile(), { recursive: true })
    await copyFile(legacyUserPath, targetPath)

    // 迁移 user.history/ 目录下的文件
    if (await pathExists(legacyHistoryPath)) {
      await mkdir(targetHistoryPath, { recursive: true })
      const historyFiles = await readDirectoryFileSet(legacyHistoryPath)

      for (const fileName of historyFiles) {
        await copyFile(
          join(legacyHistoryPath, fileName),
          join(targetHistoryPath, fileName),
        )
      }
    }
  }

  /**
   * 确保默认 Agent Home 及 bootstrap 相关文件存在，并返回 profile 状态。
   *
   * @returns 默认 Agent Home 的文件状态。
   * @throws 当文件系统创建、读取或写入失败时，Promise 会 reject。
   */
  async ensureDefaultAgentHome(): Promise<AgentHomeStatus> {
    const absoluteHomePath = this.layout.agentHome()
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = this.layout.userProfile()
    const soulHistoryPath = join(absoluteHomePath, 'soul.history')
    const userHistoryPath = join(absoluteHomePath, 'user.history')
    const memoryPath = join(absoluteHomePath, 'memory')
    const skillsPath = join(absoluteHomePath, 'skills')

    await mkdir(absoluteHomePath, { recursive: true })
    await Promise.all([
      mkdir(soulHistoryPath, { recursive: true }),
      mkdir(userHistoryPath, { recursive: true }),
      mkdir(memoryPath, { recursive: true }),
      mkdir(skillsPath, { recursive: true }),
    ])

    // 确保共享 profile 和 skills 目录存在
    await mkdir(this.layout.sharedProfile(), { recursive: true })
    await mkdir(this.layout.userHistory(), { recursive: true })
    await mkdir(this.layout.sharedSkills(), { recursive: true })

    // 若共享 user.md 不存在，尝试从旧路径迁移
    if (!(await pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    const [bootstrapFileExists, soulFileExists, userFileExists] =
      await Promise.all([
        pathExists(bootstrapPath),
        pathExists(soulPath),
        pathExists(userPath),
      ])

    if (!bootstrapFileExists && !soulFileExists && !userFileExists) {
      await writeFile(bootstrapPath, this.createBootstrapTemplate(), 'utf8')
    }

    // 初始化完成的唯一真相：soul.md 与 user.md 均存在且内容非空。
    // 空文件不算完成，仍处于初始化阻断态。
    const [soulHasContent, userHasContent] = await Promise.all([
      soulFileExists ? fileHasContent(soulPath) : Promise.resolve(false),
      userFileExists ? fileHasContent(userPath) : Promise.resolve(false),
    ])
    const profileReady = soulHasContent && userHasContent

    return {
      initialized: profileReady,
      bootstrapRequired: !profileReady && (await pathExists(bootstrapPath)),
      bootstrapFileExists: await pathExists(bootstrapPath),
      soulFileExists: await pathExists(soulPath),
      userFileExists: await pathExists(userPath),
      soulUpdatedAt: await getMtimeIso(soulPath),
      userUpdatedAt: await getMtimeIso(userPath),
    }
  }

  /**
   * 读取指定 Agent 的 soul 内容（缺失时先补齐目录骨架）。
   *
   * @param agentId - Agent 标识。
   * @returns soul 内容和更新时间。
   * @throws 当文件读取失败时，Promise 会 reject。
   */
  async readSoul(agentId: AgentId): Promise<SoulContent> {
    const soulPath = this.layout.soul(agentId)

    await this.ensureAgentHome(agentId)

    const content = await safeReadFile(soulPath)
    const updatedAt = (await getMtimeIso(soulPath)) ?? this.now()

    return { agentId, content, updatedAt }
  }

  /**
   * 读取共享 user profile 内容（缺失时迁移或创建空文件）。
   *
   * @returns 共享 user profile 内容和更新时间。
   * @throws 当文件读取失败时，Promise 会 reject。
   */
  async readUserProfile(): Promise<UserProfileContent> {
    const userPath = this.layout.userProfile()

    if (!(await pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    await mkdir(this.layout.sharedProfile(), { recursive: true })
    await mkdir(this.layout.userHistory(), { recursive: true })

    if (!(await pathExists(userPath))) {
      await writeFile(userPath, '', 'utf8')
    }

    const content = await safeReadFile(userPath)
    const updatedAt = (await getMtimeIso(userPath)) ?? this.now()

    return { content, updatedAt }
  }

  /**
   * 写入指定 Agent 的 soul（含权限校验、备份验证和敏感信息过滤）。
   *
   * 仅返回结果，不广播事件、不刷新会话（由调用方编排）。
   *
   * @param agentId - 目标 Agent 标识。
   * @param content - 新 soul 内容。
   * @param requestedByAgentId - 发起更新请求的 Agent 标识。
   * @returns profile 维护结果。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  async writeSoul(
    agentId: AgentId,
    content: string,
    requestedByAgentId: AgentId,
  ): Promise<ProfileWriteOutcome> {
    // 权限校验：Agent 只能更新自己的 soul
    // 汤圆可以在创建时写入其他 Agent 的初始 soul（由 createAgent 调用）
    if (
      agentId !== requestedByAgentId &&
      requestedByAgentId !== TANGYUAN_DEFAULT_AGENT_ID
    ) {
      return {
        written: false,
        result: {
          target: 'soul',
          success: false,
          reason: `Agent "${requestedByAgentId}" 无权修改 Agent "${agentId}" 的 soul。只有 Agent 自身或汤圆可以修改。`,
        },
      }
    }

    const soulPath = this.layout.soul(agentId)
    const historyPath = this.layout.soulHistory(agentId)

    await this.ensureAgentHome(agentId)

    const previousContent = (await pathExists(soulPath))
      ? await safeReadFile(soulPath)
      : ''
    const previousHistoryFiles = await readDirectoryFileSet(historyPath)

    if (previousContent === content) {
      return { written: false, result: { target: 'soul', success: true } }
    }

    const hasBackup = previousContent === '' || previousHistoryFiles.size > 0

    if (!hasBackup) {
      return {
        written: false,
        result: {
          target: 'soul',
          success: false,
          reason: `更新 soul 失败：缺少更新前备份，请先将旧内容备份到 soul.history/ 目录。`,
        },
      }
    }

    const apiKey = await this.readAgentApiKey(agentId)
    const redactedContent = this.redactSensitiveContent(content, apiKey)

    await writeFile(soulPath, redactedContent, 'utf8')

    return { written: true, result: { target: 'soul', success: true } }
  }

  /**
   * 写入共享 user profile（含备份验证和敏感信息过滤）。
   *
   * 仅返回结果，不广播事件、不刷新会话（由调用方编排）。
   *
   * @param content - 新 user profile 内容。
   * @returns profile 维护结果。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  async writeUserProfile(content: string): Promise<ProfileWriteOutcome> {
    const userPath = this.layout.userProfile()
    const historyPath = this.layout.userHistory()

    await mkdir(this.layout.sharedProfile(), { recursive: true })
    await mkdir(historyPath, { recursive: true })

    if (!(await pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    const previousContent = (await pathExists(userPath))
      ? await safeReadFile(userPath)
      : ''
    const previousHistoryFiles = await readDirectoryFileSet(historyPath)

    if (previousContent === content) {
      return { written: false, result: { target: 'user', success: true } }
    }

    const hasBackup = previousContent === '' || previousHistoryFiles.size > 0

    if (!hasBackup) {
      return {
        written: false,
        result: {
          target: 'user',
          success: false,
          reason: `更新 user profile 失败：缺少更新前备份，请先将旧内容备份到 user.history/ 目录。`,
        },
      }
    }

    const apiKey = await this.readAgentApiKey(TANGYUAN_DEFAULT_AGENT_ID)
    const redactedContent = this.redactSensitiveContent(content, apiKey)

    await writeFile(userPath, redactedContent, 'utf8')

    return { written: true, result: { target: 'user', success: true } }
  }

  /**
   * 读取指定 Agent 当前生效的 API Key（用于精确脱敏）。
   *
   * @param agentId - Agent 标识。
   * @returns API Key；未配置时返回 null。
   * @throws 当配置读取失败时，Promise 会 reject。
   */
  private async readAgentApiKey(agentId: AgentId): Promise<string | null> {
    const readResult = await this.configStore.read()
    const runtimeConfig = readResult.config
      ? extractAgentRuntimeConfig(readResult.config, agentId)
      : null
    return runtimeConfig?.apiKey ?? null
  }

  /**
   * 构造需追加到系统提示词末尾的身份上下文片段。
   *
   * soul.md 与 user.md 同时存在且内容非空时注入 profile；否则注入
   * bootstrap 初始化指令与 bootstrap.md 全文。
   *
   * @param agentId - Agent 标识；默认为 tangyuan。
   * @returns 可追加到系统提示词的 profile / bootstrap 上下文字符串。
   * @throws 当 profile 文件读取失败时，Promise 会 reject。
   */
  async buildSystemPromptContext(
    agentId: AgentId = TANGYUAN_DEFAULT_AGENT_ID,
  ): Promise<string> {
    const absoluteHomePath = this.layout.agentHome(agentId)
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = this.layout.userProfile()
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')

    // 确保共享 user profile 存在
    if (!(await pathExists(userPath))) {
      await this.migrateLegacyUserProfile()
    }

    const [soulContent, profileUserContent] = await Promise.all([
      (await pathExists(soulPath))
        ? readFile(soulPath, 'utf8')
        : Promise.resolve(''),
      (await pathExists(userPath))
        ? readFile(userPath, 'utf8')
        : Promise.resolve(''),
    ])

    // 初始化完成的唯一真相：soul.md 与 user.md 均存在且内容非空。
    if (soulContent.trim() !== '' && profileUserContent.trim() !== '') {
      return [
        `# ${PROFILE_CONTEXT_HEADER}`,
        '',
        '## soul.md',
        soulContent.trim(),
        '',
        '## user.md',
        profileUserContent.trim(),
      ].join('\n')
    }

    const bootstrapContent = (await pathExists(bootstrapPath))
      ? await readFile(bootstrapPath, 'utf8')
      : this.createBootstrapTemplate()

    return [
      `# ${PROFILE_CONTEXT_HEADER}`,
      '',
      '当前 profile 尚未初始化。请根据 bootstrap.md 的问题推进首次初始化；信息不足时继续追问，不要要求用户点击完成按钮。',
      '当你判断固定问题已经回答充分时，必须使用 Pi SDK 可用文件工具完成初始化。',
      '',
      '初始化完成规则：',
      '1. 使用 write 或 edit 写入 soul.md。',
      '2. 使用 write 或 edit 写入 user.md。',
      '3. 完成后删除 bootstrap.md。',
      '4. 不得把 API Key、密钥、令牌或其它敏感凭据写入 soul.md 或 user.md。',
      '',
      'soul.md 至少必须覆盖：身份、用户偏好、工作范围、沟通方式、权限边界、敏感信息规则、记忆与技能原则、不确定时的处理方式。',
      'user.md 至少必须覆盖：称呼、语言与语气偏好、常见工作类型、决策偏好、需要先确认的事项、禁止触碰的信息和边界、长期偏好。',
      '',
      '## bootstrap.md',
      bootstrapContent.trim(),
    ].join('\n')
  }

  /**
   * 在 bootstrap 模式回合结束后施行文件门控。
   *
   * @returns 无返回值。
   * @throws 当 bootstrap.md 重建写入失败时，Promise 会 reject。
   */
  async performBootstrapCompletionGating(): Promise<void> {
    const absoluteHomePath = this.layout.agentHome()
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = join(absoluteHomePath, 'user.md')

    const [bootstrapExists, soulExists, userExists] = await Promise.all([
      pathExists(bootstrapPath),
      pathExists(soulPath),
      pathExists(userPath),
    ])

    // Gate 1: bootstrap 完成 — 确保 bootstrap.md 已被删除
    if (soulExists && userExists) {
      if (bootstrapExists) {
        const { rm } = await import('node:fs/promises')
        await rm(bootstrapPath, { force: true })
      }
      return
    }

    // Gate 2: 恢复 — bootstrap.md 被误删但 profile 未完成
    if (!bootstrapExists) {
      await writeFile(bootstrapPath, this.createBootstrapTemplate(), 'utf8')
    }

    // Gate 3: bootstrap 仍在进行中 — 不做任何操作
  }

  /**
   * 读取维护回合开始前的 profile 文件内容和历史目录状态。
   *
   * @param agentId - Agent 标识；默认为 tangyuan。
   * @returns soul.md、user.md 及其历史目录的快照。
   * @throws 当 profile 文件或历史目录无法读取时，Promise 会 reject。
   */
  async readMaintenanceSnapshot(
    agentId: AgentId = TANGYUAN_DEFAULT_AGENT_ID,
  ): Promise<ProfileMaintenanceSnapshot> {
    return {
      soul: await this.readMaintenanceFileSnapshot({
        target: 'soul',
        path: this.layout.soul(agentId),
        historyPath: this.layout.soulHistory(agentId),
      }),
      user: await this.readMaintenanceFileSnapshot({
        target: 'user',
        path: this.layout.userProfile(),
        historyPath: this.layout.userHistory(),
      }),
    }
  }

  /**
   * 读取单个 profile 文件及其历史目录状态。
   *
   * @param input - 需要读取的 profile 目标、文件路径和历史目录路径。
   * @returns 可用于维护结果校验的文件快照。
   * @throws 当文件读取失败时，Promise 会 reject。
   */
  private async readMaintenanceFileSnapshot(input: {
    target: ProfileMaintenanceTarget
    path: string
    historyPath: string
  }): Promise<ProfileMaintenanceFileSnapshot> {
    return {
      target: input.target,
      path: input.path,
      historyPath: input.historyPath,
      content: await readFile(input.path, 'utf8'),
      historyFiles: await readDirectoryFileSet(input.historyPath),
    }
  }

  /**
   * 判断维护回合是否写入了新的历史备份文件。
   *
   * @param previousFile - 维护回合开始前的 profile 文件快照。
   * @returns 有新增历史文件时返回 true，否则返回 false。
   * @throws 当历史目录无法读取时，Promise 会 reject。
   */
  async hasNewHistoryFile(
    previousFile: ProfileMaintenanceFileSnapshot,
  ): Promise<boolean> {
    const nextHistoryFiles = await readDirectoryFileSet(previousFile.historyPath)

    for (const fileName of nextHistoryFiles) {
      if (!previousFile.historyFiles.has(fileName)) {
        return true
      }
    }

    return false
  }

  /**
   * 从 profile 内容中移除敏感凭据。
   *
   * @param content - Agent 写入的 profile 原始内容。
   * @param apiKey - 已保存配置里的 API Key，用于精确替换。
   * @returns 已脱敏的 profile 内容。
   * @throws 此方法不会主动抛出错误。
   */
  redactSensitiveContent(content: string, apiKey: string | null): string {
    const exactRedactedContent = apiKey
      ? content.split(apiKey).join('[已隐藏敏感凭据]')
      : content

    return exactRedactedContent
      .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{6,}\b/g, '[已隐藏敏感凭据]')
      .replace(
        /((?:api\s*key|token|password|secret|密钥|令牌|密码)\s*[:：=]\s*)([^\s，。；;]+)/gi,
        '$1[已隐藏敏感凭据]',
      )
  }

  /**
   * 构造后台 profile 维护回合使用的 prompt。
   *
   * @param input - 本轮主回合的用户消息、Agent 回复以及当前 profile 内容。
   * @returns 只用于后台维护的完整 prompt。
   * @throws 此方法不会主动抛出错误。
   */
  buildMaintenancePrompt(input: {
    userContent: string
    agentContent: string
    soulContent: string
    profileUserContent: string
  }): string {
    return [
      '# 后台 profile 维护回合',
      '',
      '这是主回复完成后的后台 profile 维护回合，不要回复用户，不要继续主回复，也不要输出会混入 transcript 的总结。',
      '只在本轮对话明确改变长期偏好、边界、称呼、工作规则或 Agent 行为规则时更新 profile；内容无实质变化时不要写文件。',
      '',
      '更新规则：',
      '1. 单轮最多更新一次 soul.md，最多更新一次 user.md。',
      '2. 更新前必须使用 read 读取旧文件。',
      '3. 更新前必须使用 write 把旧内容备份到 soul.history/ 或 user.history/。',
      '4. 更新必须使用 edit 或 write 完成。',
      '5. 不得把 API Key、token、password、密码、密钥或令牌写入 soul.md / user.md。',
      '',
      '## 当前 soul.md',
      input.soulContent.trim(),
      '',
      '## 当前 user.md',
      input.profileUserContent.trim(),
      '',
      '## 刚完成的用户消息',
      input.userContent,
      '',
      '## 刚完成的 Agent 主回复',
      input.agentContent,
    ].join('\n')
  }

  /**
   * 生成固定的 bootstrap 问题模板。
   *
   * @returns 可写入 bootstrap.md 的 Markdown 内容。
   * @throws 此方法不会主动抛出错误。
   */
  createBootstrapTemplate(): string {
    return [
      '# Bootstrap',
      '',
      '1. 用户希望汤圆怎么称呼自己。',
      '2. 用户希望汤圆默认使用什么语言、语气和沟通密度。',
      '3. 用户主要希望汤圆帮助完成哪些工作。',
      '4. 哪些操作必须先征求用户确认。',
      '5. 哪些目录、文件、信息永远不能触碰或泄露。',
      '6. 用户希望汤圆如何记录长期偏好和项目经验。',
      '7. 汤圆在失败、不确定或缺少上下文时应该如何处理。',
      '8. 哪些规则必须写入 soul.md 并长期遵守。',
      '',
    ].join('\n')
  }
}
