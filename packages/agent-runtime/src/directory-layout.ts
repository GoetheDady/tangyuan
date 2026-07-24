import { dirname, join } from 'node:path'
import { TANGYUAN_DEFAULT_AGENT_ID, type AgentId } from '@tangyuan/contracts'

/**
 * DirectoryLayout 的根路径依赖。
 */
export interface DirectoryLayoutRoots {
  /** 默认 Agent Home 路径，支持以 `~` 开头表示相对 fsRoot。 */
  agentHomePath: string
  /** 文件系统根，用于展开 `~` 前缀。 */
  fsRoot: string
  /** 汤圆用户数据目录（config、sessions 等所在）。 */
  userDataPath: string
}

/**
 * 本地目录布局：把逻辑概念（Agent Home、工作空间、Skill 目录、用户资料、
 * 会话文件、配置文件）翻译成本地磁盘路径。纯路径计算，不触碰文件系统。
 */
export class DirectoryLayout {
  private readonly agentHomePath: string
  private readonly fsRoot: string
  private readonly userDataPath: string

  constructor(roots: DirectoryLayoutRoots) {
    this.agentHomePath = roots.agentHomePath
    this.fsRoot = roots.fsRoot
    this.userDataPath = roots.userDataPath
  }

  /**
   * 解析指定 Agent 的 home 绝对路径。
   *
   * @param agentId - Agent 标识，缺省为默认汤圆。
   * @returns Agent Home 目录的绝对路径。
   */
  agentHome(agentId: string = TANGYUAN_DEFAULT_AGENT_ID): string {
    const resolvedDefault = this.agentHomePath.startsWith('~')
      ? join(this.fsRoot, this.agentHomePath.slice(2))
      : this.agentHomePath

    if (agentId === TANGYUAN_DEFAULT_AGENT_ID) {
      return resolvedDefault
    }

    return join(dirname(resolvedDefault), agentId)
  }

  /**
   * 解析指定 Agent 的 workspace 绝对路径。
   *
   * @param agentId - Agent 标识。
   * @returns workspace 目录的绝对路径。
   */
  workspace(agentId: string): string {
    return join(this.agentHome(agentId), 'workspace')
  }

  /**
   * 解析共享 Skills 目录的绝对路径。
   *
   * @returns ~/.tangyuan/skills/ 绝对路径。
   */
  sharedSkills(): string {
    // 共享 skills: ~/.tangyuan/skills/
    // agentHomePath: ~/.tangyuan/agents/tangyuan
    const tangyuanDir = dirname(this.agentHome()) // ~/.tangyuan/agents
    return join(dirname(tangyuanDir), 'skills') // ~/.tangyuan/skills
  }

  /**
   * 解析指定 Agent 专属 Skills 目录的绝对路径。
   *
   * @param agentId - Agent 标识。
   * @returns ~/.tangyuan/agents/<agentId>/skills/ 绝对路径。
   */
  agentSkills(agentId: string): string {
    return join(this.agentHome(agentId), 'skills')
  }

  /**
   * 解析共享 profile 目录的绝对路径。
   *
   * @returns ~/.tangyuan/profile/ 绝对路径。
   */
  sharedProfile(): string {
    // 共享 profile: ~/.tangyuan/profile/
    // agentHomePath: ~/.tangyuan/agents/tangyuan
    const tangyuanDir = dirname(this.agentHome()) // ~/.tangyuan/agents
    return join(dirname(tangyuanDir), 'profile') // ~/.tangyuan/profile
  }

  /**
   * 解析共享 user profile 文件的绝对路径。
   *
   * @returns ~/.tangyuan/profile/user.md 绝对路径。
   */
  userProfile(): string {
    return join(this.sharedProfile(), 'user.md')
  }

  /**
   * 解析共享 user profile 历史目录的绝对路径。
   *
   * @returns ~/.tangyuan/profile/user.history/ 绝对路径。
   */
  userHistory(): string {
    return join(this.sharedProfile(), 'user.history')
  }

  /**
   * 解析指定 Agent 的 soul 文件绝对路径。
   *
   * @param agentId - Agent 标识。
   * @returns agent home 下 soul.md 的绝对路径。
   */
  soul(agentId: AgentId): string {
    return join(this.agentHome(agentId), 'soul.md')
  }

  /**
   * 解析指定 Agent 的 soul 历史目录绝对路径。
   *
   * @param agentId - Agent 标识。
   * @returns agent home 下 soul.history/ 的绝对路径。
   */
  soulHistory(agentId: AgentId): string {
    return join(this.agentHome(agentId), 'soul.history')
  }

  /**
   * 解析配置文件绝对路径。
   *
   * @returns userDataPath 下 config.json 绝对路径。
   */
  config(): string {
    return join(this.userDataPath, 'config.json')
  }

  /**
   * 解析配置备份文件绝对路径。
   *
   * @returns userDataPath 下 config.backup.json 绝对路径。
   */
  configBackup(): string {
    return join(this.userDataPath, 'config.backup.json')
  }

  /**
   * 解析会话索引文件绝对路径。
   *
   * @returns userDataPath 下 sessions/index.json 绝对路径。
   */
  sessionIndex(): string {
    return join(this.userDataPath, 'sessions', 'index.json')
  }

  /**
   * 解析 Pi SDK 会话目录绝对路径。
   *
   * @returns userDataPath 下 sessions/pi-sdk 绝对路径。
   */
  sdkSessionDir(): string {
    return join(this.userDataPath, 'sessions', 'pi-sdk')
  }

  /**
   * 解析指定会话的 Pi SDK 会话文件绝对路径。
   *
   * @param sessionId - 会话标识。
   * @returns sessions/pi-sdk/<sessionId>.jsonl 绝对路径。
   */
  sdkSessionFile(sessionId: string): string {
    return join(this.sdkSessionDir(), `${sessionId}.jsonl`)
  }

  /**
   * 解析 Skill 安装记录文件绝对路径。
   *
   * @param source - 记录来源：共享或 Agent 专属。
   * @param agentId - Agent 专属记录时必填。
   * @returns 安装记录文件绝对路径。
   * @throws 当 source 为 agent 但未提供 agentId 时抛出错误。
   */
  installRecords(source: 'shared' | 'agent', agentId?: string): string {
    if (source === 'shared') {
      return join(this.sharedSkills(), '.tangyuan-records.json')
    }

    if (!agentId) {
      throw new Error('Agent 专属 Skill 记录需要提供 agentId。')
    }

    return join(this.agentSkills(agentId), '.tangyuan-records.json')
  }
}
