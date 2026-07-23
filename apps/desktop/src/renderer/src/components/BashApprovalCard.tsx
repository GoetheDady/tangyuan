import type { BashApprovalRequest } from '@tangyuan/contracts'
import { Ban, Check, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 审批操作类型：允许本次、始终允许或拒绝。
 */
type ApprovalAction = 'approve-once' | 'approve-always' | 'reject'

/**
 * 审批卡片当前阶段。
 */
type CardPhase = 'entering' | 'pending' | 'submitting' | 'resolved' | 'exiting'

/**
 * BashApprovalCard 组件的属性。
 */
export interface BashApprovalCardProps {
  /** 待审批的 Bash 请求。 */
  approval: BashApprovalRequest
  /** 允许本次操作的回调。 */
  onApproveOnce: (approvalId: string) => Promise<void>
  /** 始终允许的回调（当前会话中同命令免审）。 */
  onApproveAlways: (approvalId: string) => Promise<void>
  /** 拒绝操作的回调。 */
  onReject: (approvalId: string) => Promise<void>
}

/**
 * 按 Pencil 设计渲染 Bash 审批卡片。
 *
 * 卡片从 Composer 后方升到上方，展示完整命令、工作目录、风险说明和三个决策按钮。
 * 支持独立的按钮 loading 状态、键盘导航和屏幕阅读器语义。
 *
 * @param props - 组件属性。
 * @returns Bash 审批卡片组件树。
 * @throws 此组件不会主动抛出错误。
 */
export function BashApprovalCard({
  approval,
  onApproveOnce,
  onApproveAlways,
  onReject
}: BashApprovalCardProps): React.JSX.Element {
  const [phase, setPhase] = useState<CardPhase>('entering')
  const [activeAction, setActiveAction] = useState<ApprovalAction | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const firstButtonRef = useRef<HTMLButtonElement>(null)
  const enteringTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const exitingTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  // 入场动画完成后设置焦点
  useEffect(() => {
    enteringTimerRef.current = setTimeout(() => {
      setPhase('pending')
      firstButtonRef.current?.focus()
    }, 0) // 下一帧触发，确保 DOM 已就绪

    return () => {
      if (enteringTimerRef.current) clearTimeout(enteringTimerRef.current)
    }
  }, [])

  // 清理退出定时器
  useEffect(() => {
    return () => {
      if (exitingTimerRef.current) clearTimeout(exitingTimerRef.current)
    }
  }, [])

  /**
   * 执行审批操作，管理 loading 和错误状态。
   *
   * @param action - 审批操作类型。
   * @returns 无返回值。
   */
  const executeAction = useCallback(
    async (action: ApprovalAction): Promise<void> => {
      if (phase === 'submitting' || phase === 'resolved' || phase === 'exiting') return

      setPhase('submitting')
      setActiveAction(action)
      setErrorMessage(null)

      try {
        if (action === 'approve-once') {
          await onApproveOnce(approval.approvalId)
        } else if (action === 'approve-always') {
          await onApproveAlways(approval.approvalId)
        } else {
          await onReject(approval.approvalId)
        }

        setPhase('resolved')
        setActiveAction(null)

        // 处理完成后延迟退出，让用户看到"已处理"状态
        exitingTimerRef.current = setTimeout(() => {
          setPhase('exiting')
        }, 800)
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : '操作失败，请重试'
        setErrorMessage(message)
        setPhase('pending')
        setActiveAction(null)
      }
    },
    [phase, approval.approvalId, onApproveOnce, onApproveAlways, onReject]
  )

  /**
   * 处理键盘导航：阻止焦点离开卡片（仅在 pending 阶段）。
   *
   * @param event - 键盘事件。
   * @returns 无返回值。
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (phase !== 'pending') return

      if (event.key === 'Escape') {
        event.preventDefault()
        void executeAction('reject')
      }
    },
    [phase, executeAction]
  )

  const isSubmitting = phase === 'submitting'
  const isResolved = phase === 'resolved'
  const isExiting = phase === 'exiting'

  // 退出动画：opacity 0 + translateY
  if (isExiting) {
    return (
      <div
        className="mx-auto mb-3 max-w-3xl animate-[approval-card-exit_240ms_cubic-bezier(0.2,0,0,1)_forwards]"
        aria-hidden="true"
        data-testid="bash-approval-card"
      >
        <div className="rounded-lg border bg-card px-4 py-3 opacity-0">
          {/* 空壳占位 */}
        </div>
      </div>
    )
  }

  const animationClass =
    phase === 'entering'
      ? 'animate-[approval-card-enter_240ms_cubic-bezier(0.2,0,0,1)_both]'
      : ''

  return (
    <div
      className={`mx-auto mb-3 max-w-3xl ${animationClass}`}
      role="region"
      aria-label="Bash 命令执行审批"
      aria-live="polite"
      data-testid="bash-approval-card"
    >
      <div
        ref={cardRef}
        className={`rounded-lg border shadow-level-1 transition-colors duration-200 ${
          isResolved
            ? 'border-success-border bg-success-soft/30'
            : 'border-warning-border bg-warning-soft/20'
        }`}
        onKeyDown={handleKeyDown}
        tabIndex={phase === 'pending' ? 0 : -1}
      >
        {/* 头部：审批状态标签 */}
        <div className="flex items-center gap-2 border-b border-warning-border/40 px-4 py-2.5">
          {isResolved ? (
            <>
              <ShieldCheck
                size={14}
                className="shrink-0 text-success-foreground"
                aria-hidden="true"
              />
              <span className="text-label font-semibold text-success-foreground">
                已处理
              </span>
            </>
          ) : (
            <>
              <ShieldAlert
                size={14}
                className="shrink-0 text-warning-foreground"
                aria-hidden="true"
              />
              <span className="text-label font-semibold text-warning-foreground">
                待审批
              </span>
              <span className="text-label text-muted-foreground">
                Bash 命令执行审批
              </span>
            </>
          )}
        </div>

        {/* 主体内容 */}
        <div className="space-y-2.5 px-4 py-3">
          {/* 命令代码块 */}
          <div>
            <label
              htmlFor={`approval-command-${approval.approvalId}`}
              className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              待执行命令
            </label>
            <pre
              id={`approval-command-${approval.approvalId}`}
              className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-mono"
              tabIndex={0}
              aria-label={`命令：${approval.command}`}
            >
              <code>{approval.command}</code>
            </pre>
          </div>

          {/* 工作目录 */}
          <div className="flex items-center gap-1.5 text-label text-muted-foreground">
            <span className="text-[10px] font-semibold uppercase tracking-wider">
              工作目录
            </span>
            <span className="truncate font-mono" aria-label={`工作目录：${approval.cwd}`}>
              {approval.cwd}
            </span>
          </div>

          {/* 风险说明 */}
          <div
            className="rounded-md bg-destructive-soft/10 px-3 py-2 text-label text-muted-foreground"
            role="alert"
            aria-label={`风险说明：${approval.riskDescription}`}
          >
            <p className="flex items-start gap-1.5">
              <ShieldAlert
                size={12}
                className="mt-0.5 shrink-0 text-warning-foreground"
                aria-hidden="true"
              />
              <span>{approval.riskDescription}</span>
            </p>
          </div>

          {/* 安全警告 */}
          <p
            className="text-caption text-destructive-soft-foreground"
            role="alert"
          >
            此命令将以当前 macOS 用户权限执行，请确认操作安全。
          </p>

          {/* 错误消息 */}
          {errorMessage && (
            <div
              className="rounded-md bg-destructive-soft/20 px-3 py-2 text-label text-destructive-foreground"
              role="alert"
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* 底部操作按钮 */}
        <div className="flex items-center justify-end gap-2 border-t border-warning-border/40 px-4 py-2.5">
          {/* 拒绝按钮 */}
          <button
            ref={firstButtonRef}
            type="button"
            className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isResolved
                ? 'cursor-not-allowed border-border text-muted-foreground'
                : 'border-destructive-border bg-background text-destructive hover:bg-destructive-soft/20'
            }`}
            onClick={() => {
              void executeAction('reject')
            }}
            disabled={isSubmitting || isResolved}
            aria-label="拒绝此命令执行"
          >
            {isSubmitting && activeAction === 'reject' ? (
              <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
            ) : (
              <Ban size={12} aria-hidden="true" />
            )}
            拒绝
          </button>

          {/* 始终允许按钮 */}
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isResolved
                ? 'cursor-not-allowed bg-muted text-muted-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-split'
            }`}
            onClick={() => {
              void executeAction('approve-always')
            }}
            disabled={isSubmitting || isResolved}
            aria-label="始终允许此命令（当前会话中同命令免审）"
          >
            {isSubmitting && activeAction === 'approve-always' ? (
              <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck size={12} aria-hidden="true" />
            )}
            始终允许
          </button>

          {/* 允许本次按钮 */}
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isResolved
                ? 'cursor-not-allowed bg-muted text-muted-foreground'
                : 'bg-primary text-primary-foreground hover:bg-primary-hover'
            }`}
            onClick={() => {
              void executeAction('approve-once')
            }}
            disabled={isSubmitting || isResolved}
            aria-label="仅允许本次执行此命令"
          >
            {isSubmitting && activeAction === 'approve-once' ? (
              <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size={12} aria-hidden="true" />
            )}
            允许本次
          </button>
        </div>
      </div>
    </div>
  )
}
