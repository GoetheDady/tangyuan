import type {
  AgentReplyEntry,
  BashApprovalRequest,
  QuestionClarificationRequest,
  SessionModelInfo,
  TranscriptEntry,
  TranscriptSnapshot
} from '@tangyuan/contracts'
import { useMemo, useState } from 'react'

import { AssistantMessage } from '@/components/AssistantMessage'
import { BashApprovalCard } from '@/components/BashApprovalCard'
import { CompactionIndicator } from '@/components/CompactionIndicator'
import { Composer } from '@/components/Composer'
import { QuestionClarificationCard } from '@/components/QuestionClarificationCard'
import { StreamdownMessage } from '@/components/StreamdownMessage'
import { TranscriptMessages } from '@/components/TranscriptMessages'
import { UserMessage } from '@/components/UserMessage'

const FIXED_TIME = '2026-07-22T08:30:00.000Z'
const FIXED_END_TIME = '2026-07-22T08:30:04.250Z'

const modelInfo: SessionModelInfo = {
  providerId: 'anthropic',
  modelId: 'claude-sonnet-4-5',
  displayName: 'Claude Sonnet 4.5',
  thinkingLevel: 'medium',
  supportedThinkingLevels: ['low', 'medium', 'high'],
  supportsThinking: true
}

const providers = [
  { providerId: 'anthropic', displayName: 'Anthropic' },
  { providerId: 'openai', displayName: 'OpenAI' }
]

const models = [
  { providerId: 'anthropic', modelId: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
  { providerId: 'anthropic', modelId: 'claude-opus-4-1', displayName: 'Claude Opus 4.1' }
]

/** 创建使用固定时间的执行尝试夹具。
 *
 * @param status - 执行尝试状态。
 * @param error - 可选的失败或取消错误。
 * @returns 确定性的执行尝试。
 * @throws 此测试辅助方法不会抛出错误。
 */
function createAttemptFixture(
  status: 'running' | 'completed' | 'failed' | 'cancelled',
  error?: AgentReplyEntry['attempt'] extends infer T
    ? T extends { error?: infer E }
      ? E
      : never
    : never
): NonNullable<AgentReplyEntry['attempt']> {
  return {
    attemptId: `attempt-${status}`,
    runId: `run-${status}`,
    status,
    startedAt: FIXED_TIME,
    completedAt: status === 'running' ? null : FIXED_END_TIME,
    ...(error ? { error } : {})
  }
}

/** 创建 Agent 回复条目夹具。
 *
 * @param overrides - 需要覆盖的回复字段。
 * @returns 带默认完成状态的确定性 Agent 回复条目。
 * @throws 此测试辅助方法不会抛出错误。
 */
function createAgentReplyFixture(overrides: Partial<AgentReplyEntry>): AgentReplyEntry {
  return {
    kind: 'agent-reply',
    index: 1,
    messageId: 'assistant-default',
    content: '已经完成验收，并整理了可审查的结果。',
    createdAt: FIXED_TIME,
    attempt: createAttemptFixture('completed'),
    turns: [],
    inReplyTo: 'user-default',
    ...overrides
  }
}

const completedReply = createAgentReplyFixture({
  messageId: 'assistant-completed',
  turns: [
    {
      index: 0,
      runId: 'run-completed',
      status: 'completed',
      startedAt: FIXED_TIME,
      completedAt: FIXED_END_TIME,
      steps: [
        {
          index: 0,
          kind: 'thinking',
          content: '先核对对话结构、键盘路径和视觉层级，再输出结论。',
          status: 'completed',
          startedAt: FIXED_TIME,
          completedAt: '2026-07-22T08:30:01.000Z'
        },
        {
          index: 1,
          kind: 'tool-call',
          toolCallId: 'tool-1',
          toolName: 'read',
          content: '读取 4 个组件文件并核对布局约束',
          status: 'completed',
          startedAt: '2026-07-22T08:30:01.000Z',
          completedAt: '2026-07-22T08:30:02.250Z'
        }
      ]
    }
  ]
})

const activeToolLoopReply = createAgentReplyFixture({
  index: 3,
  messageId: 'assistant-tool-loop',
  content: '',
  attempt: createAttemptFixture('running'),
  turns: [
    {
      index: 0,
      runId: 'run-running',
      status: 'running',
      startedAt: FIXED_TIME,
      completedAt: null,
      steps: [
        {
          index: 0,
          kind: 'thinking',
          content: '正在检查窄宽度下 Composer 与对话动作是否互相遮挡。',
          status: 'completed',
          startedAt: FIXED_TIME,
          completedAt: '2026-07-22T08:30:01.000Z'
        },
        {
          index: 1,
          kind: 'tool-call',
          toolCallId: 'tool-running',
          toolName: 'playwright',
          content: '在 1024、1280、1536 三个桌面宽度执行布局检查',
          status: 'running',
          startedAt: '2026-07-22T08:30:01.000Z',
          completedAt: null
        }
      ]
    }
  ]
})

const candidateReply = createAgentReplyFixture({
  index: 5,
  messageId: 'assistant-candidate',
  content: '候选正文正在形成，尚未由 Runtime 确认完成。',
  attempt: createAttemptFixture('running'),
  turns: [
    {
      index: 0,
      runId: 'run-running',
      status: 'running',
      startedAt: FIXED_TIME,
      completedAt: null,
      steps: [
        {
          index: 0,
          kind: 'text',
          content: '候选正文正在形成，尚未由 Runtime 确认完成。',
          status: 'running',
          startedAt: FIXED_TIME,
          completedAt: null
        }
      ]
    }
  ]
})

const failedReply = createAgentReplyFixture({
  index: 7,
  messageId: 'assistant-failed',
  content: '执行中断，已保留失败前的结构化历史。',
  attempt: createAttemptFixture('failed', {
    code: 'unknown',
    message: '连接在读取响应时中断。',
    recoverable: true
  }),
  turns: [
    {
      index: 0,
      runId: 'run-ended',
      status: 'failed',
      startedAt: FIXED_TIME,
      completedAt: FIXED_END_TIME,
      steps: [
        {
          index: 0,
          kind: 'thinking',
          content: '保留中断前已经确认的执行历史。',
          status: 'failed',
          startedAt: FIXED_TIME,
          completedAt: FIXED_END_TIME
        }
      ]
    }
  ]
})

const cancelledReply = createAgentReplyFixture({
  index: 9,
  messageId: 'assistant-cancelled',
  content: '',
  attempt: createAttemptFixture('cancelled', {
    code: 'run-cancelled',
    message: '用户停止了本次生成。',
    recoverable: true
  }),
  turns: [
    {
      index: 0,
      runId: 'run-ended',
      status: 'cancelled',
      startedAt: FIXED_TIME,
      completedAt: FIXED_END_TIME,
      steps: [
        {
          index: 0,
          kind: 'thinking',
          content: '保留中断前已经确认的执行历史。',
          status: 'completed',
          startedAt: FIXED_TIME,
          completedAt: FIXED_END_TIME
        }
      ]
    }
  ]
})

const integratedEntries: TranscriptEntry[] = [
  {
    kind: 'user-message',
    index: 0,
    messageId: 'user-1',
    content: '请对完整对话体验做一次跨组件验收。',
    createdAt: FIXED_TIME
  },
  { ...completedReply, index: 1, inReplyTo: 'user-1' },
  { kind: 'compaction', index: 2, timestamp: '2026-07-22T08:28:00.000Z' },
  {
    kind: 'user-message',
    index: 3,
    messageId: 'user-2',
    content: '继续检查长内容、工具循环和窄窗口。',
    createdAt: '2026-07-22T08:31:00.000Z'
  },
  {
    ...activeToolLoopReply,
    index: 4,
    inReplyTo: 'user-2'
  }
]

const integratedTranscript: TranscriptSnapshot = {
  sessionId: 'fixture-session',
  agentId: 'tangyuan',
  entries: integratedEntries,
  updatedAt: FIXED_END_TIME
}

const longTranscript: TranscriptSnapshot = {
  sessionId: 'long-session',
  agentId: 'tangyuan',
  updatedAt: FIXED_END_TIME,
  entries: Array.from({ length: 48 }, (_, index): TranscriptEntry => {
    if (index > 0 && index % 15 === 0) {
      return { kind: 'compaction', index, timestamp: FIXED_TIME }
    }
    if (index % 2 === 0) {
      return {
        kind: 'user-message',
        index,
        messageId: `long-user-${index}`,
        content: `第 ${Math.floor(index / 2) + 1} 轮用户消息：验证长历史滚动与虚拟列表锚点。`,
        createdAt: FIXED_TIME
      }
    }
    return createAgentReplyFixture({
      index,
      messageId: `long-agent-${index}`,
      content: [
        `### 第 ${Math.ceil(index / 2)} 轮结果`,
        '',
        '这是一段确定性的长内容，用于验证 Markdown、代码块和中文排版。',
        '',
        '```ts',
        `const turn = ${index}`,
        'export const accepted = turn > 0',
        '```'
      ].join('\n'),
      inReplyTo: `long-user-${index - 1}`
    })
  })
}

const approvals: Record<'once' | 'always' | 'reject', BashApprovalRequest> = {
  once: {
    approvalId: 'approval-once',
    agentId: 'tangyuan',
    sessionId: 'fixture-session',
    runId: 'run-approval-once',
    command: 'pnpm test --filter apps-desktop',
    cwd: '/Users/gdsw/gdsw/tangyuan',
    riskDescription: '命令会执行测试脚本，但不会写入生产数据。',
    status: 'pending',
    createdAt: FIXED_TIME
  },
  always: {
    approvalId: 'approval-always',
    agentId: 'tangyuan',
    sessionId: 'fixture-session',
    runId: 'run-approval-always',
    command: 'pnpm typecheck',
    cwd: '/Users/gdsw/gdsw/tangyuan',
    riskDescription: '始终允许只对当前会话中的完全相同命令生效。',
    status: 'pending',
    createdAt: FIXED_TIME
  },
  reject: {
    approvalId: 'approval-reject',
    agentId: 'tangyuan',
    sessionId: 'fixture-session',
    runId: 'run-approval-reject',
    command: 'rm -rf ./out',
    cwd: '/Users/gdsw/gdsw/tangyuan',
    riskDescription: '命令会删除构建产物，应在确认无需保留后执行。',
    status: 'pending',
    createdAt: FIXED_TIME
  }
}

const clarifications: QuestionClarificationRequest[] = [
  {
    clarificationId: 'clarification-1',
    agentId: 'tangyuan',
    sessionId: 'fixture-session',
    runId: 'run-clarification-1',
    question: '视觉基准应该覆盖哪种桌面宽度？',
    options: ['1024', '1280', '1440+'],
    allowCustomAnswer: true,
    status: 'pending',
    createdAt: FIXED_TIME
  },
  {
    clarificationId: 'clarification-2',
    agentId: 'tangyuan',
    sessionId: 'fixture-session',
    runId: 'run-clarification-2',
    question: '完成后是否立即运行完整 Renderer E2E？',
    options: ['立即运行', '仅运行常规回归'],
    allowCustomAnswer: true,
    status: 'pending',
    createdAt: FIXED_TIME
  }
]

/** 对话业务组件的独立 Renderer 验收夹具。 */
export default function ConversationComponentsFixturePage(): React.JSX.Element {
  const [composerValue, setComposerValue] = useState('请继续完成跨组件验收。')
  const [submitCount, setSubmitCount] = useState(0)
  const [cancelCount, setCancelCount] = useState(0)
  const [modelId, setModelId] = useState<string>(modelInfo.modelId)
  const [thinkingLevel, setThinkingLevel] = useState<string>(modelInfo.thinkingLevel ?? 'medium')
  const [retryCount, setRetryCount] = useState(0)
  const [approvalResults, setApprovalResults] = useState<Record<string, string>>({})
  const [clarificationIndex, setClarificationIndex] = useState(0)
  const [clarificationAnswers, setClarificationAnswers] = useState<string[]>([])

  const currentModelInfo = useMemo(
    () => ({ ...modelInfo, modelId, thinkingLevel }),
    [modelId, thinkingLevel]
  )

  /** 记录审批场景的已确认结果。
   *
   * @param id - 审批请求标识。
   * @param result - 用户可见的决策结果。
   * @returns 完成状态更新的 Promise。
   * @throws 此夹具回调不会抛出错误。
   */
  const resolveApproval = async (id: string, result: string): Promise<void> => {
    setApprovalResults((current) => ({ ...current, [id]: result }))
  }

  const currentClarification = clarifications[clarificationIndex] ?? clarifications[0]!

  return (
    <main
      className="min-h-full overflow-x-hidden bg-background px-6 py-10 text-foreground"
      data-fixture="conversation-components-v1"
    >
      <div className="mx-auto max-w-6xl space-y-12">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Renderer acceptance fixture
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">对话业务组件跨组件验收</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            固定 Chromium、浅色方案、reduced
            motion、时间戳、耗时和测试数据；附件入口仅作为禁用占位展示。
          </p>
        </header>

        <FixtureSection
          id="integrated"
          title="完整消息流"
          description="真实 TranscriptMessages + Composer 组合。"
        >
          <div
            className="overflow-hidden rounded-xl border bg-card shadow-level-0"
            data-testid="integrated-chat"
          >
            <div className="h-[620px] min-h-0 px-6 py-5">
              <TranscriptMessages
                transcript={integratedTranscript}
                isStreaming
                sessionId="fixture-session"
                onRetry={() => setRetryCount((value) => value + 1)}
              />
            </div>
            <div className="border-t bg-background px-6 py-4">
              <Composer
                value={composerValue}
                onChange={setComposerValue}
                onSubmit={() => setSubmitCount((value) => value + 1)}
                placeholder="给汤圆发送消息"
                isRunning={false}
                onCancel={() => setCancelCount((value) => value + 1)}
                sessionModelInfo={currentModelInfo}
                isLoadingModelInfo={false}
                isSwitchingModel={false}
                providers={providers}
                selectableModels={models}
                onModelChange={(_providerId, nextModelId) => setModelId(nextModelId)}
                onThinkingLevelChange={setThinkingLevel}
              />
              <output className="sr-only" aria-live="polite" data-testid="composer-result">
                提交 {submitCount} 次，停止 {cancelCount} 次，模型 {modelId}，思考 {thinkingLevel}
              </output>
            </div>
          </div>
        </FixtureSection>

        <FixtureSection
          id="message-primitives"
          title="消息原语"
          description="UserMessage、StreamdownMessage 与 CompactionIndicator 的确定性内容。"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border bg-card p-5">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">
                UserMessage · 纯文本
              </p>
              <article className="flex justify-end">
                <div className="max-w-[76%] rounded-lg bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
                  <UserMessage content={'# 不解析 Markdown\n保留用户输入的换行。'} />
                </div>
              </article>
            </div>
            <div className="rounded-xl border bg-card p-5">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">
                StreamdownMessage · Markdown
              </p>
              <StreamdownMessage
                content={
                  '### 验收结果\n\n- 中文排版\n- `inline code`\n- [安全链接](https://example.com)'
                }
              />
            </div>
            <div className="rounded-xl border bg-card p-5 lg:col-span-2">
              <CompactionIndicator timestamp={FIXED_TIME} />
            </div>
          </div>
        </FixtureSection>

        <FixtureSection
          id="assistant-states"
          title="AssistantMessage 状态矩阵"
          description="运行中工具循环、候选正文、完成收起/展开、失败、取消和重试。"
        >
          <div className="grid gap-5 xl:grid-cols-2">
            <StateCard label="运行中 · 工具循环" testId="assistant-tool-loop">
              <AssistantMessage entry={activeToolLoopReply} isStreaming />
            </StateCard>
            <StateCard label="运行中 · 候选正文" testId="assistant-candidate">
              <AssistantMessage entry={candidateReply} isStreaming />
            </StateCard>
            <StateCard label="完成 · 默认收起 / 手动展开" testId="assistant-completed">
              <AssistantMessage entry={completedReply} isStreaming={false} />
            </StateCard>
            <StateCard label="失败 · 可重试" testId="assistant-failed">
              <AssistantMessage
                entry={failedReply}
                isStreaming={false}
                onRetry={() => setRetryCount((value) => value + 1)}
              />
              <output className="sr-only" aria-live="polite" data-testid="retry-result">
                已重试 {retryCount} 次
              </output>
            </StateCard>
            <StateCard label="取消 · 保留历史" testId="assistant-cancelled">
              <AssistantMessage entry={cancelledReply} isStreaming={false} />
            </StateCard>
          </div>
        </FixtureSection>

        <FixtureSection
          id="conversation-actions"
          title="对话动作"
          description="Bash 三种决策与连续单问题澄清；完成后保留确认结果。"
        >
          <div className="space-y-6">
            {(Object.keys(approvals) as Array<keyof typeof approvals>).map((scenario) => {
              const approval = approvals[scenario]
              return (
                <div
                  key={scenario}
                  data-approval-scenario={scenario}
                  className="rounded-xl border bg-muted/20 p-4"
                >
                  <BashApprovalCard
                    approval={approval}
                    onApproveOnce={(id) => resolveApproval(id, '仅允许本次')}
                    onApproveAlways={(id) => resolveApproval(id, '始终允许')}
                    onReject={(id) => resolveApproval(id, '已拒绝')}
                  />
                  <output role="status" className="block text-center text-xs text-muted-foreground">
                    {approvalResults[approval.approvalId] ?? '等待决策'}
                  </output>
                </div>
              )
            })}

            <div className="rounded-xl border bg-muted/20 p-4" data-testid="clarification-sequence">
              <QuestionClarificationCard
                clarification={currentClarification}
                onAnswer={async (_id, answer) => {
                  setClarificationAnswers((current) => [...current, answer])
                  setClarificationIndex((current) =>
                    Math.min(current + 1, clarifications.length - 1)
                  )
                }}
                onCancel={async () => {
                  setClarificationAnswers((current) => [...current, '已取消'])
                }}
              />
              <output role="status" className="block text-center text-xs text-muted-foreground">
                已确认：{clarificationAnswers.join(' → ') || '等待回答'}
              </output>
            </div>
          </div>
        </FixtureSection>

        <FixtureSection
          id="composer-states"
          title="Composer 状态矩阵"
          description="空闲、聚焦（由 Playwright 建立）、运行中和禁用附件占位。"
        >
          <div className="grid gap-5 xl:grid-cols-2">
            <StateCard label="空闲 / 可发送" testId="composer-idle">
              <Composer
                value="按 Enter 发送，Shift+Enter 换行。"
                onChange={() => undefined}
                onSubmit={() => setSubmitCount((value) => value + 1)}
                placeholder="给汤圆发送消息"
                isRunning={false}
                onCancel={() => undefined}
                sessionModelInfo={currentModelInfo}
                isLoadingModelInfo={false}
                isSwitchingModel={false}
                providers={providers}
                selectableModels={models}
                onModelChange={(_providerId, nextModelId) => setModelId(nextModelId)}
                onThinkingLevelChange={setThinkingLevel}
              />
            </StateCard>
            <StateCard label="运行中 / 可停止" testId="composer-running">
              <Composer
                value="运行期间可以继续编辑下一条草稿。"
                onChange={() => undefined}
                onSubmit={() => undefined}
                placeholder="给汤圆发送消息"
                isRunning
                onCancel={() => setCancelCount((value) => value + 1)}
                sessionModelInfo={currentModelInfo}
                isLoadingModelInfo={false}
                isSwitchingModel={false}
                providers={providers}
                selectableModels={models}
                onModelChange={() => undefined}
                onThinkingLevelChange={() => undefined}
              />
            </StateCard>
          </div>
        </FixtureSection>

        <FixtureSection
          id="long-history"
          title="长内容与虚拟列表"
          description="48 个结构化条目、代码块和压缩提示，固定高度内滚动。"
        >
          <div
            className="h-[720px] min-h-0 overflow-hidden rounded-xl border bg-card px-5 py-4"
            data-testid="long-history"
          >
            <TranscriptMessages
              transcript={longTranscript}
              isStreaming={false}
              sessionId="long-session"
            />
          </div>
        </FixtureSection>
      </div>
    </main>
  )
}

/** 渲染带标题和说明的夹具分区。
 *
 * @param props - 分区标识、标题、说明和内容。
 * @returns 可被 Playwright 独立定位的 section。
 * @throws 此测试辅助组件不会抛出错误。
 */
function FixtureSection(props: {
  id: string
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      data-fixture-section={props.id}
      aria-labelledby={`fixture-${props.id}`}
      className="space-y-5"
    >
      <div className="space-y-1.5">
        <h2 id={`fixture-${props.id}`} className="text-xl font-semibold tracking-tight">
          {props.title}
        </h2>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>
      {props.children}
    </section>
  )
}

/** 渲染单个状态样例容器。
 *
 * @param props - 样例标签、测试标识和组件内容。
 * @returns 带稳定 test id 的状态卡片。
 * @throws 此测试辅助组件不会抛出错误。
 */
function StateCard(props: {
  label: string
  testId: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-5" data-testid={props.testId}>
      <p className="mb-4 text-xs font-semibold text-muted-foreground">{props.label}</p>
      {props.children}
    </div>
  )
}
