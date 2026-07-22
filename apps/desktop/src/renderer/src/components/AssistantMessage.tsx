import type { AgentReplyEntry, RunTurn, TurnStep } from '@tangyuan/contracts'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  CircleX,
  LoaderCircle,
  RefreshCw
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { StreamdownMessage } from '@/components/StreamdownMessage'

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
type AssistantState = 'active-tool-loop' | 'unconfirmed-text' | 'final-confirmed' | 'ended-nonfinal'

function deriveState(entry: AgentReplyEntry, isStreaming: boolean): AssistantState {
  if (entry.attempt?.status === 'cancelled' || entry.attempt?.status === 'failed') {
    return 'ended-nonfinal'
  }

  if (!isStreaming && entry.attempt?.status === 'completed') {
    return 'final-confirmed'
  }

  if (isStreaming) {
    const hasToolCalls = entry.turns.some((turn) =>
      turn.steps.some((step) => step.kind === 'tool-call')
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
  onToggleStart
}: AssistantMessageProps): React.JSX.Element {
  const state = deriveState(entry, isStreaming)
  const shouldExpand =
    state === 'active-tool-loop' || state === 'unconfirmed-text' || state === 'ended-nonfinal'

  const [userToggled, setUserToggled] = useState(false)
  const isExpanded = shouldExpand || userToggled

  /**
   * 切换展开/收起状态，通知外层虚拟列表记录锚点。
   */
  function handleToggle(): void {
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
      const durationMs = new Date(lastCompletedAt).getTime() - new Date(lastStartedAt).getTime()
      if (durationMs > 0) {
        durationText =
          durationMs >= 60000
            ? `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
            : `${Math.round(durationMs / 1000)}s`
      }
    }

    return { stepCount: steps, turnCount, durationText }
  }, [entry.turns])

  const hasTurns = entry.turns.length > 0

  // 无 turns 时回退到纯文本气泡
  if (!hasTurns) {
    return (
      <article className="flex justify-start">
        <div className="max-w-[76%] min-w-0 rounded-lg border bg-card px-4 py-3 text-sm leading-6 text-card-foreground shadow-sm">
          <StreamdownMessage content={entry.content} isAnimating={isStreaming} />
        </div>
      </article>
    )
  }

  return (
    <article className="flex justify-start">
      <div className="max-w-[76%] min-w-0 rounded-lg border bg-card text-card-foreground shadow-sm">
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

        {/* Expanded Timeline */}
        {isExpanded && <TurnTimeline turns={entry.turns} />}

        {/* Final Body (shown when collapsed + final) */}
        {state === 'final-confirmed' && !isExpanded && entry.content && (
          <div className="px-4 pb-4">
            <StreamdownMessage content={entry.content} isAnimating={false} />
          </div>
        )}

        {/* Unconfirmed text (shown while streaming) */}
        {(state === 'unconfirmed-text' || state === 'active-tool-loop') && entry.content && (
          <div className="px-4 pb-3">
            <div className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
              此文本尚未确认，后续仍可能出现工具调用。
            </div>
          </div>
        )}

        {/* Cancelled / Failed footer */}
        {state === 'ended-nonfinal' && (
          <div className="px-4 pb-4">
            {entry.content ? (
              <StreamdownMessage content={entry.content} isAnimating={false} />
            ) : null}
            {entry.attempt?.status === 'cancelled' ? (
              <div className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
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
  attemptStatus
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
    bgClass = 'bg-muted'
  } else if (state === 'final-confirmed') {
    StatusIcon = Check
    label = '已完成执行过程'
    bgClass = 'bg-muted'
  } else if (attemptStatus === 'cancelled') {
    StatusIcon = CircleStop
    label = '已中断执行过程'
    bgClass = 'bg-warning-soft'
  } else {
    StatusIcon = CircleX
    label = '执行失败'
    bgClass = 'bg-muted'
  }

  const metaParts: string[] = []
  if (turnCount > 1) metaParts.push(`${turnCount} 回合`)
  if (stepCount > 0) metaParts.push(`${stepCount} 步`)
  if (durationText) metaParts.push(durationText)
  const meta = metaParts.join(' · ')

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-1.5 rounded-t-lg px-3 py-2 text-left transition-colors duration-200 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${bgClass}`}
    >
      <ChevronIcon size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      <StatusIcon
        size={14}
        className={`shrink-0 ${
          state === 'active-tool-loop' || state === 'unconfirmed-text'
            ? 'animate-spin text-primary'
            : attemptStatus === 'cancelled'
              ? 'text-warning-foreground'
              : attemptStatus === 'failed'
                ? 'text-destructive-soft-foreground'
                : 'text-muted-foreground'
        }`}
        aria-hidden="true"
      />
      <span className="text-xs font-semibold text-foreground">{label}</span>
      <span className="flex-1" />
      {meta && <span className="text-[10px] text-muted-foreground">{meta}</span>}
    </button>
  )
}

/**
 * 时间线视图：按 turn 分组展示步骤。
 */
function TurnTimeline({ turns }: { turns: RunTurn[] }): React.JSX.Element {
  return (
    <div className="border-t px-3 py-2">
      <div className="space-y-3">
        {turns.map((turn, turnIdx) => (
          <div key={turnIdx}>
            {/* Turn header */}
            <div className="mb-1.5 flex items-center gap-1.5">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  turn.status === 'running'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {turnIdx === turns.length - 1 ? '最终回合' : `回合 ${turnIdx + 1}`}
              </span>
              {turn.status === 'running' && (
                <LoaderCircle size={10} className="animate-spin text-primary" aria-hidden="true" />
              )}
            </div>

            {/* Steps */}
            <div className="space-y-1">
              {turn.steps.map((step, stepIdx) => (
                <StepRow key={stepIdx} step={step} />
              ))}
              {turn.steps.length === 0 && turn.status === 'running' && (
                <div className="flex items-center gap-1.5 py-0.5 pl-1">
                  <LoaderCircle
                    size={10}
                    className="animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="text-[11px] text-muted-foreground">等待中…</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 时间线中的单个步骤行。
 *
 * 工具步骤显示：工具名、安全摘要、状态图标和耗时。
 * 不暴露完整参数、原始输出或内部调试日志。
 */
function StepRow({ step }: { step: TurnStep }): React.JSX.Element {
  let icon: React.JSX.Element
  let bgClass: string
  let contentPreview: string

  switch (step.kind) {
    case 'thinking':
      icon = (
        <span className="grid size-4 shrink-0 place-items-center text-[10px] text-muted-foreground">
          💭
        </span>
      )
      bgClass = 'bg-muted/50'
      contentPreview = step.content
        ? step.content.length > 80
          ? `${step.content.slice(0, 80)}…`
          : step.content
        : '思考中…'
      break
    case 'tool-call': {
      const toolDisplayName = step.toolName ?? step.content
      icon = (
        <span className="grid size-4 shrink-0 place-items-center text-[10px] text-muted-foreground">
          🔧
        </span>
      )
      bgClass = step.status === 'failed' ? 'bg-destructive-soft/20' : 'bg-accent/30'
      contentPreview = step.toolName ? `${toolDisplayName} · ${step.content}` : step.content
      break
    }
    case 'text':
      icon = (
        <span className="grid size-4 shrink-0 place-items-center text-[10px] text-muted-foreground">
          💬
        </span>
      )
      bgClass = ''
      contentPreview = step.content.length > 80 ? `${step.content.slice(0, 80)}…` : step.content
      break
    default:
      icon = <span className="grid size-4 shrink-0 place-items-center text-[10px]" />
      bgClass = ''
      contentPreview = ''
  }

  const durationMs =
    step.completedAt && step.startedAt
      ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
      : null
  const durationLabel =
    durationMs && durationMs > 0
      ? durationMs >= 60000
        ? `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
        : `${Math.round(durationMs / 1000)}s`
      : null

  return (
    <div className={`flex items-start gap-1.5 rounded px-1.5 py-0.5 text-[11px] ${bgClass}`}>
      {icon}
      <span className="flex-1 truncate text-muted-foreground">{contentPreview}</span>
      {durationLabel && (
        <span className="shrink-0 text-[10px] text-muted-foreground/60">{durationLabel}</span>
      )}
      <span className="shrink-0 text-[10px] text-muted-foreground/60">
        {step.status === 'running' ? (
          <LoaderCircle size={10} className="animate-spin" aria-label="运行中" />
        ) : step.status === 'completed' ? (
          <Check size={10} aria-label="完成" />
        ) : (
          <CircleX size={10} className="text-destructive-soft-foreground" aria-label="失败" />
        )}
      </span>
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
  onRetry
}: {
  entry: AgentReplyEntry
  onRetry?: () => void
}): React.JSX.Element {
  const [showDetails, setShowDetails] = useState(false)
  const errorMessage = entry.attempt?.error?.message ?? '执行失败，已收到的内容保留在上方'

  // 展开失败步骤：展示所有失败的 turn steps
  const failedSteps = entry.turns.flatMap((turn) =>
    turn.steps.filter((step) => step.status === 'failed')
  )

  return (
    <div className="mt-2 space-y-2">
      {/* 失败摘要 */}
      <div className="rounded-md bg-destructive-soft/10 px-3 py-2">
        <div className="flex items-start gap-1.5">
          <CircleX
            size={12}
            className="mt-0.5 shrink-0 text-destructive-soft-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-destructive-foreground">执行失败</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{errorMessage}</p>
          </div>
        </div>

        {/* 失败步骤详情（可展开） */}
        {failedSteps.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setShowDetails((prev) => !prev)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
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
      <div className="rounded-md bg-muted px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          Agent 在产生最终回复前失败。您可以重试本次执行，原始用户请求将被复用。
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw size={11} aria-hidden="true" />
            重试
          </button>
        )}
      </div>
    </div>
  )
}
