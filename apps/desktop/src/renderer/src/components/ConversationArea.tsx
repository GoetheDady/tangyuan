import type {
  AgentSessionSummary,
  ModelDescriptor,
  ProviderDescriptor,
  SessionModelInfo,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'

import { Composer } from '@/components/Composer'
import { ForkSourceNotice } from '@/components/ForkSourceNotice'
import { SessionLoadingHint } from '@/components/SessionLoadingHint'
import { TranscriptMessages } from '@/components/TranscriptMessages'

export interface ConversationAreaComposerProps {
  value: string
  onChange(value: string): void
  onSubmit(): void
  onCancel(): void
  isRunning: boolean
  disabled: boolean
  sessionModelInfo: SessionModelInfo | null
  isLoadingModelInfo: boolean
  isSwitchingModel: boolean
  providers: ProviderDescriptor[]
  selectableModels: ModelDescriptor[]
  onModelChange(providerId: string, modelId: string): void
  onThinkingLevelChange(level: string): void
}

export interface ConversationAreaProps {
  /** 当前选中的会话；为空时展示空态输入区。 */
  selectedSession: AgentSessionSummary | null
  /** 当前分叉会话的父会话（不可用时为 null）。 */
  parentSession: AgentSessionSummary | null
  /** 跳转后在父会话中定位的分叉来源消息标识。 */
  forkSource?: { messageId: string; sdkEntryId?: string } | null
  /** 当前会话的 transcript（会话不匹配时由组件忽略）。 */
  transcript: TranscriptSnapshot | null
  /** 当前会话的 transcript 是否仍在读取；读取中且无内容时展示会话读取提示。 */
  isLoadingTranscript: boolean
  /** 模型是否正在流式输出。 */
  isStreaming: boolean
  /** 是否在等待响应（发送中/排队/运行中）。 */
  isAwaitingResponse: boolean
  /** 输入区占位符中使用的 Agent 显示名。 */
  activeAgentDisplayName: string
  /** 输入区与模型选择状态。 */
  composer: ConversationAreaComposerProps
  /** 消息操作回调。 */
  actions: {
    onRetry(userMessageId: string): void
    onFork(userMessageId: string): void
    onViewForkSource(): void
  }
}

/**
 * 聊天主界面的对话区：会话标题、分叉提示、消息流、审批/澄清卡片与输入区。
 *
 * 只依赖选中的会话与转录数据，按会话标识自行过滤待审批/待澄清请求；
 * ChatPage 负责状态与调用 Preload API，本组件负责对话区的布局与展示。
 *
 * @param props - 会话、转录、运行状态与操作回调。
 * @returns 对话区组件树。
 * @throws 此组件不会主动抛出错误。
 */
export function ConversationArea(
  props: ConversationAreaProps,
): React.JSX.Element {
  const { selectedSession } = props

  return (
    <section
      data-testid="chat-main"
      className="bg-background flex min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <header
        data-testid="chat-header"
        className="border-border flex h-12 shrink-0 items-center border-b px-[18px]"
      >
        <h2 className="text-section-heading min-w-0 flex-1 truncate font-semibold">
          {selectedSession?.title ?? '新对话'}
        </h2>
        {(props.isAwaitingResponse || props.isStreaming) && (
          <span
            aria-label="运行中"
            className="bg-primary ml-3 size-1.5 shrink-0 animate-pulse rounded-full"
          />
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {selectedSession?.forkedFrom && (
          <ForkSourceNotice
            parentSessionTitle={props.parentSession?.title ?? null}
            isParentAvailable={props.parentSession !== null}
            onViewSource={() => {
              props.actions.onViewForkSource()
            }}
          />
        )}
        {props.isLoadingTranscript && props.transcript === null ? (
          <SessionLoadingHint />
        ) : (
          <div
            key={selectedSession?.sessionId ?? 'no-session'}
            className="animate-session-content-enter flex min-h-0 flex-1 flex-col"
            data-testid="message-stream"
          >
            <TranscriptMessages
              key={selectedSession?.sessionId ?? 'no-session'}
              transcript={props.transcript}
              isStreaming={props.isStreaming}
              isAwaitingResponse={props.isAwaitingResponse}
              sessionId={selectedSession?.sessionId ?? null}
              forkSource={props.forkSource}
              onRetry={(userMessageId) => {
                props.actions.onRetry(userMessageId)
              }}
              onFork={(userMessageId) => {
                props.actions.onFork(userMessageId)
              }}
            />
          </div>
        )}
      </div>

      <footer
        data-testid="chat-composer-area"
        className="bg-background shrink-0 px-4 pt-[5px] pb-[6px]"
      >
        <Composer
          value={props.composer.value}
          onChange={props.composer.onChange}
          onSubmit={() => {
            props.composer.onSubmit()
          }}
          placeholder={
            selectedSession
              ? '继续输入...'
              : `给${props.activeAgentDisplayName}发送消息...`
          }
          isRunning={props.composer.isRunning}
          onCancel={() => {
            props.composer.onCancel()
          }}
          disabled={props.composer.disabled}
          sessionModelInfo={props.composer.sessionModelInfo}
          isLoadingModelInfo={props.composer.isLoadingModelInfo}
          isSwitchingModel={props.composer.isSwitchingModel}
          providers={props.composer.providers}
          selectableModels={props.composer.selectableModels}
          onModelChange={(providerId, modelId) => {
            props.composer.onModelChange(providerId, modelId)
          }}
          onThinkingLevelChange={(level) => {
            props.composer.onThinkingLevelChange(level)
          }}
        />
      </footer>
    </section>
  )
}
