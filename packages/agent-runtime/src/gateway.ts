import { dirname } from 'node:path'
import type { AgentMessage } from '@tangyuan/contracts'
import {
  type PiSdkCreateSessionRequest,
  type PiSdkGateway,
  type PiSdkListSessionsRequest,
  type PiSdkOpenSessionRequest,
  type PiSdkPromptOptions,
  type PiSdkReadMessagesRequest,
  type PiSdkRuntimeResources,
  type PiSdkSessionHandle,
  type PiSdkStoredSession,
  type PiSdkVerificationRequest,
} from './index'
import {
  describeBashRisk,
  mapPiSdkSessionEntryToAgentMessage,
  normalizePiSdkSessionEvent,
} from './utils'

export class RealPiSdkGateway implements PiSdkGateway {
  /**
   * 读取 Pi SDK ModelRegistry 中的 Provider 和 Model。
   *
   * @returns Provider 和模型描述列表。
   * @throws 当 SDK 模块加载或模型注册表读取失败时，Promise 会 reject。
   */
  async listProvidersAndModels(): Promise<PiSdkRuntimeResources> {
    const { AuthStorage, ModelRegistry } =
      await import('@earendil-works/pi-coding-agent')
    const authStorage = AuthStorage.inMemory()
    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const rawModels = modelRegistry.getAll()
    const modelIndex = new Map<string, (typeof rawModels)[number]>()
    for (const model of rawModels) {
      const key = `${model.provider}:${model.id}`
      if (!modelIndex.has(key)) {
        modelIndex.set(key, model)
      }
    }
    const models = [...modelIndex.values()]
    const providerIds = [
      ...new Set(models.map((model) => model.provider)),
    ].sort()

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

  /**
   * 创建真实 Pi SDK 会话运行器。
   *
   * @param request - 已验证配置、会话标识和 Agent Home 工作目录。
   * @returns 可发送 prompt、取消运行并释放资源的会话运行器。
   * @throws 当 SDK 模块加载、模型查找或会话创建失败时，Promise 会 reject。
   */
  async createSession(
    request: PiSdkCreateSessionRequest,
  ): Promise<PiSdkSessionHandle> {
    return this.createSessionHandleFromRequest(request, 'create')
  }

  /**
   * 打开已有 Pi SDK 会话运行器。
   *
   * @param request - 已验证配置、会话标识、SDK session 文件和 Agent Home 工作目录。
   * @returns 可发送 prompt、取消运行并释放资源的会话运行器。
   * @throws 当 SDK 模块加载、模型查找或会话打开失败时，Promise 会 reject。
   */
  async openSession(
    request: PiSdkOpenSessionRequest,
  ): Promise<PiSdkSessionHandle> {
    return this.createSessionHandleFromRequest(request, 'open')
  }

  /**
   * 从 Pi SDK 原生 session 目录列出可恢复的会话。
   *
   * @param request - Agent Home 工作目录和 SDK session 目录。
   * @returns SDK session 摘要列表。
   * @throws 当 SDK session 目录读取失败时，Promise 会 reject。
   */
  async listSessions(
    request: PiSdkListSessionsRequest,
  ): Promise<PiSdkStoredSession[]> {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const sessions = await SessionManager.list(request.cwd, request.sessionDir)

    return sessions.map((session) => ({
      sessionId: session.id,
      sdkSessionFile: session.path,
      title: (session.name ?? session.firstMessage) || session.id,
      createdAt: session.created.toISOString(),
      updatedAt: session.modified.toISOString(),
    }))
  }

  /**
   * 从 Pi SDK 原生 session 文件读取 transcript 消息。
   *
   * @param request - 会话标识和 SDK session 文件。
   * @returns 转换后的汤圆标准消息列表。
   * @throws 当 SDK session 文件无法打开或读取时，Promise 会 reject。
   */
  async readMessages(
    request: PiSdkReadMessagesRequest,
  ): Promise<AgentMessage[]> {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const sessionManager = SessionManager.open(
      request.sdkSessionFile,
      dirname(request.sdkSessionFile),
    )

    return sessionManager
      .getEntries()
      .flatMap((entry: unknown) =>
        mapPiSdkSessionEntryToAgentMessage(entry, request.sessionId),
      )
  }

  /**
   * 根据请求创建或打开 Pi SDK session，并包装成 Driver 使用的 handle。
   *
   * @param request - 已验证配置、会话标识、SDK session 文件和 Agent Home 工作目录。
   * @param mode - create 表示新建带固定 id 的 session，open 表示打开已有文件。
   * @returns 可发送 prompt、取消运行并释放资源的会话运行器。
   * @throws 当 SDK 模块加载、模型查找或 session 打开失败时，Promise 会 reject。
   */
  private async createSessionHandleFromRequest(
    request: PiSdkCreateSessionRequest | PiSdkOpenSessionRequest,
    mode: 'create' | 'open',
  ): Promise<PiSdkSessionHandle> {
    const {
      AuthStorage,
      ModelRegistry,
      SessionManager,
      createAgentSession,
      DefaultResourceLoader,
    } = await import('@earendil-works/pi-coding-agent')
    const authStorage = AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(request.providerId, request.apiKey)

    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const model = modelRegistry.find(request.providerId, request.modelId)

    if (!model) {
      throw new Error(`找不到模型 ${request.providerId}/${request.modelId}`)
    }

    const sessionManager =
      mode === 'create'
        ? SessionManager.create(request.cwd, dirname(request.sdkSessionFile), {
            id: request.sessionId,
          })
        : SessionManager.open(
            request.sdkSessionFile,
            dirname(request.sdkSessionFile),
            request.cwd,
          )

    // 为当前 Agent session 创建受控 ResourceLoader：
    // - 关闭 Pi 默认 Skill 自动发现（noSkills: true）
    // - 只加载 Agent 专属和共享两层 Skill 目录
    // - Agent 专属目录排第一以实现同名覆盖（Pi first-wins）
    const resourceLoader = new DefaultResourceLoader({
      cwd: request.cwd,
      agentDir: dirname(request.agentSkillsPath), // Agent home 目录
      noSkills: true,
      additionalSkillPaths: [request.agentSkillsPath, request.sharedSkillsPath],
    })
    await resourceLoader.reload()

    const customTools: Array<Record<string, unknown>> = []

    if ('onCreateAgent' in request && request.onCreateAgent) {
      const onCreateAgent = request.onCreateAgent
      customTools.push({
        name: 'create_agent',
        label: '创建 Agent',
        description:
          '创建一个新的 Agent。新 Agent 将继承当前 Provider 和 Model，拥有独立的工作空间和身份文件。调用前必须确认已从用户处收集到 displayName。信息不足时应继续询问用户。',
        promptSnippet: 'create_agent(displayName: string) → 创建新 Agent',
        promptGuidelines: [
          '创建 Agent 前应确认 displayName 已从用户处收集',
          '信息不足时应继续询问用户后再调用此工具',
          '创建完成后告知用户新 Agent 的 ID 和名称',
        ],
        parameters: {
          type: 'object',
          properties: {
            displayName: { type: 'string', minLength: 1 },
          },
          required: ['displayName'],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: { displayName: string }) {
          const result = await onCreateAgent(params.displayName)
          return {
            content: [
              {
                type: 'text',
                text: `已创建 Agent「${result.displayName}」（ID: ${result.agentId}）。用户可以在 Agent 列表中切换到新 Agent 开始对话。`,
              },
            ],
          }
        },
      })
    }

    // 注册带审批和路径保护的自定义工具
    const approvalGateway = request.toolApprovalGateway
    if (approvalGateway) {
      const approvalRunContext = {
        agentId: request.sessionId ? '' : '',
        sessionId: request.sessionId,
        cwd: request.cwd,
      }

      // 自定义 bash 工具（带审批）
      customTools.push({
        name: 'bash',
        label: '运行命令（需审批）',
        description:
          '在当前工作目录中执行 bash 命令。每次执行前需要用户审批。命令将以当前 macOS 用户权限运行。',
        promptSnippet: 'bash(command: string) → 执行 bash 命令',
        promptGuidelines: [
          '执行前会请求用户审批，仅本次有效',
          '命令将以当前 macOS 用户权限执行',
          '如果用户拒绝，命令不会执行',
        ],
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', minLength: 1 },
          },
          required: ['command'],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: { command: string }) {
          const riskDescription = describeBashRisk(params.command)
          const result = await approvalGateway.requestBashApproval({
            agentId: approvalRunContext.agentId || 'tangyuan',
            sessionId: approvalRunContext.sessionId,
            runId: '',
            command: params.command,
            cwd: approvalRunContext.cwd,
            riskDescription,
          })

          if (!result.approved) {
            return {
              content: [
                {
                  type: 'text',
                  text: '用户拒绝了此命令的执行。',
                },
              ],
            }
          }

          // 批准后执行命令
          try {
            const { exec } = await import('node:child_process')
            const { promisify } = await import('node:util')
            const execAsync = promisify(exec)
            const { stdout, stderr } = await execAsync(params.command, {
              cwd: approvalRunContext.cwd,
              timeout: 120_000,
            })
            return {
              content: [
                {
                  type: 'text',
                  text: stdout + (stderr ? `\nstderr:\n${stderr}` : ''),
                },
              ],
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : '命令执行失败'
            return {
              content: [
                {
                  type: 'text',
                  text: `命令执行失败：${message}`,
                },
              ],
            }
          }
        },
      })
    }

    // 使用 excludedToolNames 排除内置工具（当存在审批网关时由自定义工具接管）
    const excludedToolNames: string[] = []
    if (approvalGateway) {
      excludedToolNames.push('bash')
    }

    const { session } = await createAgentSession({
      cwd: request.cwd,
      authStorage,
      modelRegistry,
      model,
      sessionManager,
      resourceLoader,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom tools use simplified execute signatures
      customTools: customTools.length > 0 ? (customTools as any) : undefined,
      ...(excludedToolNames.length > 0
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mapping to Pi SDK's excludeTools option
          { excludedToolNames: excludedToolNames as any }
        : {}),
    })

    return {
      sdkSessionFile: sessionManager.getSessionFile() ?? request.sdkSessionFile,
      prompt: async (prompt: string, options?: PiSdkPromptOptions) => {
        const unsubscribe = session.subscribe((event: unknown) => {
          for (const streamEvent of normalizePiSdkSessionEvent(event)) {
            options?.onEvent?.(streamEvent)
          }
        })

        try {
          await session.prompt(prompt)
          return session.getLastAssistantText() ?? null
        } finally {
          unsubscribe()
        }
      },
      abort: async () => {
        await session.abort()
      },
      dispose: () => {
        session.dispose()
      },
      setModel: async (
        providerId: string,
        modelId: string,
        apiKey?: string,
      ) => {
        if (apiKey) {
          authStorage.setRuntimeApiKey(providerId, apiKey)
        }

        const newModel = modelRegistry.find(providerId, modelId)

        if (!newModel) {
          throw new Error(`找不到模型 ${providerId}/${modelId}`)
        }

        await session.setModel(newModel)
      },
      setThinkingLevel: async (level: string) => {
        // ThinkingLevel 类型来自 @earendil-works/pi-agent-core:
        // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
        session.setThinkingLevel(
          level as 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
        )
      },
      getModelInfo: async () => {
        const currentModel = session.model
        const thinkingLevel = session.thinkingLevel
        const supportsThinking = session.supportsThinking()
        const supportedThinkingLevels = supportsThinking
          ? session.getAvailableThinkingLevels()
          : []

        return {
          providerId: currentModel?.provider ?? '',
          modelId: currentModel?.id ?? '',
          displayName: currentModel?.name ?? currentModel?.id ?? '',
          thinkingLevel: supportsThinking ? thinkingLevel : null,
          supportedThinkingLevels,
          supportsThinking,
        }
      },
      reload: async () => {
        await resourceLoader.reload()
        // session.reload() 重建系统提示词，使 Skill 变更立即生效
        if (
          typeof (session as { reload?: () => Promise<void> }).reload ===
          'function'
        ) {
          await (session as { reload: () => Promise<void> }).reload()
        }
      },
    }
  }
}

/**
 * 将 Pi SDK session entry 转成汤圆标准消息。
 *
 * @param entry - Pi SDK SessionManager 返回的未知 entry。
 * @param sessionId - 当前汤圆会话标识。
 * @returns 可展示消息；不是 message entry 时返回空数组。
 * @throws 此方法不会主动抛出错误。
 */
