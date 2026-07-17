import type { AgentMessage } from '@tangyuan/contracts'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Sparkles } from 'lucide-react'
import React, { useEffect, useMemo, useRef } from 'react'
import { CompactionIndicator } from './CompactionIndicator'
import { StreamdownMessage } from './StreamdownMessage'
import { UserMessage } from './UserMessage'

/**
 * 虚拟列表中的渲染项：对话消息或压缩提示。
 */
type RenderItem =
  | { type: 'message'; message: AgentMessage; isLastAgent: boolean; renderIndex: number }
  | { type: 'compaction'; timestamp: string; renderIndex: number }

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
 * TranscriptMessages 组件的属性。
 */
export interface TranscriptMessagesProps {
  /** 当前会话的全部消息（含 system/compaction）。 */
  messages: AgentMessage[]
  /** 是否正在流式接收 Agent 回复。 */
  isStreaming: boolean
  /** 当前选中会话的标识；为 null 时不展示消息。 */
  sessionId: string | null
}

/**
 * 使用 TanStack Virtual 高性能渲染动态高度对话 transcript。
 *
 * 功能：
 * - 虚拟化渲染，仅挂载视口附近的消息节点
 * - 动态高度：流式增长和 Markdown 渲染后自动重测高度
 * - 自动跟随：用户在底部时新消息自动滚入视口
 * - 历史阅读不打扰：用户向上滚动后新消息不强制拉回
 * - Memoization：已渲染消息的内容未变时跳过 Streamdown 重解析
 * - Compaction 检测：Pi 自动压缩条目渲染为非阻塞状态提示
 *
 * @param props - 组件的属性。
 * @returns 虚拟化 transcript 组件树。
 * @throws 此组件不会主动抛出错误。
 */
export function TranscriptMessages({
  messages,
  isStreaming,
  sessionId
}: TranscriptMessagesProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const prevSessionIdRef = useRef(sessionId)

  const renderItems = useMemo(
    () => buildRenderItems(messages, isStreaming),
    [messages, isStreaming]
  )

  const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    overscan: 5,
    getItemKey: (index) => {
      const item = renderItems[index]
      if (!item) return `item-${index}`
      if (item.type === 'message') return item.message.messageId
      return `compaction-${item.timestamp}-${item.renderIndex}`
    }
  })

  // 监听滚动位置，跟踪用户是否在底部
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    function handleScroll(): void {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl!
      // 距底部 50px 以内视为"在底部"
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50
    }

    scrollEl.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollEl.removeEventListener('scroll', handleScroll)
  }, [])

  // 会话切换时滚动到底部
  useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = sessionId
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
  const lastMessageContent = lastItem?.type === 'message' ? lastItem.message.content.length : 0
  useEffect(() => {
    if (isStreaming && isAtBottomRef.current && renderItems.length > 0) {
      virtualizer.scrollToIndex(renderItems.length - 1, { align: 'end' })
    }
  }, [lastMessageContent]) // eslint-disable-line react-hooks/exhaustive-deps

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
