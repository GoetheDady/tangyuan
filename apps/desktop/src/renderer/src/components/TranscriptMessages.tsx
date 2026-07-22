import type {
  AgentMessage,
  AgentReplyEntry,
  TranscriptEntry,
  TranscriptSnapshot
} from '@tangyuan/contracts'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Sparkles } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { AssistantMessage } from './AssistantMessage'
import { CompactionIndicator } from './CompactionIndicator'
import { StreamdownMessage } from './StreamdownMessage'
import { UserMessage } from './UserMessage'

/**
 * 虚拟列表中的渲染项：对话消息、AssitantMessage 或压缩提示。
 */
type RenderItem =
  | { type: 'message'; message: AgentMessage; isLastAgent: boolean; renderIndex: number }
  | { type: 'assistant-message'; entry: AgentReplyEntry; isLastAgent: boolean; renderIndex: number }
  | { type: 'compaction'; timestamp: string; renderIndex: number }

/**
 * 距底部阈值（px）：scrollHeight - scrollTop - clientHeight 小于此值时视为"在底部"。
 */
const AT_BOTTOM_THRESHOLD = 50

/**
 * 各类型条目的预估高度（px），用于 TanStack Virtual 初始布局。
 * 实际高度由 measureElement 通过 ResizeObserver 动态测量。
 */
const ESTIMATED_SIZES: Record<RenderItem['type'], number> = {
  compaction: 48,
  message: 100,
  'assistant-message': 160
}

/**
 * 根据条目类型返回虚拟列表的预估高度。
 *
 * @param item - 渲染项。
 * @returns 预估高度（px）。
 */
function estimateItemSize(item: RenderItem): number {
  return ESTIMATED_SIZES[item.type]
}

/**
 * 生成虚拟列表中条目的稳定标识。
 *
 * 对于 assistant-message，使用 transcript 索引 + messageId + attemptId
 * 确保多次执行尝试、重试、取消后条目身份稳定。
 *
 * @param item - 渲染项。
 * @param _index - 虚拟列表索引（保留用于未来扩展）。
 * @returns 稳定标识字符串。
 */
function getItemStableKey(item: RenderItem): string {
  if (item.type === 'message') {
    return item.message.messageId
  }
  if (item.type === 'assistant-message') {
    const attemptId = item.entry.attempt?.attemptId ?? 'initial'
    return `${item.entry.index}-${item.entry.messageId}-${attemptId}`
  }
  return `compaction-${item.timestamp}-${item.renderIndex}`
}

/**
 * 判断消息是否属于聊天主界面可展示的对话消息。
 *
 * @param role - 消息角色。
 * @returns 用户消息或模型消息返回 true。
 * @throws 此方法不会主动抛出错误。
 */
function isDialogRole(role: string): boolean {
  return role === 'user' || role === 'agent'
}

/**
 * 根据对话消息角色判断是否为可展示的对话角色。
 *
 * @param kind - transcript 条目类型。
 * @returns 用户消息或 Agent 回复返回 true。
 */
function isDialogKind(kind: TranscriptEntry['kind']): boolean {
  return kind === 'user-message' || kind === 'agent-reply'
}

/**
 * 将原始 transcript 消息列表转换为虚拟列表渲染项。
 *
 * @param messages - 原始消息列表（含 system/compaction）。
 * @param isStreaming - 是否正在流式传输中。
 * @returns 可传入虚拟列表的 RenderItem 数组。
 * @throws 此方法不会主动抛出错误。
 */
function buildRenderItems(messages: AgentMessage[], isStreaming: boolean): RenderItem[] {
  const dialogCount = messages.filter((m) => isDialogRole(m.role)).length
  const items: RenderItem[] = []
  let dialogIndex = 0
  let renderIndex = 0

  for (const message of messages) {
    if (message.role === 'compaction') {
      items.push({ type: 'compaction', timestamp: message.createdAt, renderIndex: renderIndex++ })
    } else if (isDialogRole(message.role)) {
      const isLastAgent = isStreaming && message.role === 'agent' && dialogIndex === dialogCount - 1
      items.push({ type: 'message', message, isLastAgent, renderIndex: renderIndex++ })
      dialogIndex++
    }
    // system 消息在 transcript 中静默跳过
  }

  return items
}

/**
 * 从结构化 TranscriptEntry 列表构建虚拟列表渲染项。
 *
 * @param entries - 结构化 transcript 条目列表。
 * @param isStreaming - 是否正在流式传输中。
 * @returns 可传入虚拟列表的 RenderItem 数组。
 * @throws 此方法不会主动抛出错误。
 */
function buildRenderItemsFromTranscript(
  entries: readonly TranscriptEntry[],
  isStreaming: boolean
): RenderItem[] {
  const dialogCount = entries.filter((e) => isDialogKind(e.kind)).length
  const items: RenderItem[] = []
  let dialogIndex = 0
  let renderIndex = 0

  for (const entry of entries) {
    if (entry.kind === 'compaction') {
      items.push({
        type: 'compaction',
        timestamp: entry.timestamp,
        renderIndex: renderIndex++
      })
    } else if (entry.kind === 'user-message') {
      items.push({
        type: 'message',
        message: {
          messageId: entry.messageId,
          agentId: '',
          sessionId: '',
          role: 'user',
          content: entry.content,
          createdAt: entry.createdAt
        },
        isLastAgent: false,
        renderIndex: renderIndex++
      })
      dialogIndex++
    } else if (entry.kind === 'agent-reply') {
      const isLastAgent = isStreaming && dialogIndex === dialogCount - 1
      items.push({
        type: 'assistant-message',
        entry,
        isLastAgent,
        renderIndex: renderIndex++
      })
      dialogIndex++
    }
  }

  return items
}

/**
 * TranscriptMessages 组件的属性。
 */
export interface TranscriptMessagesProps {
  /** 当前会话的全部消息（含 system/compaction）。 */
  messages: AgentMessage[]
  /** 结构化会话快照；提供时优先于 messages 使用。 */
  transcript?: TranscriptSnapshot | null
  /** 是否正在流式接收 Agent 回复。 */
  isStreaming: boolean
  /** 当前选中会话的标识；为 null 时不展示消息。 */
  sessionId: string | null
  /** 重试回调；传入失败条目的 inReplyTo 用户消息标识。 */
  onRetry?: (userMessageId: string) => void
}

/**
 * 使用 TanStack Virtual 高性能渲染动态高度对话 transcript。
 *
 * 功能：
 * - 虚拟化渲染，仅挂载视口附近的消息节点
 * - 动态高度：流式增长和 Markdown 渲染后自动重测高度
 * - 自动跟随：用户在底部时新消息自动滚入视口
 * - 历史阅读不打扰：用户向上滚动后新消息不强制拉回
 * - 展开/收起锚点：展开或收起执行历史时保持 disclosure 按钮可见
 * - 容器高度自适应：审批/澄清卡片变化时自动调整滚动位置
 * - Memoization：已渲染消息的内容未变时跳过 Streamdown 重解析
 * - Compaction 检测：Pi 自动压缩条目渲染为非阻塞状态提示
 * - 稳定身份：多次执行尝试、失败重试、取消后条目身份不重复或错位
 *
 * @param props - 组件的属性。
 * @returns 虚拟化 transcript 组件树。
 * @throws 此组件不会主动抛出错误。
 */
export function TranscriptMessages({
  messages,
  transcript,
  isStreaming,
  sessionId,
  onRetry
}: TranscriptMessagesProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const prevSessionIdRef = useRef(sessionId)

  const renderItems = useMemo(
    () =>
      transcript && transcript.entries.length > 0
        ? buildRenderItemsFromTranscript(transcript.entries, isStreaming)
        : buildRenderItems(messages, isStreaming),
    [messages, transcript, isStreaming]
  )

  const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const item = renderItems[index]
      return item ? estimateItemSize(item) : 120
    },
    overscan: 5,
    getItemKey: (index) => {
      const item = renderItems[index]
      if (!item) return `item-${index}`
      return getItemStableKey(item)
    }
  })

  // 用于展开/收起时保持阅读位置的锚点信息
  const anchorRef = useRef<{ index: number; offsetFromTop: number } | null>(null)

  // 监听滚动位置，跟踪用户是否在底部
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    function handleScroll(): void {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl!
      // 距底部阈值以内视为"在底部"
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < AT_BOTTOM_THRESHOLD
    }

    scrollEl.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollEl.removeEventListener('scroll', handleScroll)
  }, [])

  // ResizeObserver 监听滚动容器高度变化（审批/澄清卡片出现/消失时）
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    const observer = new ResizeObserver(() => {
      // 容器高度变化时，若用户在底部则重新滚到底部
      if (isAtBottomRef.current && renderItems.length > 0) {
        requestAnimationFrame(() => {
          virtualizer.scrollToIndex(renderItems.length - 1, { align: 'end' })
        })
      }
    })

    observer.observe(scrollEl)
    return () => observer.disconnect()
  }, [renderItems.length, virtualizer])

  // 会话切换时滚动到底部
  useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = sessionId
      anchorRef.current = null
      if (renderItems.length > 0) {
        // 等待虚拟列表布局完成后滚动
        requestAnimationFrame(() => {
          virtualizer.scrollToIndex(renderItems.length - 1, { align: 'end' })
          isAtBottomRef.current = true
        })
      }
    }
  }, [sessionId, renderItems.length, virtualizer])

  // 新消息到达时，若用户在底部则自动跟随
  const prevMessageCountRef = useRef(renderItems.length)
  useEffect(() => {
    const prevCount = prevMessageCountRef.current
    prevMessageCountRef.current = renderItems.length

    if (renderItems.length > prevCount && isAtBottomRef.current) {
      virtualizer.scrollToIndex(renderItems.length - 1, { align: 'end' })
    }
  }, [renderItems.length, virtualizer])

  // 流式模式下最后一条消息内容增长时，若用户在底部则保持跟随
  const lastItem = renderItems.length > 0 ? renderItems[renderItems.length - 1] : null
  const lastMessageContent =
    lastItem?.type === 'message'
      ? lastItem.message.content.length
      : lastItem?.type === 'assistant-message'
        ? lastItem.entry.content.length
        : 0
  useEffect(() => {
    if (isStreaming && isAtBottomRef.current && renderItems.length > 0) {
      virtualizer.scrollToIndex(renderItems.length - 1, { align: 'end' })
    }
  }, [lastMessageContent]) // eslint-disable-line react-hooks/exhaustive-deps

  // 展开/收起执行历史时保持阅读位置
  // 当总高度变化时（ResizeObserver 触发测量更新），检查是否需要调整滚动位置
  const totalSize = virtualizer.getTotalSize()
  const prevTotalSizeRef = useRef(totalSize)
  useEffect(() => {
    const anchor = anchorRef.current
    if (anchor && scrollRef.current) {
      // 找到锚点条目当前在虚拟列表中的位置
      const anchorVirtualIndex = virtualizer.getVirtualItems().find((v) => v.index === anchor.index)
      if (anchorVirtualIndex) {
        const currentOffset = anchorVirtualIndex.start - scrollRef.current.scrollTop
        const delta = currentOffset - anchor.offsetFromTop
        scrollRef.current.scrollTop += delta
      }
      anchorRef.current = null
    }
    prevTotalSizeRef.current = totalSize
  }, [totalSize]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 在展开/收起执行历史前调用，记录当前展开按钮的锚点位置。
   *
   * @param renderIndex - 被切换的条目在 renderItems 中的索引。
   */
  const handleToggleStart = useCallback(
    (renderIndex: number) => {
      const scrollEl = scrollRef.current
      if (!scrollEl) return

      const virtualItems = virtualizer.getVirtualItems()
      const targetItem = virtualItems.find((v) => v.index === renderIndex)
      if (targetItem) {
        anchorRef.current = {
          index: renderIndex,
          offsetFromTop: targetItem.start - scrollEl.scrollTop
        }
      }
    },
    [virtualizer]
  )

  if (!sessionId) {
    return (
      <div className="grid min-h-full place-items-center text-center">
        <div>
          <div className="mx-auto mb-4 grid size-11 place-items-center rounded-md border bg-card">
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <p className="text-sm text-muted-foreground">选择一个会话后开始。</p>
        </div>
      </div>
    )
  }

  if (renderItems.length === 0) {
    return (
      <div className="grid min-h-full place-items-center text-center">
        <div>
          <div className="mx-auto mb-4 grid size-11 place-items-center rounded-md border bg-card">
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <p className="text-sm text-muted-foreground">发送第一条消息开始会话。</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="mx-auto h-full max-w-3xl overflow-y-auto"
      data-testid="message-scroll-area"
    >
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = renderItems[virtualItem.index]
          if (!item) return null

          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{
                transform: `translateY(${virtualItem.start}px)`
              }}
            >
              {item.type === 'compaction' ? (
                <CompactionIndicator timestamp={item.timestamp} />
              ) : item.type === 'assistant-message' ? (
                <div className="py-3.5">
                  <AssistantMessage
                    entry={item.entry}
                    isStreaming={item.isLastAgent}
                    onRetry={
                      onRetry
                        ? () => {
                            // Use inReplyTo if available, otherwise find the preceding user message
                            let userMessageId = item.entry.inReplyTo
                            if (!userMessageId && transcript) {
                              const entryIndex = item.entry.index
                              for (let i = entryIndex - 1; i >= 0; i--) {
                                const prevEntry = transcript.entries[i]
                                if (prevEntry && prevEntry.kind === 'user-message') {
                                  userMessageId = prevEntry.messageId
                                  break
                                }
                              }
                            }
                            if (userMessageId) {
                              onRetry(userMessageId)
                            }
                          }
                        : undefined
                    }
                    onToggleStart={() => handleToggleStart(item.renderIndex)}
                  />
                </div>
              ) : (
                <div className="py-3.5">
                  <MemoizedDialogMessage message={item.message} isAnimating={item.isLastAgent} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 单条对话消息气泡的展示属性。
 */
interface DialogMessageProps {
  /** 要渲染的消息。 */
  message: AgentMessage
  /** 是否为当前流式输出中的最后一条 Agent 消息。 */
  isAnimating: boolean
}

/**
 * 经 React.memo 包裹的对话消息气泡。
 *
 * 自定义比较函数确保：仅当消息内容变化或流式动画状态变化时才重渲染，
 * 避免已渲染消息因 transcript 数组引用变化而触发冗余的 Markdown 解析和 Shiki 高亮。
 */
const MemoizedDialogMessage = React.memo(
  function DialogMessage({ message, isAnimating }: DialogMessageProps): React.JSX.Element {
    return (
      <article className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`max-w-[76%] min-w-0 rounded-lg px-4 py-3 text-sm leading-6 shadow-sm ${
            message.role === 'user'
              ? 'bg-primary text-primary-foreground'
              : 'border bg-card text-card-foreground'
          }`}
        >
          {message.role === 'agent' ? (
            <StreamdownMessage content={message.content} isAnimating={isAnimating} />
          ) : (
            <UserMessage content={message.content} />
          )}
        </div>
      </article>
    )
  },
  (prevProps, nextProps) =>
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.messageId === nextProps.message.messageId &&
    prevProps.isAnimating === nextProps.isAnimating
)
