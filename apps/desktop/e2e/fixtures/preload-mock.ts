import {
  createRuntimeSnapshot,
  createDefaultSessionSummary,
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type LastActiveSession,
  type RuntimeSnapshot,
} from '@tangyuan/contracts'

type LegacyTestMessage = {
  messageId: string
  agentId: string
  sessionId: string
  role: 'user' | 'agent' | 'compaction'
  content: string
  createdAt: string
}
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
      {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
      },
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
    providers: [{ providerId: 'anthropic', displayName: 'Anthropic' }],
    models: [
      {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
      },
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
 * @returns 可安全传给 Renderer 的 LegacyTestMessage。
 * @throws 此方法不会主动抛出错误。
 */
export function createTestMessage(
  overrides?: Partial<LegacyTestMessage>,
): LegacyTestMessage {
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
 * @returns 包含 180 行中文内容的 LegacyTestMessage。
 * @throws 此方法不会主动抛出错误。
 */
export function createLongTestMessage(): LegacyTestMessage {
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
  messages: LegacyTestMessage[] = [],
  lastActiveSession: LastActiveSession | null = null,
): string {
  const serialized = JSON.stringify({
    runtime,
    sessions,
    messages,
    lastActiveSession,
  })

  return `
    (() => {
      const data = ${serialized};
      let eventListener = null;
      window.__openExternalLinkCalls__ = [];

      window.api = {
        getRuntimeSnapshot: async () => data.runtime,
        refreshRuntime: async () => data.runtime,
        saveRuntimeConfiguration: async () => data.runtime,
        cancelRuntimeConfigurationVerification: async () => data.runtime,
        listSessions: async (request) => {
          const agentSessions = request
            ? data.sessions.filter((session) => session.agentId === request.agentId)
            : data.sessions;
          return request?.includeArchived
            ? agentSessions
            : agentSessions.filter((session) => session.archivedAt === undefined);
        },
        getLastActiveSession: async () => data.lastActiveSession,
        setLastActiveSession: async (request) => {
          data.lastActiveSession = { ...request, updatedAt: new Date().toISOString() };
          return data.lastActiveSession;
        },
        createSession: async (request) => {
          const session = {
            agentId: request.agentId,
            sessionId: 'session-' + Date.now(),
            title: '新会话',
            state: 'idle',
            updatedAt: new Date().toISOString()
          };
          data.sessions = [session, ...data.sessions];
          return session;
        },
        getTranscript: async (request) => {
          const entries = [];
          let index = 0;
          for (const msg of data.messages) {
            if (msg.role === 'user') {
              entries.push({ kind: 'user-message', index: index++, messageId: msg.messageId, content: msg.content, createdAt: msg.createdAt });
            } else if (msg.role === 'agent') {
              entries.push({ kind: 'agent-reply', index: index++, messageId: msg.messageId, content: msg.content, createdAt: msg.createdAt, attempt: null, turns: [] });
            } else if (msg.role === 'compaction') {
              entries.push({ kind: 'compaction', index: index++, timestamp: msg.createdAt });
            }
          }
          return { sessionId: request.sessionId, agentId: request.agentId, entries, updatedAt: new Date().toISOString() };
        },
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
        archiveSession: async (request) => {
          const root = data.sessions.find(
            (session) => session.agentId === request.agentId && session.sessionId === request.sessionId
          );
          if (!root) throw new Error('找不到要归档的会话。');

          const subtree = [root];
          const visited = new Set([root.sessionId]);
          for (let index = 0; index < subtree.length; index += 1) {
            const parent = subtree[index];
            for (const session of data.sessions) {
              if (
                session.agentId === request.agentId &&
                session.forkedFrom?.sessionId === parent.sessionId &&
                !visited.has(session.sessionId)
              ) {
                visited.add(session.sessionId);
                subtree.push(session);
              }
            }
          }

          const affectedActivities = subtree.flatMap((session) => {
            const kinds = [];
            if (session.state === 'running') kinds.push('running');
            if (session.state === 'queued') kinds.push('queued');
            return kinds.length > 0
              ? [{ sessionId: session.sessionId, title: session.title, kinds }]
              : [];
          });
          const affectedSessionIds = subtree.map((session) => session.sessionId);

          if (affectedActivities.length > 0 && !request.confirmActivityStop) {
            return { status: 'confirmation-required', affectedSessionIds, affectedActivities };
          }

          const archivedAt = new Date().toISOString();
          data.sessions = data.sessions.map((session) =>
            visited.has(session.sessionId)
              ? { ...session, state: 'cancelled', archivedAt, updatedAt: archivedAt }
              : session
          );
          return { status: 'archived', affectedSessionIds, affectedActivities };
        },
        recoverSession: async (request) => {
          const root = data.sessions.find(
            (session) => session.agentId === request.agentId && session.sessionId === request.sessionId
          );
          if (!root) throw new Error('找不到要恢复的会话。');

          const affectedIds = new Set([root.sessionId]);
          for (let index = 0; index < data.sessions.length; index += 1) {
            let changed = false;
            for (const session of data.sessions) {
              if (
                session.agentId === request.agentId &&
                session.forkedFrom &&
                affectedIds.has(session.forkedFrom.sessionId) &&
                !affectedIds.has(session.sessionId)
              ) {
                affectedIds.add(session.sessionId);
                changed = true;
              }
            }
            if (!changed) break;
          }

          data.sessions = data.sessions.map((session) => {
            if (!affectedIds.has(session.sessionId)) return session;
            const { archivedAt: _archivedAt, ...recovered } = session;
            return recovered;
          });
          return data.sessions.filter((session) => affectedIds.has(session.sessionId));
        },
        subscribeToAgentEvents: (listener) => {
          eventListener = listener;
          return () => { eventListener = null; };
        },
        openExternalLink: async (request) => {
          window.__openExternalLinkCalls__.push(request);
        },
        listAgents: async () => data.runtime.agents,
        restoreFromBackup: async () => data.runtime,
        resetConfiguration: async () => data.runtime,
        updateAgentConfig: async () => data.runtime.agents[0] || null,
        archiveAgent: async () => data.runtime.agents[0] || null,
        recoverAgent: async () => data.runtime.agents[0] || null,
        reconcileAgentDirectories: async () => ({
          agents: data.runtime.agents,
          unclaimedDirectories: [],
        }),
        claimAgentDirectory: async () => data.runtime.agents[0] || null,
        rebuildTangyuanHome: async () => data.runtime.agents[0] || null,
        getSessionModelInfo: async () => ({
          providerId: data.runtime.settings.selectedProviderId || 'anthropic',
          modelId: data.runtime.settings.selectedModelId || 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false,
        }),
        setSessionModel: async () => ({
          providerId: data.runtime.settings.selectedProviderId || 'anthropic',
          modelId: data.runtime.settings.selectedModelId || 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false,
        }),
        setSessionThinkingLevel: async () => ({
          providerId: data.runtime.settings.selectedProviderId || 'anthropic',
          modelId: data.runtime.settings.selectedModelId || 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false,
        }),
        getSoul: async () => ({
          agentId: '${TANGYUAN_DEFAULT_AGENT_ID}',
          content: '',
          updatedAt: new Date().toISOString(),
          version: 'sha256:empty',
        }),
        getUserProfile: async () => ({
          content: '',
          updatedAt: new Date().toISOString(),
          version: 'sha256:empty',
        }),
        updateSoul: async () => ({
          target: 'soul',
          status: 'updated',
          version: 'sha256:new-soul',
        }),
        updateUserProfile: async () => ({
          target: 'user',
          status: 'updated',
          version: 'sha256:new-user',
        }),
        listAgentSkills: async () => [],
        listSharedSkills: async () => [],
        installSkill: async () => [],
        deleteSkill: async () => [],
        approveSkillOperation: async () => {},
        rejectSkillOperation: async () => {},
        getPendingSkillApprovals: async () => [],
        getSkillInstallRecords: async () => [],
        approveBash: async () => {},
        rejectBash: async () => {},
        getPendingApprovals: async () => [],
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
export function createTestMessages(): LegacyTestMessage[] {
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
      content:
        '你好！我很乐意帮你写代码。请告诉我你需要什么功能，我会为你生成相应的代码。',
      createdAt: new Date().toISOString(),
    },
  ]
}

/**
 * 生成包含 Markdown 元素的测试消息，用于验证 Streamdown 渲染。
 *
 * 包含代码块、表格、任务列表、链接和 CJK 文本的 Agent 回复。
 *
 * @returns 符合 contracts schema 的消息数组。
 * @throws 此方法不会主动抛出错误。
 */
export function createMarkdownTestMessages(): LegacyTestMessage[] {
  return [
    {
      messageId: 'msg-user-1',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: 'session-1',
      role: 'user',
      content: '帮我写一段代码',
      createdAt: new Date(Date.now() - 60000).toISOString(),
    },
    {
      messageId: 'msg-agent-2',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: 'session-1',
      role: 'agent',
      content: [
        '## 代码示例',
        '',
        '这是一个 TypeScript 函数：',
        '',
        '```ts',
        'function hello(name: string): string {',
        '  return `你好，${name}！`',
        '}',
        '```',
        '',
        '| 参数 | 类型 | 说明 |',
        '| --- | --- | --- |',
        '| `name` | `string` | 用户名称 |',
        '',
        '**任务清单：**',
        '',
        '- [x] 完成功能开发',
        '- [ ] 编写测试',
        '- [ ] 代码审查',
        '',
        '参考文档：[TypeScript 官网](https://www.typescriptlang.org)',
      ].join('\n'),
      createdAt: new Date().toISOString(),
    },
  ]
}
