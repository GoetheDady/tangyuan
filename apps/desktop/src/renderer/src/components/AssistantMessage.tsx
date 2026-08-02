import type { AgentReplyEntry, RunTurn, TurnStep } from '@yuanxiao/contracts'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleStop,
  CircleX,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'

import { StreamdownMessage } from '@/components/StreamdownMessage'

/**
 * 执行历史时间线展开/收起动画时长（毫秒）。
 *
 * TranscriptMessages 的虚拟列表需依据同一时长决定锚点校正的持续窗口，
 * 故在此导出供两处共享，避免时长失同。
 */
export const TIMELINE_TOGGLE_ANIMATION_MS = 200

/**
 * AssistantMessage 组件的属性。
 */
export interface AssistantMessageProps {
  /** 完整的 Agent 回复条目（含 turns）。 */
  entry: AgentReplyEntry
  /** 是否正在流式执行中。 */
  isStreaming: boolean
  /** 重试回调；仅对失败且非取消的条目生效。 */
  onRetry?: () => void
  /** 展开/收起切换前回调，用于虚拟列表记录滚动锚点。 */
  onToggleStart?: () => void
}

/**
 * 根据 turns 和流式状态推导组件的交互状态。
 */
type AssistantState =
  'active-tool-loop' | 'unconfirmed-text' | 'final-confirmed' | 'ended-nonfinal'

function deriveState(
  entry: AgentReplyEntry,
  isStreaming: boolean,
): AssistantState {
  if (
    entry.attempt?.status === 'cancelled' ||
    entry.attempt?.status === 'failed'
  ) {
    return 'ended-nonfinal'
  }

  if (!isStreaming && entry.attempt?.status === 'completed') {
    return 'final-confirmed'
  }

  if (isStreaming) {
    const hasToolCalls = entry.turns.some((turn) =>
      turn.steps.some((step) => step.kind === 'tool-call'),
    )
    if (hasToolCalls) {
      return 'active-tool-loop'
    }
    if (entry.turns.length > 0) {
      return 'unconfirmed-text'
    }
    return 'active-tool-loop'
  }

  return 'final-confirmed'
}

/**
 * 完成态下从时间线剔除末回合的最终回复文字步骤。
 *
 * 末回合最后一个文字步骤就是 entry.content（最终回复），已独立展示在卡片下方，
 * 保留在时间线里会造成重复，故只剔除它。末回合内在它之前的中间文字（如
 * text→工具→text 的开头 text）以及非末回合的中间文字均原样保留。
 *
 * @param turns - 原始回合列表。
 * @returns 剔除末回合最终回复文字步骤后的回合列表。
 */
function stripFinalReplyFromTurns(turns: RunTurn[]): RunTurn[] {
  if (turns.length === 0) return turns
  const lastIndex = turns.length - 1
  const lastTurn = turns[lastIndex]
  let finalTextStepIndex = -1
  for (let i = lastTurn.steps.length - 1; i >= 0; i--) {
    if (lastTurn.steps[i].kind === 'text') {
      finalTextStepIndex = i
      break
    }
  }
  if (finalTextStepIndex === -1) return turns
  const remainingSteps = lastTurn.steps.filter(
    (_, i) => i !== finalTextStepIndex,
  )
  const next = [...turns]
  next[lastIndex] = { ...lastTurn, steps: remainingSteps }
  return next
}

/**
 * 按 Pencil 设计渲染 Agent 回复卡片，含执行历史展开/收起与时间线。
 *
 * @param props - 组件属性。
 * @returns Agent 回复卡片。
 * @throws 此组件不会主动抛出错误。
 */
export function AssistantMessage({
  entry,
  isStreaming,
  onRetry,
  onToggleStart,
}: AssistantMessageProps): React.JSX.Element {
  const state = deriveState(entry, isStreaming)
  const shouldExpand =
    state === 'active-tool-loop' ||
    state === 'unconfirmed-text' ||
    state === 'ended-nonfinal'

  const [userToggled, setUserToggled] = useState(false)
  const isExpanded = shouldExpand || userToggled

  /**
   * 切换展开/收起状态，通知外层虚拟列表记录锚点。
   */
  function handleToggle(): void {
    // 流式执行中始终展开；忽略这期间的点击，避免阻塞完成后的自动收起。
    if (isStreaming && shouldExpand) return

    onToggleStart?.()
    setUserToggled((prev) => !prev)
  }

  const { stepCount, turnCount, durationText } = useMemo(() => {
    let steps = 0
    let lastStartedAt: string | null = null
    let lastCompletedAt: string | null = null

    for (const turn of entry.turns) {
      steps += turn.steps.length
      if (!lastStartedAt || turn.startedAt < lastStartedAt) {
        lastStartedAt = turn.startedAt
      }
      const completedStep = turn.steps.find((s) => s.completedAt)
      if (
        completedStep?.completedAt &&
        (!lastCompletedAt || completedStep.completedAt > lastCompletedAt)
      ) {
        lastCompletedAt = completedStep.completedAt
      }
    }

    const turnCount = entry.turns.length

    let durationText = ''
    if (lastStartedAt && lastCompletedAt) {
      const durationMs =
        new Date(lastCompletedAt).getTime() - new Date(lastStartedAt).getTime()
      if (durationMs > 0) {
        durationText =
          durationMs >= 60000
            ? `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
            : `${String(Math.round(durationMs / 1000)).padStart(2, '0')}s`
      }
    }

    return { stepCount: steps, turnCount, durationText }
  }, [entry.turns])

  const hasTurns = entry.turns.length > 0
  const retryCount = entry.attempt?.retryCount ?? 0
  const retryIndicator =
    retryCount > 0 ? (
      <div
        className="text-caption text-muted-foreground px-1"
        role="status"
        data-testid="retry-result"
      >
        {entry.attempt?.status === 'running'
          ? `正在重试（第 ${retryCount} 次）`
          : `自动重试了 ${retryCount} 次`}
      </div>
    ) : null

  // 完成态下时间线剔除末回合文字步骤（去重）；其他态原样展示全部步骤。
  const timelineTurns =
    state === 'final-confirmed'
      ? stripFinalReplyFromTurns(entry.turns)
      : entry.turns

  // 无 turns 时回退到纯文本气泡
  if (!hasTurns) {
    return (
      <article className="flex justify-start" aria-busy={isStreaming}>
        <div className="bg-background text-body text-foreground flex w-full max-w-[640px] min-w-0 flex-col gap-2.5 rounded-[7px] p-3.5">
          {retryIndicator}
          <StreamdownMessage
            content={entry.content}
            isAnimating={isStreaming}
          />
        </div>
      </article>
    )
  }

  return (
    <article className="flex justify-start" aria-busy={isStreaming}>
      <div className="bg-background text-foreground flex w-full max-w-[640px] min-w-0 flex-col gap-2.5 rounded-[7px] p-3.5">
        {/* Execution Disclosure Bar */}
        <ExecutionDisclosure
          state={state}
          isExpanded={isExpanded}
          onToggle={handleToggle}
          turnCount={turnCount}
          stepCount={stepCount}
          durationText={durationText}
          attemptStatus={entry.attempt?.status ?? 'running'}
        />

        {retryIndicator}

        {/* Expanded Timeline */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="timeline"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{
                duration: TIMELINE_TOGGLE_ANIMATION_MS / 1000,
                ease: 'easeInOut',
              }}
              className="overflow-hidden"
            >
              <TurnTimeline turns={timelineTurns} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Final Body (完成态下始终独立展示，不随展开/收起变化) */}
        {state === 'final-confirmed' && entry.content && (
          <div className="text-body">
            <StreamdownMessage content={entry.content} isAnimating={false} />
          </div>
        )}

        {/* Unconfirmed text (shown while streaming) */}
        {(state === 'unconfirmed-text' || state === 'active-tool-loop') &&
          entry.content && (
            <div className="border-warning-border bg-warning-soft text-caption text-warning-foreground rounded-md border px-2.5 py-2">
              此文本尚未确认，后续仍可能出现工具调用。
            </div>
          )}

        {/* Cancelled / Failed footer */}
        {state === 'ended-nonfinal' && (
          <div className="text-body">
            {entry.content ? (
              <StreamdownMessage content={entry.content} isAnimating={false} />
            ) : null}
            {entry.attempt?.status === 'cancelled' ? (
              <div
                className="bg-warning-soft text-label text-warning-foreground mt-2 rounded-md px-3 py-2"
                role="status"
              >
                此回复已在生成过程中被用户中断
              </div>
            ) : (
              <FailedFooter entry={entry} onRetry={onRetry} />
            )}
          </div>
        )}
      </div>
    </article>
  )
}

/**
 * 执行历史展开/收起控制栏。
 */
function ExecutionDisclosure({
  state,
  isExpanded,
  onToggle,
  turnCount,
  stepCount,
  durationText,
  attemptStatus,
}: {
  state: AssistantState
  isExpanded: boolean
  onToggle: () => void
  turnCount: number
  stepCount: number
  durationText: string
  attemptStatus: string
}): React.JSX.Element {
  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight

  let StatusIcon: typeof LoaderCircle
  let label: string
  let bgClass: string

  if (state === 'active-tool-loop' || state === 'unconfirmed-text') {
    StatusIcon = LoaderCircle
    label = '仍在执行'
    bgClass = 'bg-secondary'
  } else if (state === 'final-confirmed') {
    StatusIcon = Check
    label = '已完成执行过程'
    bgClass = 'bg-secondary'
  } else if (attemptStatus === 'cancelled') {
    StatusIcon = CircleStop
    label = '已中断执行过程'
    bgClass = 'bg-warning-soft'
  } else {
    StatusIcon = CircleX
    label = '执行失败'
    bgClass = 'bg-destructive-soft'
  }

  const metaParts: string[] = []
  if (turnCount > 1) metaParts.push(`${turnCount} 回合`)
  if (stepCount > 0) metaParts.push(`${stepCount} 步`)
  if (durationText) metaParts.push(durationText)
  const meta = metaParts.join(' · ')

  return (
    <button
      type="button"
      aria-expanded={isExpanded}
      onClick={onToggle}
      className={`hover:bg-accent focus-visible:ring-ring/50 flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-left transition-colors duration-200 focus-visible:ring-[3px] focus-visible:outline-none ${bgClass}`}
    >
      <ChevronIcon
        size={13}
        className="text-muted-foreground shrink-0"
        aria-hidden="true"
      />
      <StatusIcon
        size={13}
        className={`shrink-0 ${
          state === 'active-tool-loop' || state === 'unconfirmed-text'
            ? 'text-primary animate-spin'
            : attemptStatus === 'cancelled'
              ? 'text-warning-foreground'
              : attemptStatus === 'failed'
                ? 'text-destructive-soft-foreground'
                : 'text-muted-foreground'
        }`}
        aria-hidden="true"
      />
      <span className="text-caption text-foreground font-semibold">
        {label}
      </span>
      <span className="flex-1" />
      {meta && (
        <span className="text-muted-foreground font-mono text-[9px]">
          {meta}
        </span>
      )}
    </button>
  )
}

/**
 * 时间线视图：按 turn 分组展示步骤。
 *
 * 每个步骤为「Rail（状态图标 + 竖直连接线） + Step body（标签行 + 内容行）」两栏布局。
 */
function TurnTimeline({ turns }: { turns: RunTurn[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 px-2.5 pt-1 pb-0.5">
      {turns.map((turn, turnIdx) => (
        <div key={turnIdx} className="flex flex-col gap-2">
          {/* Turn header：英文标签 + 水平分隔线 */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-[8px] font-semibold tracking-wider uppercase">
              {turnIdx === turns.length - 1
                ? 'FINAL TURN'
                : `TURN ${turnIdx + 1}`}
            </span>
            <span className="bg-split h-px flex-1" aria-hidden="true" />
          </div>

          {/* Steps */}
          <div className="flex flex-col">
            {turn.steps.map((step, stepIdx) => (
              <StepRow
                key={stepIdx}
                step={step}
                isLast={stepIdx === turn.steps.length - 1}
              />
            ))}
            {turn.steps.length === 0 && turn.status === 'running' && (
              <div className="flex items-center gap-2">
                <span className="grid size-3.5 shrink-0 place-items-center">
                  <CircleDashed
                    size={13}
                    className="text-muted-foreground"
                    aria-hidden="true"
                  />
                </span>
                <span className="text-muted-foreground text-[10px]">
                  等待中…
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 时间线中的单个步骤行。
 *
 * 左侧 Rail 为状态图标加竖直连接线，右侧 Step body 分标签行与内容行。
 * 工具步骤显示：工具名、安全摘要、状态图标和耗时。
 * 不暴露完整参数、原始输出或内部调试日志。
 */
function StepRow({
  step,
  isLast = true,
}: {
  step: TurnStep
  isLast?: boolean
}): React.JSX.Element {
  const durationMs =
    step.completedAt && step.startedAt
      ? new Date(step.completedAt).getTime() -
        new Date(step.startedAt).getTime()
      : null
  const durationLabel =
    durationMs && durationMs > 0
      ? durationMs >= 60000
        ? `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
        : `${Math.round(durationMs / 1000)}s`
      : null

  // 标签与内容：thinking 标签为「思考」，tool-call 标签为工具名，text 标签为「回复」。
  let label: string
  let note: string
  let labelClass: string
  switch (step.kind) {
    case 'thinking':
      label = '思考'
      note = step.content || (step.status === 'running' ? '思考中…' : '')
      labelClass = 'font-medium text-success'
      break
    case 'tool-call':
      label = step.toolName ?? '工具'
      note = step.toolName ? step.content : ''
      labelClass = 'font-semibold capitalize text-foreground'
      break
    case 'text':
      label = '回复'
      note = step.content
      labelClass = 'font-semibold text-foreground'
      break
    default:
      label = ''
      note = ''
      labelClass = 'text-muted-foreground'
  }

  // 状态图标与 meta 文案。
  let StatusIcon: typeof CircleCheck
  let iconClass: string
  let iconLabel: string
  if (step.status === 'failed') {
    StatusIcon = CircleX
    iconClass = 'text-destructive-soft-foreground'
    iconLabel = '失败'
  } else if (step.status === 'running') {
    StatusIcon = CircleDashed
    iconClass = step.kind === 'thinking' ? 'text-success' : 'text-foreground'
    iconLabel = '运行中'
  } else {
    StatusIcon = CircleCheck
    iconClass = 'text-success'
    iconLabel = '完成'
  }

  const meta =
    durationLabel ??
    (step.status === 'running'
      ? '执行中'
      : step.status === 'failed'
        ? '失败'
        : '已完成')

  return (
    <div className="flex gap-2">
      {/* Rail：图标 + 竖直连接线 */}
      <div className="flex flex-col items-center">
        <span className="grid size-3.5 shrink-0 place-items-center">
          <StatusIcon size={13} className={iconClass} aria-label={iconLabel} />
        </span>
        {!isLast && (
          <span className="bg-border mt-1 w-px flex-1" aria-hidden="true" />
        )}
      </div>

      {/* Step body：标签行 + 内容行 */}
      <div className="min-w-0 flex-1 pb-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-[10px] ${labelClass}`}>{label}</span>
          <span className="text-muted-foreground shrink-0 text-[8px]">
            {meta}
          </span>
        </div>
        {note && (
          <p className="text-muted-foreground mt-0.5 text-[10px] leading-[1.5]">
            {note}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * 失败状态的底部区域：展示失败摘要、失败步骤和重试操作。
 *
 * 按照 Pencil 设计：失败且没有最终回复时展示可展开的失败摘要和重试按钮。
 */
function FailedFooter({
  entry,
  onRetry,
}: {
  entry: AgentReplyEntry
  onRetry?: () => void
}): React.JSX.Element {
  const [showDetails, setShowDetails] = useState(false)
  const errorMessage =
    entry.attempt?.error?.message ?? '执行失败，已收到的内容保留在上方'

  // 展开失败步骤：展示所有失败的 turn steps
  const failedSteps = entry.turns.flatMap((turn) =>
    turn.steps.filter((step) => step.status === 'failed'),
  )

  return (
    <div className="mt-2 space-y-2">
      {/* 失败摘要 */}
      <div className="bg-destructive-soft/10 rounded-md px-3 py-2" role="alert">
        <div className="flex items-start gap-1.5">
          <CircleX
            size={12}
            className="text-destructive-soft-foreground mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-label text-destructive-foreground font-medium">
              执行失败
            </p>
            <p className="text-label text-muted-foreground mt-0.5">
              {errorMessage}
            </p>
          </div>
        </div>

        {/* 失败步骤详情（可展开） */}
        {failedSteps.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setShowDetails((prev) => !prev)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[10px] transition-colors"
            >
              {showDetails ? (
                <ChevronDown size={10} aria-hidden="true" />
              ) : (
                <ChevronRight size={10} aria-hidden="true" />
              )}
              失败步骤（{failedSteps.length}）
            </button>
            {showDetails && (
              <div className="mt-1 space-y-0.5">
                {failedSteps.map((step) => (
                  <StepRow key={step.index} step={step} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 重试操作 */}
      <div className="bg-muted rounded-md px-3 py-2">
        <p className="text-caption text-muted-foreground">
          Agent 在产生最终回复前失败。您可以重试本次执行，原始用户请求将被复用。
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="bg-primary text-label text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring mt-1.5 inline-flex items-center gap-1 rounded-md px-3 py-1 font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <RefreshCw size={11} aria-hidden="true" />
            重试
          </button>
        )}
      </div>
    </div>
  )
}
