import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  createAgentProfileStatus,
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  type AgentId,
  type AgentMessage,
  type AgentRunState,
  type AgentSessionSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type ListSessionsRequest,
  type ModelDescriptor,
  type ProviderDescriptor,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
} from '@tangyuan/shared'

export {
  TANGYUAN_DEFAULT_AGENT_ID,
  createAgentProfileStatus,
  createDefaultSessionSummary,
  type AgentId,
  type AgentMessage,
  type AgentRunState,
  type AgentSessionSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CreateSessionRequest,
  type GetSessionMessagesRequest,
  type ListSessionsRequest,
  type ModelDescriptor,
  type ProviderDescriptor,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
} from '@tangyuan/shared'

/**
 * 描述 Pi SDK 临时配置验证时使用的固定 prompt。
 */
const CONFIGURATION_VERIFICATION_PROMPT = 'Reply with OK.'

/**
 * 描述持久化在 Electron userData 下的运行时配置。
 */
export type PersistedRuntimeConfiguration = RuntimeConfiguration

/**
 * 描述 Pi SDK 验证配置时需要的参数。
 */
export interface PiSdkVerificationRequest extends RuntimeConfiguration {
  prompt: string
  signal: AbortSignal
}

/**
 * 描述从 Pi SDK ModelRegistry 读取到的资源列表。
 */
export interface PiSdkRuntimeResources {
  providers: ProviderDescriptor[]
  models: ModelDescriptor[]
}

/**
 * 描述 Pi SDK 操作的窄网关，方便产品代码真实调用 SDK，测试代码替换外部网络。
 */
export interface PiSdkGateway {
  /**
   * 读取 SDK ModelRegistry 中可展示的 Provider 和 Model。
   *
   * @returns Provider 和模型描述列表。
   * @throws 当 SDK 资源读取失败时，Promise 会 reject。
   */
  listProvidersAndModels(): Promise<PiSdkRuntimeResources>

  /**
   * 使用临时 session 验证 Provider/API Key/Model。
   *
   * @param request - 验证所需配置、固定 prompt 和取消信号。
   * @returns 无返回值；成功 resolve 表示验证通过。
   * @throws 当 SDK 调用失败、模型不可用或用户取消时，Promise 会 reject。
   */
  verifyConfiguration(request: PiSdkVerificationRequest): Promise<void>
}

/**
 * 描述 Agent Runtime 统一错误码。
 */
export type AgentRuntimeErrorCode =
  | 'configuration-missing'
  | 'driver-unavailable'
  | 'provider-verification-failed'
  | 'session-not-found'
  | 'run-cancelled'
  | 'unknown'

/**
 * 描述可以安全传给 Renderer 的 Agent Runtime 错误。
 */
export interface AgentRuntimeErrorPayload {
  code: AgentRuntimeErrorCode
  message: string
  recoverable: boolean
}

/**
 * 创建 AgentRuntimeError 时使用的输入。
 */
export interface AgentRuntimeErrorInput extends AgentRuntimeErrorPayload {
  cause?: unknown
}

/**
 * 描述 Agent 运行过程中发给 DesktopAppStore 的标准事件。
 */
export type AgentEvent =
  | {
      type: 'session-created'
      agentId: AgentId
      session: AgentSessionSummary
      occurredAt: string
    }
  | {
      type: 'message-appended'
      agentId: AgentId
      message: AgentMessage
      occurredAt: string
    }
  | {
      type: 'run-state-changed'
      agentId: AgentId
      sessionId: string
      state: AgentRunState
      occurredAt: string
    }
  | {
      type: 'profile-updated'
      agentId: AgentId
      target: 'soul' | 'user'
      updatedAt: string
      occurredAt: string
    }
  | {
      type: 'runtime-error'
      agentId: AgentId
      error: AgentRuntimeErrorPayload
      occurredAt: string
    }

/**
 * 处理 Agent 标准事件的回调方法。
 */
export type AgentEventListener = (event: AgentEvent) => void

/**
 * 描述事件订阅句柄。
 */
export interface AgentEventSubscription {
  /**
   * 取消事件订阅。
   *
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  unsubscribe(): void
}

/**
 * 定义 Agent 会话 Driver 需要实现的能力。
 */
export interface AgentSessionDriver {
  /**
   * 读取指定 Agent 的会话摘要列表。
   *
   * @param request - 会话列表过滤条件。
   * @returns 会话摘要列表。
   * @throws 当底层 SDK 或持久化层读取失败时，Promise 会 reject。
   */
  listSessions(request: ListSessionsRequest): Promise<AgentSessionSummary[]>

  /**
   * 创建一个新的 Agent 会话。
   *
   * @param request - 新会话所属 Agent 和标题。
   * @returns 创建后的会话摘要。
   * @throws 当底层 SDK 或持久化层无法创建会话时，Promise 会 reject。
   */
  createSession(request: CreateSessionRequest): Promise<AgentSessionSummary>

  /**
   * 读取指定会话的消息列表。
   *
   * @param request - 会话定位信息。
   * @returns 会话消息列表。
   * @throws 当会话不存在或消息读取失败时，Promise 会 reject。
   */
  getMessages(request: GetSessionMessagesRequest): Promise<AgentMessage[]>

  /**
   * 向指定会话发送用户消息并启动 Agent 运行。
   *
   * @param request - 会话定位信息和用户消息内容。
   * @returns 无返回值，运行进度通过 AgentEvent 推送。
   * @throws 当配置缺失、会话不存在或 SDK 调用失败时，Promise 会 reject。
   */
  sendMessage(request: SendMessageRequest): Promise<void>

  /**
   * 取消指定会话正在运行的 Agent 响应。
   *
   * @param request - 需要取消运行的会话定位信息。
   * @returns 无返回值，取消结果通过 AgentEvent 推送。
   * @throws 当会话不存在或 SDK 无法取消运行时，Promise 会 reject。
   */
  cancelRun(request: CancelRunRequest): Promise<void>

  /**
   * 订阅 Agent Driver 发出的标准事件。
   *
   * @param listener - 接收标准事件的回调。
   * @returns 可取消订阅的句柄。
   * @throws 此方法不会主动抛出错误。
   */
  subscribe(listener: AgentEventListener): AgentEventSubscription
}

/**
 * 定义运行时资源 Driver 需要实现的能力。
 */
export interface RuntimeResourceDriver {
  /**
   * 读取当前运行时资源快照。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 当配置或资源状态无法读取时，Promise 会 reject。
   */
  getSnapshot(): Promise<RuntimeSnapshot>

  /**
   * 刷新 Provider、模型和认证状态。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当底层 Provider 资源刷新失败时，Promise 会 reject。
   */
  refresh(): Promise<RuntimeSnapshot>

  /**
   * 保存并验证运行时配置。
   *
   * @param configuration - Provider、模型和 API Key。
   * @returns 保存后的 RuntimeSnapshot。
   * @throws 当真实 SDK 验证失败或配置无法保存时，Promise 会 reject。
   */
  saveConfiguration?(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot>

  /**
   * 取消正在进行的配置验证。
   *
   * @param request - 需要取消的验证标识；v1 只维护一个当前验证。
   * @returns 取消后的 RuntimeSnapshot。
   * @throws 当底层 SDK 或运行时无法取消验证时，Promise 会 reject。
   */
  cancelConfigurationVerification?(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot>
}

/**
 * Agent Runtime 统一错误类型。
 */
export class AgentRuntimeError extends Error {
  readonly code: AgentRuntimeErrorCode
  readonly recoverable: boolean

  /**
   * 创建一个可安全序列化的 Runtime 错误。
   *
   * @param input - 错误码、展示消息、可恢复状态和可选原始原因。
   * @returns AgentRuntimeError 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(input: AgentRuntimeErrorInput) {
    super(input.message)
    this.name = 'AgentRuntimeError'
    this.code = input.code
    this.recoverable = input.recoverable
  }

  /**
   * 转换为可传给 Renderer 的安全 JSON。
   *
   * @returns 不包含 cause 和敏感信息的错误载荷。
   * @throws 此方法不会主动抛出错误。
   */
  toJSON(): AgentRuntimeErrorPayload {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
    }
  }
}

/**
 * 创建 PiSdkDriver 时可注入的依赖。
 */
export interface PiSdkDriverOptions {
  now?: () => string
  agentHomePath?: string
  fsRoot?: string
  userDataPath?: string
  gateway?: PiSdkGateway
}

/**
 * Pi Agent SDK 的 v1 适配器骨架。
 */
export class PiSdkDriver implements AgentSessionDriver, RuntimeResourceDriver {
  private readonly now: () => string
  private readonly agentHomePath: string
  private readonly fsRoot: string
  private readonly userDataPath: string
  private readonly gateway: PiSdkGateway
  private readonly listeners = new Set<AgentEventListener>()
  private readonly sessions = new Map<string, AgentSessionSummary>()
  private configurationVerificationController: AbortController | null = null

  /**
   * 创建 Pi SDK Driver 骨架。
   *
   * @param options - 时间函数、默认 Agent Home 路径和文件系统根目录等可替换依赖。
   * @returns PiSdkDriver 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(options: PiSdkDriverOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.agentHomePath = options.agentHomePath ?? '~/.tangyuan/agents/tangyuan'
    this.fsRoot = options.fsRoot ?? homedir()
    this.userDataPath = options.userDataPath ?? join(this.fsRoot, '.tangyuan')
    this.gateway = options.gateway ?? new RealPiSdkGateway()
  }

  /**
   * 读取当前运行时资源快照。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 当默认 Agent Home 初始化失败时，Promise 会 reject。
   */
  async getSnapshot(): Promise<RuntimeSnapshot> {
    return this.readRuntimeSnapshot()
  }

  /**
   * 刷新运行时资源。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当默认 Agent Home 初始化失败时，Promise 会 reject。
   */
  async refresh(): Promise<RuntimeSnapshot> {
    return this.readRuntimeSnapshot()
  }

  /**
   * 使用真实 Pi SDK 验证 Provider/API Key/Model 后保存配置。
   *
   * @param configuration - 用户输入的模型服务、模型和接口密钥。
   * @returns 保存后的 RuntimeSnapshot，API Key 只包含脱敏展示值。
   * @throws 当配置缺失、SDK 验证失败或写入失败时，Promise 会 reject。
   */
  async saveConfiguration(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot> {
    const normalizedConfiguration = this.normalizeRuntimeConfiguration(configuration)
    const controller = new AbortController()
    this.configurationVerificationController = controller

    try {
      await this.gateway.verifyConfiguration({
        ...normalizedConfiguration,
        prompt: CONFIGURATION_VERIFICATION_PROMPT,
        signal: controller.signal,
      })
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        throw new AgentRuntimeError({
          code: 'run-cancelled',
          message: '已取消配置验证。',
          recoverable: true,
        })
      }

      throw new AgentRuntimeError({
        code: 'provider-verification-failed',
        message: `配置验证失败：${sanitizeErrorMessage(error, normalizedConfiguration.apiKey)}`,
        recoverable: true,
      })
    } finally {
      if (this.configurationVerificationController === controller) {
        this.configurationVerificationController = null
      }
    }

    await this.writePersistedConfiguration(normalizedConfiguration)
    return this.readRuntimeSnapshot()
  }

  /**
   * 取消当前配置验证。
   *
   * @param request - 取消请求；v1 只维护一个当前验证，verificationId 用于日志和未来扩展。
   * @returns 当前 RuntimeSnapshot。
   * @throws 当快照读取失败时，Promise 会 reject。
   */
  async cancelConfigurationVerification(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot> {
    void request
    this.configurationVerificationController?.abort()
    this.configurationVerificationController = null

    return this.readRuntimeSnapshot()
  }

  /**
   * 读取指定 Agent 的会话摘要列表。
   *
   * @param request - 会话列表过滤条件。
   * @returns 该 Agent 下的会话摘要列表。
   * @throws 此骨架实现不会主动抛出错误。
   */
  async listSessions(
    request: ListSessionsRequest,
  ): Promise<AgentSessionSummary[]> {
    return [...this.sessions.values()].filter(
      (session) => session.agentId === request.agentId,
    )
  }

  /**
   * 创建一个新的本地会话摘要。
   *
   * @param request - 新会话所属 Agent 和标题。
   * @returns 创建后的会话摘要。
   * @throws 当 request.agentId 不是默认 Agent 时，Promise 会 reject。
   */
  async createSession(
    request: CreateSessionRequest,
  ): Promise<AgentSessionSummary> {
    if (request.agentId !== TANGYUAN_DEFAULT_AGENT_ID) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: 'v1 只支持默认 tangyuan Agent（智能体）。',
        recoverable: true,
      })
    }

    const session = createDefaultSessionSummary({
      sessionId: `session-${this.sessions.size + 1}`,
      title: request.title,
      updatedAt: this.now(),
    })

    this.sessions.set(session.sessionId, session)
    this.emit({
      type: 'session-created',
      agentId: request.agentId,
      session,
      occurredAt: this.now(),
    })

    return session
  }

  /**
   * 读取指定会话的消息列表。
   *
   * @param request - 会话定位信息。
   * @returns 当前骨架实现返回空消息列表。
   * @throws 当会话不存在时，Promise 会 reject。
   */
  async getMessages(
    request: GetSessionMessagesRequest,
  ): Promise<AgentMessage[]> {
    this.assertKnownSession(request.sessionId)
    return []
  }

  /**
   * 向指定会话发送用户消息并启动 Agent 运行。
   *
   * @param request - 会话定位信息和消息内容。
   * @returns 无返回值。
   * @throws 当前骨架实现始终以 `configuration-missing` reject。
   */
  async sendMessage(request: SendMessageRequest): Promise<void> {
    this.assertKnownSession(request.sessionId)

    throw new AgentRuntimeError({
      code: 'configuration-missing',
      message:
        '发送消息前，请先配置 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。',
      recoverable: true,
    })
  }

  /**
   * 取消指定会话正在运行的响应。
   *
   * @param request - 需要取消运行的会话定位信息。
   * @returns 无返回值。
   * @throws 当会话不存在时，Promise 会 reject。
   */
  async cancelRun(request: CancelRunRequest): Promise<void> {
    this.assertKnownSession(request.sessionId)
    this.emit({
      type: 'run-state-changed',
      agentId: request.agentId,
      sessionId: request.sessionId,
      state: 'cancelled',
      occurredAt: this.now(),
    })
  }

  /**
   * 订阅标准 Agent 事件。
   *
   * @param listener - 接收标准事件的回调。
   * @returns 可取消订阅的句柄。
   * @throws 此方法不会主动抛出错误。
   */
  subscribe(listener: AgentEventListener): AgentEventSubscription {
    this.listeners.add(listener)

    return {
      unsubscribe: () => {
        this.listeners.delete(listener)
      },
    }
  }

  /**
   * 读取并初始化默认 Agent Home 的运行时快照。
   *
   * @returns 包含默认 Agent、profile 状态和配置状态的快照。
   * @throws 当文件系统访问失败时，Promise 会 reject。
   */
  private async readRuntimeSnapshot(): Promise<RuntimeSnapshot> {
    const homeStatus = await this.ensureDefaultAgentHome()
    const [configuration, resources] = await Promise.all([
      this.readPersistedConfiguration(),
      this.gateway.listProvidersAndModels(),
    ])

    return createRuntimeSnapshot({
      activeAgent: {
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        displayName: '汤圆',
        homePath: this.agentHomePath,
        profile: createAgentProfileStatus(homeStatus),
      },
      providers: resources.providers,
      models: resources.models,
      settings: {
        selectedProviderId: configuration?.providerId ?? null,
        selectedModelId: configuration?.modelId ?? null,
      },
      auth: {
        apiKey: {
          configured: Boolean(configuration?.apiKey),
          maskedValue: configuration?.apiKey
            ? PiSdkDriver.maskApiKey(configuration.apiKey)
            : null,
        },
      },
    })
  }

  /**
   * 生成适合界面展示的 API Key 脱敏值。
   *
   * @param apiKey - 原始 API Key。
   * @returns 不暴露完整密钥的字符串。
   * @throws 此方法不会主动抛出错误。
   */
  static maskApiKey(apiKey: string): string {
    const trimmed = apiKey.trim()

    if (trimmed.length <= 8) {
      return '•'.repeat(trimmed.length)
    }

    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
  }

  /**
   * 校验并清理用户输入的运行时配置。
   *
   * @param configuration - 用户输入的配置。
   * @returns 去除首尾空白后的 RuntimeConfiguration。
   * @throws 当 Provider、Model 或 API Key 为空时抛出 AgentRuntimeError。
   */
  private normalizeRuntimeConfiguration(
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
        message: '请填写 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。',
        recoverable: true,
      })
    }

    return normalizedConfiguration
  }

  /**
   * 从 Electron userData 下读取配置 JSON。
   *
   * @returns 已保存的运行时配置；不存在时返回 null。
   * @throws 当 JSON 无法读取或格式错误时，Promise 会 reject。
   */
  private async readPersistedConfiguration(): Promise<PersistedRuntimeConfiguration | null> {
    const configPath = this.resolveConfigPath()

    try {
      const rawConfig = await readFile(configPath, 'utf8')
      const parsedConfig = JSON.parse(rawConfig) as Partial<PersistedRuntimeConfiguration>

      if (
        typeof parsedConfig.providerId !== 'string' ||
        typeof parsedConfig.modelId !== 'string' ||
        typeof parsedConfig.apiKey !== 'string'
      ) {
        return null
      }

      return {
        providerId: parsedConfig.providerId,
        modelId: parsedConfig.modelId,
        apiKey: parsedConfig.apiKey,
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null
      }

      throw error
    }
  }

  /**
   * 写入 Electron userData 下的配置 JSON。
   *
   * @param configuration - 已通过真实 SDK 验证的运行时配置。
   * @returns 无返回值。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  private async writePersistedConfiguration(
    configuration: PersistedRuntimeConfiguration,
  ): Promise<void> {
    const configPath = this.resolveConfigPath()
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(`${configPath}.tmp`, `${JSON.stringify(configuration, null, 2)}\n`, 'utf8')
    await import('node:fs/promises').then(({ rename }) =>
      rename(`${configPath}.tmp`, configPath),
    )
  }

  /**
   * 解析配置 JSON 的绝对路径。
   *
   * @returns Electron userData 下的 config.json 路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveConfigPath(): string {
    return join(this.userDataPath, 'config.json')
  }

  /**
   * 确保默认 Agent Home 及 bootstrap 相关文件存在。
   *
   * @returns 默认 Agent Home 的文件状态。
   * @throws 当文件系统创建、读取或写入失败时，Promise 会 reject。
   */
  private async ensureDefaultAgentHome() {
    const absoluteHomePath = this.resolveAgentHomePath()
    const bootstrapPath = join(absoluteHomePath, 'bootstrap.md')
    const soulPath = join(absoluteHomePath, 'soul.md')
    const userPath = join(absoluteHomePath, 'user.md')
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

    const [bootstrapFileExists, soulFileExists, userFileExists] = await Promise.all([
      this.pathExists(bootstrapPath),
      this.pathExists(soulPath),
      this.pathExists(userPath),
    ])

    if (!bootstrapFileExists && !soulFileExists && !userFileExists) {
      await writeFile(bootstrapPath, this.createBootstrapTemplate(), 'utf8')
    }

    return {
      initialized: soulFileExists && userFileExists,
      bootstrapRequired: !soulFileExists && (await this.pathExists(bootstrapPath)),
      bootstrapFileExists: await this.pathExists(bootstrapPath),
      soulFileExists: await this.pathExists(soulPath),
      userFileExists: await this.pathExists(userPath),
      soulUpdatedAt: await this.getMtimeIso(soulPath),
      userUpdatedAt: await this.getMtimeIso(userPath),
    }
  }

  /**
   * 把用户家目录下的相对默认 Agent Home 转成绝对路径。
   *
   * @returns 默认 Agent Home 的绝对路径。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveAgentHomePath(): string {
    return this.agentHomePath.startsWith('~')
      ? join(this.fsRoot, this.agentHomePath.slice(2))
      : this.agentHomePath
  }

  /**
   * 判断给定路径是否存在。
   *
   * @param path - 需要检查的文件或目录路径。
   * @returns 路径存在则返回 true，不存在则返回 false。
   * @throws 当底层文件系统返回除“找不到”以外的错误时，Promise 会 reject。
   */
  private async pathExists(path: string): Promise<boolean> {
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
   * 读取文件最后修改时间。
   *
   * @param path - 需要读取更新时间的文件路径。
   * @returns 以 ISO 字符串表示的修改时间；文件不存在时返回 null。
   * @throws 当底层文件系统读取失败时，Promise 会 reject。
   */
  private async getMtimeIso(path: string): Promise<string | null> {
    try {
      const fileStat = await stat(path)
      return fileStat.mtime.toISOString()
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null
      }

      throw error
    }
  }

  /**
   * 生成固定的 bootstrap 问题模板。
   *
   * @returns 可写入 bootstrap.md 的 Markdown 内容。
   * @throws 此方法不会主动抛出错误。
   */
  private createBootstrapTemplate(): string {
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

  /**
   * 确认会话已存在。
   *
   * @param sessionId - 需要确认的会话标识。
   * @returns 无返回值。
   * @throws 当会话不存在时抛出 AgentRuntimeError。
   */
  private assertKnownSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${sessionId}。`,
        recoverable: true,
      })
    }
  }

  /**
   * 向当前订阅者广播标准事件。
   *
   * @param event - 需要广播的标准 Agent 事件。
   * @returns 无返回值。
   * @throws 订阅者回调抛出的错误会透传给调用方。
   */
  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

/**
 * 生产环境使用的 Pi SDK 网关。
 */
class RealPiSdkGateway implements PiSdkGateway {
  /**
   * 读取 Pi SDK ModelRegistry 中的 Provider 和 Model。
   *
   * @returns Provider 和模型描述列表。
   * @throws 当 SDK 模块加载或模型注册表读取失败时，Promise 会 reject。
   */
  async listProvidersAndModels(): Promise<PiSdkRuntimeResources> {
    const { AuthStorage, ModelRegistry } = await import(
      '@earendil-works/pi-coding-agent'
    )
    const authStorage = AuthStorage.inMemory()
    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const models = modelRegistry.getAll()
    const providerIds = [...new Set(models.map((model) => model.provider))].sort()

    return {
      providers: providerIds.map((providerId) => ({
        providerId,
        displayName: modelRegistry.getProviderDisplayName(providerId),
      })),
      models: models.map((model) => ({
        providerId: model.provider,
        modelId: model.id,
        displayName: model.name ?? model.id,
      })),
    }
  }

  /**
   * 使用 Pi SDK 临时 session 验证运行时配置。
   *
   * @param request - Provider、Model、API Key、固定 prompt 和取消信号。
   * @returns 无返回值。
   * @throws 当 SDK 调用失败、模型不存在或取消信号触发时，Promise 会 reject。
   */
  async verifyConfiguration(request: PiSdkVerificationRequest): Promise<void> {
    const { AuthStorage, ModelRegistry, SessionManager, createAgentSession } =
      await import('@earendil-works/pi-coding-agent')
    const authStorage = AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(request.providerId, request.apiKey)

    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const model = modelRegistry.find(request.providerId, request.modelId)

    if (!model) {
      throw new Error(`找不到模型 ${request.providerId}/${request.modelId}`)
    }

    const { session } = await createAgentSession({
      authStorage,
      modelRegistry,
      model,
      sessionManager: SessionManager.inMemory(),
      noTools: 'all',
    })

    const abortSession = (): void => {
      void session.abort()
    }

    request.signal.addEventListener('abort', abortSession, { once: true })

    try {
      if (request.signal.aborted) {
        await session.abort()
        throw new DOMException('Aborted', 'AbortError')
      }

      await session.prompt(request.prompt)
    } finally {
      request.signal.removeEventListener('abort', abortSession)
      session.dispose()
    }
  }
}

/**
 * 判断错误是否来自 AbortController 取消。
 *
 * @param error - 捕获到的未知错误。
 * @returns 如果是取消错误则返回 true。
 * @throws 此方法不会主动抛出错误。
 */
function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (error instanceof Error && error.name === 'AbortError')
}

/**
 * 把错误消息转换成不含 API Key 的用户可读文案。
 *
 * @param error - 捕获到的未知错误。
 * @param apiKey - 需要从消息中移除的原始 API Key。
 * @returns 脱敏后的错误消息。
 * @throws 此方法不会主动抛出错误。
 */
function sanitizeErrorMessage(error: unknown, apiKey: string): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '请检查 Provider、Model 和 API Key 后重试。'
  const redactedMessage = rawMessage.split(apiKey).join('[API Key 已隐藏]')

  return redactedMessage || '请检查 Provider、Model 和 API Key 后重试。'
}
