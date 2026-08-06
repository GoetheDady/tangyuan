import type {
  AgentReplyEntry,
  TranscriptEntry,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { useVirtualizer } from '@tanstack/react-virtual'
import { GitBranchPlus, Sparkles } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  AssistantMessage,
  TIMELINE_TOGGLE_ANIMATION_MS,
} from './AssistantMessage'
import { AwaitingResponseIndicator } from './AwaitingResponseIndicator'
import { CompactionIndicator } from './CompactionIndicator'
import { UserMessage } from './UserMessage'

/**
 * 虚拟列表中的渲染项：对话消息、AssitantMessage 或压缩提示。
 */
type RenderItem =
  | {
      type: 'user-message'
      messageId: string
      content: string
      createdAt: string
      renderIndex: number
    }
  | {
      type: 'assistant-message'
      entry: AgentReplyEntry
      isLastAgent: boolean
      renderIndex: number
    }
  | { type: 'compaction'; timestamp: string; renderIndex: number }
  | { type: 'awaiting'; renderIndex: number }

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
  'user-message': 112,
  'assistant-message': 160,
  awaiting: 44,
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
  if (item.type === 'user-message') {
    return `user-${item.messageId}`
  }
  if (item.type === 'assistant-message') {
    const attemptId = item.entry.attempt?.attemptId ?? 'initial'
    return `${item.entry.index}-${item.entry.messageId}-${attemptId}`
  }
  if (item.type === 'awaiting') {
    return 'awaiting-indicator'
  }
  return `compaction-${item.timestamp}-${item.renderIndex}`
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
 * 从结构化 TranscriptEntry 列表构建虚拟列表渲染项。
 *
 * @param entries - 结构化 transcript 条目列表。
 * @param isStreaming - 是否正在流式传输中。
 * @param isAwaitingResponse - 是否处于响应等待提示状态。
 * @returns 可传入虚拟列表的 RenderItem 数组。
 * @throws 此方法不会主动抛出错误。
 */
function buildRenderItemsFromTranscript(
  entries: readonly TranscriptEntry[],
  isStreaming: boolean,
  isAwaitingResponse: boolean,
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
        renderIndex: renderIndex++,
      })
    } else if (entry.kind === 'user-message') {
      items.push({
        type: 'user-message',
        messageId: entry.messageId,
        content: entry.content,
        createdAt: entry.createdAt,
        renderIndex: renderIndex++,
      })
      dialogIndex++
    } else if (entry.kind === 'agent-reply') {
      const isLastAgent = isStreaming && dialogIndex === dialogCount - 1
      items.push({
        type: 'assistant-message',
        entry,
        isLastAgent,
        renderIndex: renderIndex++,
      })
      dialogIndex++
    }
  }

  // 响应等待提示：当本次正在进行的执行尝试尚未宣告可见 Agent 回复时，
  // 在消息流末尾追加一个轻量占位。惰性宣告下，agent-reply 条目只有在首个
  // 内容（思考 / 文字 / 工具步骤任一）到达时才宣告，且带上 status='running'
  // 的本次 attempt。因此“本次尝试已在响应”的充分条件是：最后一条对话条目
  // 是 agent-reply 且其 attempt 仍在运行。重试等待窗口内，最后一条是旧的
  // 已终结（failed / completed / cancelled）agent-reply，故仍展示占位。
  if (isAwaitingResponse) {
    const lastDialog = [...items]
      .reverse()
      .find((item) => item.type !== 'compaction')
    const hasVisibleReply =
      lastDialog?.type === 'assistant-message' &&
      lastDialog.entry.attempt?.status === 'running'
    if (!hasVisibleReply) {
      items.push({ type: 'awaiting', renderIndex: renderIndex++ })
    }
  }

  return items
}

/**
 * 将消息时间格式化为 Pencil 消息脚注使用的 24 小时制时间。
 */
function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

/**
 * TranscriptMessages 组件的属性。
 */
export interface TranscriptMessagesProps {
  /** 结构化会话快照。 */
  transcript?: TranscriptSnapshot | null
  /** 是否正在流式接收 Agent 回复。 */
  isStreaming: boolean
  /** 是否处于响应等待提示状态（执行尝试已开始但尚未产生可见内容）。 */
  isAwaitingResponse?: boolean
  /** 当前选中会话的标识；为 null 时不展示消息。 */
  sessionId: string | null
  /** 需要高亮定位的分叉来源消息；跳回父会话时使用（双 id 候选匹配）。 */
  forkSource?: { messageId: string; sdkEntryId?: string } | null
  /** 重试回调；传入失败条目的 inReplyTo 用户消息标识。 */
  onRetry?: (userMessageId: string) => void
  /** 分叉回调；传入用户消息标识。 */
  onFork?: (userMessageId: string) => void
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
  transcript,
  isStreaming,
  isAwaitingResponse = false,
  sessionId,
  forkSource = null,
  onRetry,
  onFork,
}: TranscriptMessagesProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const prevSessionIdRef = useRef(sessionId)

  const renderItems = useMemo(
    () =>
      transcript && transcript.entries.length > 0
        ? buildRenderItemsFromTranscript(
            transcript.entries,
            isStreaming,
            isAwaitingResponse,
          )
        : [],
    [transcript, isStreaming, isAwaitingResponse],
  )

  // useVirtualizer 返回的函数依赖内部可变状态，无法被 React Compiler 安全 memo 化，
  // 这是 TanStack Virtual 的上游 API 约束，调用侧改不动。本组件未启用 React
  // Compiler（构建里没接 babel-plugin-react-compiler），该提示不影响实际行为；
  // 若将来启用，需改用 @tanstack/react-virtual 官方给出的兼容方案再移除此行。
  // eslint-disable-next-line react-hooks/incompatible-library -- 上游 API 限制
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
    },
  })

  // 跳回父会话查看分叉来源时，把来源消息滚入视口；
  // 运行期 transcript 用 messageId，冷读 transcript 用 SDK entry id。
  const isForkSourceMessage = useCallback(
    (messageId: string): boolean =>
      forkSource !== null &&
      (messageId === forkSource.messageId ||
        messageId === forkSource.sdkEntryId),
    [forkSource],
  )
  useEffect(() => {
    if (!forkSource) return

    const targetIndex = renderItems.findIndex(
      (item) =>
        item.type === 'user-message' && isForkSourceMessage(item.messageId),
    )
    if (targetIndex < 0) return

    virtualizer.scrollToIndex(targetIndex, { align: 'center' })
    isAtBottomRef.current = false
  }, [forkSource, isForkSourceMessage, renderItems, virtualizer])

  // 用于展开/收起时保持阅读位置的锚点信息
  const anchorRef = useRef<{ index: number; offsetFromTop: number } | null>(
    null,
  )
  // 动画结束后清空锚点的定时器；动画期间保留锚点以持续校正。
  const anchorClearTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (anchorClearTimerRef.current !== null) {
        clearTimeout(anchorClearTimerRef.current)
      }
    }
  }, [])

  // 监听滚动位置，跟踪用户是否在底部
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    function handleScroll(): void {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl!
      // 距底部阈值以内视为"在底部"
      isAtBottomRef.current =
        scrollHeight - scrollTop - clientHeight < AT_BOTTOM_THRESHOLD
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
      if (anchorClearTimerRef.current !== null) {
        clearTimeout(anchorClearTimerRef.current)
        anchorClearTimerRef.current = null
      }
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

  // 流式输出期间以 rAF 直接跟随容器底部：读取 DOM 实时 scrollHeight，
  // 避免 scrollToIndex 依赖 virtualizer 过期测量值导致的逐帧抖动。
  useEffect(() => {
    if (!isStreaming) return
    let rafId: number
    const tick = (): void => {
      const el = scrollRef.current
      if (el && isAtBottomRef.current) {
        el.scrollTop = el.scrollHeight - el.clientHeight
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isStreaming])

  // 展开/收起执行历史时保持阅读位置
  // 当总高度变化时（ResizeObserver 触发测量更新），检查是否需要调整滚动位置
  const totalSize = virtualizer.getTotalSize()
  const prevTotalSizeRef = useRef(totalSize)
  useEffect(() => {
    const anchor = anchorRef.current
    if (anchor && scrollRef.current) {
      // 找到锚点条目当前在虚拟列表中的位置
      const anchorVirtualIndex = virtualizer
        .getVirtualItems()
        .find((v) => v.index === anchor.index)
      if (anchorVirtualIndex) {
        const currentOffset =
          anchorVirtualIndex.start - scrollRef.current.scrollTop
        const delta = currentOffset - anchor.offsetFromTop
        scrollRef.current.scrollTop += delta
      }
      // 展开/收起动画期间高度渐变，totalSize 会多次变化；保留锚点持续校正，
      // 由 handleToggleStart 设置的定时器在动画结束后清空。
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
          offsetFromTop: targetItem.start - scrollEl.scrollTop,
        }
        // 展开/收起动画期间持续校正锚点；动画结束后（预留 60ms 缓冲）清空，
        // 避免后续无关的高度变化被误校正。
        if (anchorClearTimerRef.current !== null) {
          clearTimeout(anchorClearTimerRef.current)
        }
        anchorClearTimerRef.current = window.setTimeout(() => {
          anchorRef.current = null
          anchorClearTimerRef.current = null
        }, TIMELINE_TOGGLE_ANIMATION_MS + 60)
      }
    },
    [virtualizer],
  )

  if (!sessionId) {
    return (
      <div className="grid min-h-full place-items-center text-center">
        <div>
          <div className="bg-card mx-auto mb-4 grid size-11 place-items-center rounded-md border">
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <p className="text-body text-muted-foreground">
            选择一个会话后开始。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="h-full w-full overflow-x-hidden overflow-y-auto [overflow-anchor:none]"
      data-testid="message-scroll-area"
    >
      {renderItems.length === 0 ? (
        <div className="grid min-h-full place-items-center text-center">
          <div>
            <div className="bg-card mx-auto mb-4 grid size-11 place-items-center rounded-md border">
              <Sparkles size={20} aria-hidden="true" />
            </div>
            <p className="text-body text-muted-foreground">
              发送第一条消息开始会话。
            </p>
          </div>
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-[720px] px-4">
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = renderItems[virtualItem.index]
            if (!item) return null

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {item.type === 'compaction' ? (
                  <CompactionIndicator timestamp={item.timestamp} />
                ) : item.type === 'awaiting' ? (
                  <AwaitingResponseIndicator />
                ) : item.type === 'user-message' ? (
                  <div className="py-2.5">
                    <article className="flex flex-col items-end">
                      <div
                        data-testid={
                          isForkSourceMessage(item.messageId)
                            ? 'fork-source-message'
                            : undefined
                        }
                        className={`peer bg-secondary text-body text-secondary-foreground flex max-w-[360px] min-w-0 flex-col gap-1.5 rounded-[16px_16px_4px_16px] px-4 py-3 ${
                          isForkSourceMessage(item.messageId)
                            ? 'ring-ring/60 ring-2'
                            : ''
                        }`}
                      >
                        <UserMessage content={item.content} />
                      </div>
                      <footer className="mt-1 flex h-6 items-center gap-1 opacity-0 transition-opacity peer-hover:opacity-100 focus-within:opacity-100 hover:opacity-100">
                        <time
                          dateTime={item.createdAt}
                          className="text-muted-foreground font-mono text-[10px] leading-none"
                        >
                          {formatMessageTime(item.createdAt)}
                        </time>
                        {onFork ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="从此处分叉"
                            title="从此处分叉"
                            className="window-no-drag"
                            onClick={(event) => {
                              event.stopPropagation()
                              onFork(item.messageId)
                            }}
                          >
                            <GitBranchPlus size={14} aria-hidden="true" />
                          </Button>
                        ) : null}
                      </footer>
                    </article>
                  </div>
                ) : item.type === 'assistant-message' ? (
                  <div className="py-2.5">
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
                                  if (
                                    prevEntry &&
                                    prevEntry.kind === 'user-message'
                                  ) {
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
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
