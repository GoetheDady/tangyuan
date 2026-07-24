import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentId,
  type SkillInstallRecord,
  type SkillOperationParams,
  type SkillSummary,
} from '@tangyuan/contracts'
import type { DirectoryLayout } from './directory-layout'

/**
 * Pi SDK ResourceLoader 解析出的 Skill 结构（mapSkillsToSummaries 输入）。
 */
interface LoadedSkill {
  name: string
  description: string
  filePath: string
  baseDir: string
  sourceInfo?: { path: string; source: string }
  disableModelInvocation?: boolean
}

/**
 * Pi SDK ResourceLoader 的加载诊断信息（含冲突）。
 */
interface SkillDiagnostic {
  type: string
  message: string
  path?: string
  collision?: {
    resourceType: string
    name: string
    winnerPath: string
    loserPath: string
  }
}

/**
 * 创建 SkillStore 所需的依赖。
 */
export interface SkillStoreDependencies {
  layout: DirectoryLayout
  now: () => string
}

/**
 * Skill 存取：列出、安装、删除 Skill 及维护安装记录。
 * 承载「Skill 在磁盘上如何组织与安装」这一条知识，不涉及会话刷新。
 */
export class SkillStore {
  private readonly layout: DirectoryLayout
  private readonly now: () => string

  constructor(dependencies: SkillStoreDependencies) {
    this.layout = dependencies.layout
    this.now = dependencies.now
  }

  /**
   * 列出指定 Agent 生效的 Skill（含共享与专属，标注冲突）。
   *
   * @param agentId - Agent 标识。
   * @returns Skill 摘要列表。
   * @throws 当 Pi SDK ResourceLoader 加载失败时，Promise 会 reject。
   */
  async listAgentSkills(agentId: AgentId): Promise<SkillSummary[]> {
    const agentSkillsPath = this.layout.agentSkills(agentId)
    const sharedSkillsPath = this.layout.sharedSkills()

    // 确保目录存在
    await mkdir(agentSkillsPath, { recursive: true })
    await mkdir(sharedSkillsPath, { recursive: true })

    const { DefaultResourceLoader } = await import(
      '@earendil-works/pi-coding-agent'
    )

    const loader = new DefaultResourceLoader({
      cwd: this.layout.workspace(agentId),
      agentDir: this.layout.agentHome(agentId),
      noSkills: true,
      additionalSkillPaths: [agentSkillsPath, sharedSkillsPath],
    })

    await loader.reload()

    const { skills, diagnostics } = loader.getSkills()

    return this.mapSkillsToSummaries(skills, diagnostics)
  }

  /**
   * 列出共享 Skill 列表。
   *
   * @returns 共享 Skill 摘要列表。
   * @throws 当 Pi SDK ResourceLoader 加载失败时，Promise 会 reject。
   */
  async listSharedSkills(): Promise<SkillSummary[]> {
    const sharedSkillsPath = this.layout.sharedSkills()

    await mkdir(sharedSkillsPath, { recursive: true })

    const { DefaultResourceLoader } = await import(
      '@earendil-works/pi-coding-agent'
    )

    const loader = new DefaultResourceLoader({
      cwd: this.layout.workspace(TANGYUAN_DEFAULT_AGENT_ID),
      agentDir: this.layout.agentHome(),
      noSkills: true,
      additionalSkillPaths: [sharedSkillsPath],
    })

    await loader.reload()

    const { skills, diagnostics } = loader.getSkills()

    return this.mapSkillsToSummaries(skills, diagnostics)
  }

  /**
   * 安装或更新 Skill（含 SKILL.md 校验和原子写入）。
   *
   * @param params - Skill 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当校验失败或文件操作失败时，Promise 会 reject。
   */
  async installSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    const sourceDir = params.skillDirPath
    if (!sourceDir) {
      throw new Error('安装 Skill 需要提供 skillDirPath。')
    }

    // 校验源目录
    await this.validateSkillDirectory(sourceDir, params.skillName)

    const targetDir = this.resolveSkillTargetDir(
      params.source,
      params.targetAgentId,
    )

    // 确保目标目录存在
    await mkdir(targetDir, { recursive: true })

    const skillTargetDir = join(targetDir, params.skillName)

    // 使用安全临时目录进行原子替换
    const tempRoot = join(tmpdir(), 'tangyuan-skill-')
    const tempDir = await mkdtemp(tempRoot)
    const tempSkillDir = join(tempDir, params.skillName)

    try {
      // 复制源内容到临时目录
      await this.copyDirectoryContents(sourceDir, tempSkillDir)

      // 原子 rename 到目标位置
      // 如果已存在旧版本，先移除
      try {
        await rename(
          skillTargetDir,
          join(
            targetDir,
            `.tangyuan-trash`,
            `${params.skillName}-${this.now().replace(/:/g, '-')}`,
          ),
        )
      } catch {
        // 目录不存在则忽略
      }

      // 确保 trash 目录存在
      await mkdir(join(targetDir, '.tangyuan-trash'), { recursive: true })

      await rename(tempSkillDir, skillTargetDir)
    } catch (error) {
      // 清理临时目录
      try {
        await rm(tempDir, { recursive: true, force: true })
      } catch {
        // 清理失败忽略
      }
      throw error
    }

    // 更新安装记录
    await this.recordSkillInstall(params)

    // 返回更新后的列表
    if (params.source === 'shared') {
      return this.listSharedSkills()
    }
    return this.listAgentSkills(params.targetAgentId ?? params.agentId)
  }

  /**
   * 删除 Skill（含备份到 trash）。
   *
   * @param params - Skill 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  async deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    const targetDir = this.resolveSkillTargetDir(
      params.source,
      params.targetAgentId,
    )
    const skillDir = join(targetDir, params.skillName)

    // 检查目录是否存在
    try {
      await stat(skillDir)
    } catch {
      throw new Error(`Skill "${params.skillName}" 不存在于 ${targetDir}`)
    }

    // 移动到 trash 目录（保留可恢复信息）
    const trashDir = join(targetDir, '.tangyuan-trash')
    await mkdir(trashDir, { recursive: true })

    const trashName = `${params.skillName}-${this.now().replace(/:/g, '-')}`
    const trashPath = join(trashDir, trashName)

    await rename(skillDir, trashPath)

    // 更新安装记录
    await this.markSkillDeleted(params)

    // 返回更新后的列表
    if (params.source === 'shared') {
      return this.listSharedSkills()
    }
    return this.listAgentSkills(params.targetAgentId ?? params.agentId)
  }

  /**
   * 读取所有 Skill 安装记录（共享 + 各 Agent 专属）。
   *
   * @returns 安装记录列表。
   * @throws 当读取失败时，Promise 会 reject。
   */
  async getSkillInstallRecords(): Promise<SkillInstallRecord[]> {
    const allRecords: SkillInstallRecord[] = []

    // 读取共享 Skill 记录
    allRecords.push(...(await this.readInstallRecords('shared')))

    // 读取所有 Agent 的专属 Skill 记录
    const agentsDir = join(dirname(this.layout.agentHome()))
    try {
      const agentDirs = await readdir(agentsDir)
      for (const agentId of agentDirs) {
        const agentRecords = await this.readInstallRecords('agent', agentId)
        allRecords.push(...agentRecords)
      }
    } catch {
      // agents 目录不存在时忽略
    }

    return allRecords
  }

  /**
   * 将 Pi SDK Skill 和诊断信息映射为汤圆的 SkillSummary 列表。
   *
   * @param skills - Pi SDK 解析出的 Skill 列表（已按 first-wins 排序）。
   * @param diagnostics - Pi SDK 的加载诊断信息（包含冲突）。
   * @returns 带有来源和冲突标注的 SkillSummary 列表。
   * @throws 此方法不会主动抛出错误。
   */
  private mapSkillsToSummaries(
    skills: LoadedSkill[],
    diagnostics: SkillDiagnostic[],
  ): SkillSummary[] {
    const agentSkillsPath = this.layout.agentSkills(TANGYUAN_DEFAULT_AGENT_ID)
    const sharedSkillsPath = this.layout.sharedSkills()

    // 从 diagnostics 中提取冲突信息（按 loserPath 索引）
    const collisionsByLoserPath = new Map<
      string,
      { overriddenPath: string; overriddenSource: 'shared' | 'agent' }
    >()
    for (const diagnostic of diagnostics) {
      if (
        diagnostic.type === 'collision' &&
        diagnostic.collision?.resourceType === 'skill'
      ) {
        const loserSource = diagnostic.collision.loserPath.startsWith(
          agentSkillsPath.replace(TANGYUAN_DEFAULT_AGENT_ID, ''),
        )
          ? 'agent'
          : diagnostic.collision.loserPath.startsWith(sharedSkillsPath)
            ? 'shared'
            : 'agent'
        collisionsByLoserPath.set(diagnostic.collision.loserPath, {
          overriddenPath: diagnostic.collision.winnerPath,
          overriddenSource: loserSource,
        })
      }
    }

    return skills.map((skill) => {
      const source: 'shared' | 'agent' = skill.filePath.startsWith(
        agentSkillsPath.replace(TANGYUAN_DEFAULT_AGENT_ID, ''),
      )
        ? 'agent'
        : skill.filePath.startsWith(sharedSkillsPath)
          ? 'shared'
          : 'agent'

      const conflict = collisionsByLoserPath.get(skill.filePath)

      const summary: SkillSummary = {
        name: skill.name,
        description: skill.description ?? '',
        source,
        path: skill.filePath,
        hasScripts: false, // Pi SDK Skill 类型不直接暴露此信息，MVP 默认 false
      }

      if (conflict) {
        summary.conflict = {
          overriddenPath: conflict.overriddenPath,
          overriddenSource: conflict.overriddenSource,
        }
      }

      return summary
    })
  }

  /**
   * 解析 Skill 安装的目标目录。
   *
   * @param source - 共享或专属。
   * @param agentId - 专属时的 Agent 标识。
   * @returns 目标目录绝对路径。
   * @throws 当 source 为 agent 但未提供 agentId 时抛出错误。
   */
  private resolveSkillTargetDir(
    source: 'shared' | 'agent',
    agentId?: string,
  ): string {
    if (source === 'shared') {
      return this.layout.sharedSkills()
    }

    if (!agentId) {
      throw new Error('专属 Skill 操作需要提供 agentId。')
    }

    return this.layout.agentSkills(agentId)
  }

  /**
   * 校验 Skill 源目录是否包含合法的 SKILL.md。
   *
   * @param dirPath - 源目录路径。
   * @param expectedName - 期望的 Skill 名称。
   * @returns 无返回值。
   * @throws 当 SKILL.md 缺失或缺少 description 时抛出错误。
   */
  private async validateSkillDirectory(
    dirPath: string,
    expectedName: string,
  ): Promise<void> {
    const skillMdPath = join(dirPath, 'SKILL.md')

    try {
      await access(skillMdPath, fsConstants.R_OK)
    } catch {
      throw new Error(`Skill 目录缺少 SKILL.md 文件：${skillMdPath}`)
    }

    const content = await readFile(skillMdPath, 'utf8')

    // 校验 description 字段存在（v3 frontmatter 格式）
    const descriptionMatch = content.match(/^description:\s*(.+)$/m)
    if (!descriptionMatch || !descriptionMatch[1]?.trim()) {
      throw new Error(
        `Skill "${expectedName}" 的 SKILL.md 缺少 description 字段，拒绝安装。`,
      )
    }
  }

  /**
   * 递归复制目录内容。
   *
   * @param sourceDir - 源目录。
   * @param destDir - 目标目录。
   * @returns 无返回值。
   * @throws 当复制失败时，Promise 会 reject。
   */
  private async copyDirectoryContents(
    sourceDir: string,
    destDir: string,
  ): Promise<void> {
    await mkdir(destDir, { recursive: true })

    const entries = await readdir(sourceDir, { withFileTypes: true })

    for (const entry of entries) {
      const srcPath = join(sourceDir, entry.name)
      const destPath = join(destDir, entry.name)

      if (entry.isDirectory()) {
        await this.copyDirectoryContents(srcPath, destPath)
      } else {
        await copyFile(srcPath, destPath)
      }
    }
  }

  /**
   * 读取指定来源的 Skill 安装记录。
   *
   * @param source - 共享或专属。
   * @param agentId - 专属时的 Agent 标识。
   * @returns 安装记录列表。
   * @throws 此方法不会主动抛出错误（读取失败返回空数组）。
   */
  private async readInstallRecords(
    source: 'shared' | 'agent',
    agentId?: string,
  ): Promise<SkillInstallRecord[]> {
    const recordsPath = this.layout.installRecords(source, agentId)

    try {
      const content = await readFile(recordsPath, 'utf8')
      const data = JSON.parse(content)

      if (data && Array.isArray(data.skills)) {
        return data.skills as SkillInstallRecord[]
      }

      return []
    } catch {
      return []
    }
  }

  /**
   * 写入 Skill 安装记录（追加或更新）。
   *
   * @param params - Skill 操作参数。
   * @returns 无返回值。
   * @throws 当写入失败时，Promise 会 reject。
   */
  private async recordSkillInstall(
    params: SkillOperationParams,
  ): Promise<void> {
    const recordsPath = this.layout.installRecords(
      params.source,
      params.targetAgentId,
    )
    const existing = await this.readInstallRecords(
      params.source,
      params.targetAgentId,
    )

    const now = this.now()
    const existingIndex = existing.findIndex(
      (record) => record.skillName === params.skillName,
    )

    const record: SkillInstallRecord = {
      skillName: params.skillName,
      source: params.source,
      ...(params.targetAgentId !== undefined
        ? { targetAgentId: params.targetAgentId }
        : {}),
      installedAt:
        existingIndex >= 0
          ? (existing[existingIndex] as SkillInstallRecord).installedAt
          : now,
      updatedAt: now,
      status: 'active',
    }

    if (existingIndex >= 0) {
      existing[existingIndex] = record
    } else {
      existing.push(record)
    }

    await mkdir(dirname(recordsPath), { recursive: true })
    await writeFile(
      recordsPath,
      JSON.stringify({ skills: existing }, null, 2),
      'utf8',
    )
  }

  /**
   * 标记 Skill 为已删除。
   *
   * @param params - Skill 操作参数。
   * @returns 无返回值。
   * @throws 当写入失败时，Promise 会 reject。
   */
  private async markSkillDeleted(params: SkillOperationParams): Promise<void> {
    const recordsPath = this.layout.installRecords(
      params.source,
      params.targetAgentId,
    )
    const existing = await this.readInstallRecords(
      params.source,
      params.targetAgentId,
    )

    const existingIndex = existing.findIndex(
      (record) => record.skillName === params.skillName,
    )

    if (existingIndex >= 0) {
      const current = existing[existingIndex] as SkillInstallRecord
      existing[existingIndex] = {
        skillName: current.skillName,
        source: current.source,
        ...(current.targetAgentId !== undefined
          ? { targetAgentId: current.targetAgentId }
          : {}),
        installedAt: current.installedAt,
        updatedAt: this.now(),
        status: 'deleted',
      }
    } else {
      existing.push({
        skillName: params.skillName,
        source: params.source,
        ...(params.targetAgentId !== undefined
          ? { targetAgentId: params.targetAgentId }
          : {}),
        installedAt: this.now(),
        updatedAt: this.now(),
        status: 'deleted',
      } as SkillInstallRecord)
    }

    await mkdir(dirname(recordsPath), { recursive: true })
    await writeFile(
      recordsPath,
      JSON.stringify({ skills: existing }, null, 2),
      'utf8',
    )
  }
}
