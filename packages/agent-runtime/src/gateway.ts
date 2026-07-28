import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ForkSource, TranscriptSnapshot } from '@tangyuan/contracts'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import {
  type PiSdkBranchedSession,
  type PiSdkCreateBranchedSessionRequest,
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
} from './pi-sdk-driver-contracts'
import {
  buildTranscriptSnapshotFromSdkEntries,
  isForkSource,
  normalizePiSdkSessionEvent,
} from './utils'

/** 汤圆写入分叉会话 Pi JSONL 的来源记录 custom entry 类型。 */
const TANGYUAN_FORK_SOURCE_ENTRY_TYPE = 'tangyuan:fork-source'
import {
  createUpdateSoulTool,
  createUpdateUserProfileTool,
} from './profile-tools'
import {
  createProtectedTools,
  NATIVE_DANGEROUS_TOOL_NAMES,
  toSdkCustomTools,
} from './protected-tools'

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
    const {
      AuthStorage,
      ModelRegistry,
      SessionManager,
      SettingsManager,
      createAgentSession,
    } = await import('@earendil-works/pi-coding-agent')
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
      settingsManager: SettingsManager.inMemory(),
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

    return sessions.map((session) => {
      const forkedFrom = this.readForkSource(
        SessionManager,
        session.path,
        request.sessionDir,
      )

      return {
        sessionId: session.id,
        sdkSessionFile: session.path,
        title: (session.name ?? session.firstMessage) || session.id,
        createdAt: session.created.toISOString(),
        updatedAt: session.modified.toISOString(),
        ...(forkedFrom ? { forkedFrom } : {}),
      }
    })
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
  ): Promise<TranscriptSnapshot> {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const sessionManager = SessionManager.open(
      request.sdkSessionFile,
      dirname(request.sdkSessionFile),
    )

    const entries = sessionManager.getEntries()
    return buildTranscriptSnapshotFromSdkEntries(
      entries,
      request.sessionId,
      'tangyuan',
    )
  }

  /**
   * 从 Pi SDK 原生 session 文件提取独立分叉会话。
   *
   * 分叉源是用户消息时，新会话只复制该消息之前的路径；源消息文本留给
   * Renderer 作为可编辑草稿，因此不会进入新会话的 Pi 历史。
   *
   * @param request - 来源 session 文件和分叉源用户消息标识。
   * @returns 新 JSONL 文件及其 Pi session ID。
   * @throws 当来源会话无可读历史、来源消息不是用户消息或分叉失败时，Promise 会 reject。
   */
  async createBranchedSession(
    request: PiSdkCreateBranchedSessionRequest,
  ): Promise<PiSdkBranchedSession> {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const sourceSession = SessionManager.open(
      request.sdkSessionFile,
      dirname(request.sdkSessionFile),
    )
    const sourceEntry = sourceSession.getEntry(request.entryId)

    // Pi 会话在首条 assistant 回复前不落盘，此时父文件读不到任何 entry。
    if (sourceSession.getEntries().length === 0) {
      throw new Error('来源会话尚无可读取的历史记录，无法分叉。')
    }

    if (
      !sourceEntry ||
      sourceEntry.type !== 'message' ||
      sourceEntry.message.role !== 'user'
    ) {
      throw new Error('分叉源必须是历史用户消息。')
    }

    const parentSessionId = sourceSession.getSessionId()
    let forkedSessionFile: string | undefined

    if (sourceEntry.parentId) {
      forkedSessionFile = sourceSession.createBranchedSession(
        sourceEntry.parentId,
      )

      if (forkedSessionFile) {
        // Pi SDK 只在保留路径含 assistant 回复时才立刻落盘分叉文件，且会原样带上从
        // 父路径继承来的旧来源记录。统一重写一次：既补齐缺失的文件（否则重新 open 会
        // 退化成另建会话，丢掉 sessionId、cwd 与继承历史），也确保只保留自己的直接来源。
        await this.writeForkedSessionFile(sourceSession, forkedSessionFile)
      }
    } else {
      forkedSessionFile = await this.createEmptyForkedSessionFile(
        SessionManager,
        sourceSession.getCwd(),
        sourceSession.getSessionDir(),
        request.sdkSessionFile,
      )
    }

    if (!forkedSessionFile) {
      throw new Error('无法创建分叉会话文件。')
    }

    const forkedSession = SessionManager.open(
      forkedSessionFile,
      dirname(forkedSessionFile),
    )
    forkedSession.appendCustomEntry(TANGYUAN_FORK_SOURCE_ENTRY_TYPE, {
      sessionId: parentSessionId,
      entryId: request.entryId,
    })

    return {
      sessionId: forkedSession.getSessionId(),
      sdkSessionFile: forkedSessionFile,
    }
  }

  /**
   * 把分叉后的会话状态写成分叉 Pi JSONL。
   *
   * Pi SDK 的 createBranchedSession 会把内存里的会话切换成分叉后的新会话，但只在
   * 保留路径里已有 assistant 回复时才写文件。这里用切换后的内存状态统一写一次，
   * 并剔除从父路径继承来的旧来源记录，让每个分叉文件只保留自己的直接来源。
   *
   * @param branchedSession - 已切换为分叉会话的 Pi SDK 会话管理器。
   * @param forkedSessionFile - 分叉会话 JSONL 文件路径。
   * @returns 无返回值。
   * @throws 当缺少 session header 或写文件失败时抛出错误。
   */
  private async writeForkedSessionFile(
    branchedSession: import('@earendil-works/pi-coding-agent').SessionManager,
    forkedSessionFile: string,
  ): Promise<void> {
    const header = branchedSession.getHeader()

    if (!header) {
      throw new Error('分叉会话缺少 session header，无法落盘。')
    }

    // 剔除继承来的来源记录后重连 parentId，避免删除条目导致后续条目断链。
    const entries: unknown[] = []
    let parentId: string | null = null

    for (const entry of branchedSession.getEntries()) {
      if (
        entry.type === 'custom' &&
        entry.customType === TANGYUAN_FORK_SOURCE_ENTRY_TYPE
      ) {
        continue
      }

      entries.push({ ...entry, parentId })
      parentId = entry.id
    }

    const lines = [header, ...entries]
      .map((entry) => `${JSON.stringify(entry)}\n`)
      .join('')
    await writeFile(forkedSessionFile, lines, 'utf8')
  }

  /**
   * 创建仅包含 session header 的持久化 Pi 会话文件。
   *
   * @param SessionManager - Pi SDK 会话管理器构造对象。
   * @param cwd - 新会话所属工作目录。
   * @param sessionDir - Pi JSONL 目录。
   * @param parentSession - 父会话 JSONL 文件路径。
   * @returns 新会话 JSONL 文件路径。
   * @throws 当 Pi SDK 未生成文件路径时抛出错误。
   */
  private async createEmptyForkedSessionFile(
    SessionManager: typeof import('@earendil-works/pi-coding-agent').SessionManager,
    cwd: string,
    sessionDir: string,
    parentSession: string,
  ): Promise<string> {
    const session = SessionManager.create(cwd, sessionDir)
    const sessionFile = session.newSession({ parentSession })
    const header = session.getHeader()

    if (!sessionFile || !header) {
      throw new Error('无法创建空分叉会话文件。')
    }

    await writeFile(sessionFile, `${JSON.stringify(header)}\n`, 'utf8')
    return sessionFile
  }

  /**
   * 从 Pi session 的汤圆 custom entry 中读取分叉来源。
   *
   * @param sessionFile - Pi JSONL 文件路径。
   * @param sessionDir - Pi session 目录。
   * @returns 合法来源记录；无记录或无法读取时返回 undefined。
   */
  private readForkSource(
    SessionManager: typeof import('@earendil-works/pi-coding-agent').SessionManager,
    sessionFile: string,
    sessionDir: string,
  ): ForkSource | undefined {
    try {
      const session = SessionManager.open(sessionFile, sessionDir)
      const entry = [...session.getEntries()]
        .reverse()
        .find(
          (candidate) =>
            candidate.type === 'custom' &&
            candidate.customType === TANGYUAN_FORK_SOURCE_ENTRY_TYPE,
        )
      const data = entry?.type === 'custom' ? entry.data : undefined

      if (isForkSource(data)) {
        return data
      }
    } catch {
      // 单个 session 文件损坏不阻断其他会话索引重建。
    }

    return undefined
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
      SettingsManager,
      createAgentSession,
      createReadToolDefinition,
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

    // 身份上下文片段（soul/user 或 bootstrap）。appendSystemPromptOverride
    // 是同步签名，无法在其中读文件；因此由 runtime 先异步算好、
    // 通过 setSystemPromptContext 存入此闭包，reload 时同步取值追加。
    let systemPromptContext = ''

    // 为当前 Agent session 创建受控 ResourceLoader：
    // - 关闭 Pi 默认 Skill 自动发现（noSkills: true）
    // - 只加载 Agent 专属和共享两层 Skill 目录
    // - Agent 专属目录排第一以实现同名覆盖（Pi first-wins）
    const resourceLoader = new DefaultResourceLoader({
      cwd: request.cwd,
      agentDir: dirname(request.agentSkillsPath), // Agent home 目录
      noSkills: true,
      additionalSkillPaths: [request.agentSkillsPath, request.sharedSkillsPath],
      // 追加式注入身份上下文，不覆盖 Pi 内置系统提示词。
      appendSystemPromptOverride: (base: string[]) =>
        systemPromptContext ? [...base, systemPromptContext] : base,
    })
    await resourceLoader.reload()

    // customTools 收容两种来源：TangyuanToolDefinition（带简化的 execute 签名）
    // 与 ToolDefinition（来自 createProtectedTools 的 read_file 包装）。
    // toSdkCustomTools 是唯一的类型适配边界，参见 protected-tools.ts。
    const customTools: unknown[] = []

    customTools.push(createUpdateSoulTool(request.onUpdateSoul))
    customTools.push(createUpdateUserProfileTool(request.onUpdateUserProfile))

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
        agentId: request.agentId,
        sessionId: request.sessionId,
        cwd: request.cwd,
      }

      // 受保护的危险工具：read_file / run_command / write_file / edit_file
      // 通过 createProtectedTools 集中构造，使用与原生不同的工具名，
      // 避免与 excludeTools 排除的原生名冲突。
      customTools.push(
        ...createProtectedTools(
          {
            gateway: approvalGateway,
            agentId: request.agentId,
            sessionId: request.sessionId,
            cwd: request.cwd,
          },
          // 原生 read 工具定义工厂，供 read_file 复用（保留图片/offset/limit 能力）。
          // createReadToolDefinition 的返回类型比泛型的 ToolDefinition 更具体
          //（renderCall 参数在 strict 模式下不兼容），这一窄化仅限于此回调。
          (cwd: string) => createReadToolDefinition(cwd) as ToolDefinition,
        ),
      )

      // 自定义单问题澄清工具
      customTools.push({
        name: 'ask_clarification',
        label: '询问用户（单问题澄清）',
        description:
          '向用户提出一个需要选择或回答的问题。每次只提一个问题，支持 2–5 个预设选项和可选的"其他"自由输入。后续问题通过新的 tool call 依次提出。',
        promptSnippet:
          'ask_clarification(question: string, options: string[], allowCustomAnswer?: boolean) → 用户选择的答案',
        promptGuidelines: [
          '每次只提一个问题，不要在一个 tool call 中提多个问题',
          '选项数量应在 2–5 个之间',
          '如果预设选项不足以覆盖用户可能的需求，设置 allowCustomAnswer 为 true',
          '用户回答后将立即从断点继续执行',
        ],
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', minLength: 1 },
            options: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              minItems: 2,
              maxItems: 5,
            },
            allowCustomAnswer: { type: 'boolean', default: false },
          },
          required: ['question', 'options'],
          additionalProperties: false,
        },
        async execute(
          _toolCallId: string,
          params: {
            question: string
            options: string[]
            allowCustomAnswer?: boolean
          },
        ) {
          const result = await approvalGateway.requestClarification({
            agentId: approvalRunContext.agentId || 'tangyuan',
            sessionId: approvalRunContext.sessionId,
            runId: '',
            question: params.question,
            options: params.options,
            allowCustomAnswer: params.allowCustomAnswer ?? false,
          })

          if (!result.answer) {
            return {
              content: [
                {
                  type: 'text',
                  text: '用户取消了本次澄清。',
                },
              ],
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: `用户回答：${result.answer}`,
              },
            ],
          }
        },
      })
    }

    // 显式排除 Pi SDK 原生危险工具，由汤圆受保护版本接管。
    // 受保护版本使用不同的工具名（run_command / write_file / edit_file / read_file），
    // 因此排除原生名不会牵连它们——安全边界不依赖 SDK 的工具注册顺序。
    const excludedToolNames: string[] = []
    if (approvalGateway) {
      excludedToolNames.push(...NATIVE_DANGEROUS_TOOL_NAMES)
    }

    const { session } = await createAgentSession({
      cwd: request.cwd,
      authStorage,
      modelRegistry,
      model,
      sessionManager,
      settingsManager: SettingsManager.inMemory(),
      resourceLoader,
      ...(customTools.length > 0
        ? { customTools: toSdkCustomTools(customTools) }
        : {}),
      ...(excludedToolNames.length > 0
        ? { excludeTools: excludedToolNames }
        : {}),
    })

    return {
      sdkSessionFile: sessionManager.getSessionFile() ?? request.sdkSessionFile,
      setSystemPromptContext: (context: string) => {
        systemPromptContext = context
      },
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
