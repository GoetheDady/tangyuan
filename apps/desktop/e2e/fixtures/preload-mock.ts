import {
  createRuntimeSnapshot,
  createDefaultSessionSummary,
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentMessage,
  type AgentSessionSummary,
  type DesktopPreloadApi,
  type RuntimeSnapshot,
} from '@tangyuan/contracts'

/**
 * 生成 status='ready' 的运行时快照，用于聊天页测试。
 *
 * @param overrides - 可选的部分字段覆盖。
 * @returns 符合 contracts Zod schema 的就绪态运行时快照。
 * @throws 此方法不会主动抛出错误。
 */
export function createReadyRuntimeSnapshot(
  overrides?: Partial<RuntimeSnapshot>,
): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      displayName: '汤圆',
      homePath: '~/.tangyuan/agents/tangyuan',
      profile: {
        initialized: true,
        bootstrapRequired: false,
        soulUpdatedAt: '2026-07-01T00:00:00.000Z',
        userUpdatedAt: '2026-07-01T00:00:00.000Z',
      },
    },
    providers: [
      { providerId: 'anthropic', displayName: 'Anthropic' },
      { providerId: 'openai', displayName: 'OpenAI' },
    ],
    models: [
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
      { providerId: 'openai', modelId: 'gpt-4o', displayName: 'GPT-4o' },
    ],
    settings: {
      selectedProviderId: 'anthropic',
      selectedModelId: 'claude-sonnet-4-5',
    },
    configuredProviders: {
      anthropic: {
        configured: true,
        maskedValue: 'sk-a...7xq',
      },
    },
    auth: {
      apiKey: {
        configured: true,
        maskedValue: 'sk-a...7xq',
      },
    },
    ...overrides,
  })
}

/**
 * 生成 status='missing-config' 的运行时快照，用于配置阻断测试。
 *
 * @param overrides - 可选的部分字段覆盖。
 * @returns 符合 contracts Zod schema 的缺少配置态运行时快照。
 * @throws 此方法不会主动抛出错误。
 */
export function createMissingConfigSnapshot(
  overrides?: Partial<RuntimeSnapshot>,
): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      displayName: '汤圆',
      homePath: '~/.tangyuan/agents/tangyuan',
      profile: {
        initialized: false,
        bootstrapRequired: true,
        soulUpdatedAt: null,
        userUpdatedAt: null,
      },
    },
    providers: [
      { providerId: 'anthropic', displayName: 'Anthropic' },
    ],
    models: [
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
    ],
    settings: {
      selectedProviderId: null,
      selectedModelId: null,
    },
    configuredProviders: {},
    auth: {
      apiKey: {
        configured: false,
        maskedValue: null,
      },
    },
    ...overrides,
  })
}

/**
 * 生成一条符合 contracts schema 的测试消息。
 *
 * @param overrides - 可选的部分字段覆盖。
 * @returns 可安全传给 Renderer 的 AgentMessage。
 * @throws 此方法不会主动抛出错误。
 */
export function createTestMessage(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    agentId: TANGYUAN_DEFAULT_AGENT_ID,
    sessionId: 'session-1',
    role: 'agent',
    content: '这是一条测试消息。',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

/**
 * 生成一条超长测试消息，用于布局检查。
 *
 * @returns 包含 180 行中文内容的 AgentMessage。
 * @throws 此方法不会主动抛出错误。
 */
export function createLongTestMessage(): AgentMessage {
  const longContent = Array.from(
    { length: 180 },
    (_value, index) =>
      `第${index + 1}行：这是一段很长的回复内容，用来模拟大语言模型连续输出很多文本时，底部输入框是否仍然留在屏幕里。`,
  ).join('\n')

  return createTestMessage({ content: longContent, messageId: 'long-message' })
}

/**
 * 创建可在 Playwright page.addInitScript() 中注入的 mock window.api。
 *
 * @param runtime - 注入的运行时快照。
 * @param sessions - 可选会话列表；不传则使用空列表。
 * @param messages - 可选消息列表；不传则使用空列表。
 * @returns 字符串形式的 JavaScript 代码，定义 window.api。
 * @throws 此方法不会主动抛出错误。
 */
export function createPreloadApiInitScript(
  runtime: RuntimeSnapshot,
  sessions: AgentSessionSummary[] = [],
  messages: AgentMessage[] = [],
): string {
  const serialized = JSON.stringify({ runtime, sessions, messages })

  return `
    (() => {
      const data = ${serialized};
      let eventListener = null;

      window.api = {
        getRuntimeSnapshot: async () => data.runtime,
        refreshRuntime: async () => data.runtime,
        saveRuntimeConfiguration: async () => data.runtime,
        cancelRuntimeConfigurationVerification: async () => data.runtime,
        listSessions: async () => data.sessions,
        createSession: async () => {
          const session = {
            agentId: '${TANGYUAN_DEFAULT_AGENT_ID}',
            sessionId: 'session-' + Date.now(),
            title: '新会话',
            state: 'idle',
            updatedAt: new Date().toISOString()
          };
          data.sessions = [session, ...data.sessions];
          return session;
        },
        getMessages: async () => data.messages,
        sendMessage: async () => data.messages,
        cancelRun: async () => {
          const session = data.sessions[0] || {
            agentId: '${TANGYUAN_DEFAULT_AGENT_ID}',
            sessionId: 'session-1',
            title: '新会话',
            state: 'cancelled',
            updatedAt: new Date().toISOString()
          };
          return { ...session, state: 'cancelled', updatedAt: new Date().toISOString() };
        },
        subscribeToAgentEvents: (listener) => {
          eventListener = listener;
          return () => { eventListener = null; };
        },
        openExternalLink: async () => {}
      };
    })();
  `
}

/**
 * 生成测试用的会话摘要列表。
 *
 * @param count - 需要的会话数量。
 * @returns 符合 contracts schema 的会话摘要数组。
 * @throws 此方法不会主动抛出错误。
 */
export function createTestSessions(count = 1): AgentSessionSummary[] {
  return Array.from({ length: count }, (_value, index) =>
    createDefaultSessionSummary({
      sessionId: `session-${index + 1}`,
      title: `测试会话 ${index + 1}`,
      updatedAt: new Date().toISOString(),
    }),
  )
}

/**
 * 生成测试用的消息列表，包含一条用户消息和一条 Agent 回复。
 *
 * @returns 符合 contracts schema 的消息数组。
 * @throws 此方法不会主动抛出错误。
 */
export function createTestMessages(): AgentMessage[] {
  return [
    {
      messageId: 'msg-user-1',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: 'session-1',
      role: 'user',
      content: '你好汤圆，请帮我写一段代码。',
      createdAt: new Date(Date.now() - 60000).toISOString(),
    },
    {
      messageId: 'msg-agent-1',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: 'session-1',
      role: 'agent',
      content: '你好！我很乐意帮你写代码。请告诉我你需要什么功能，我会为你生成相应的代码。',
      createdAt: new Date().toISOString(),
    },
  ]
}
