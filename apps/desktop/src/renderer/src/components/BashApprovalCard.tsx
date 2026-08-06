import type { BashApprovalRequest } from '@yuanxiao/contracts'
import {
  Ban,
  Check,
  LoaderCircle,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

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
  /** 授予当前 Agent、工作目录和完整命令长期许可的回调。 */
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
  onReject,
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
      if (phase === 'submitting' || phase === 'resolved' || phase === 'exiting')
        return

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
    [phase, approval.approvalId, onApproveOnce, onApproveAlways, onReject],
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
    [phase, executeAction],
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
        <div className="bg-card rounded-lg border px-4 py-3 opacity-0">
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
        className={`shadow-level-1 rounded-lg border transition-colors duration-200 ${
          isResolved
            ? 'border-success-border bg-success-soft/30'
            : 'border-warning-border bg-warning-soft/20'
        }`}
        onKeyDown={handleKeyDown}
        tabIndex={phase === 'pending' ? 0 : -1}
      >
        {/* 头部：审批状态标签 */}
        <div className="border-warning-border/40 flex items-center gap-2 border-b px-4 py-2.5">
          {isResolved ? (
            <>
              <ShieldCheck
                size={14}
                className="text-success-foreground shrink-0"
                aria-hidden="true"
              />
              <span className="text-label text-success-foreground font-semibold">
                已处理
              </span>
            </>
          ) : (
            <>
              <ShieldAlert
                size={14}
                className="text-warning-foreground shrink-0"
                aria-hidden="true"
              />
              <span className="text-label text-warning-foreground font-semibold">
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
              className="text-muted-foreground mb-1 block text-caption font-semibold tracking-wider uppercase"
            >
              待执行命令
            </label>
            <pre
              id={`approval-command-${approval.approvalId}`}
              className="bg-muted text-mono overflow-x-auto rounded-md px-3 py-2 font-mono"
              tabIndex={0}
              aria-label={`命令：${approval.command}`}
            >
              <code>{approval.command}</code>
            </pre>
          </div>

          {/* 工作目录 */}
          <div className="text-label text-muted-foreground flex items-center gap-1.5">
            <span className="text-caption font-semibold tracking-wider uppercase">
              工作目录
            </span>
            <span
              className="truncate font-mono"
              aria-label={`工作目录：${approval.cwd}`}
            >
              {approval.cwd}
            </span>
          </div>

          {/* 风险说明 */}
          <div
            className="bg-destructive-soft/10 text-label text-muted-foreground rounded-md px-3 py-2"
            role="alert"
            aria-label={`风险说明：${approval.riskDescription}`}
          >
            <p className="flex items-start gap-1.5">
              <ShieldAlert
                size={12}
                className="text-warning-foreground mt-0.5 shrink-0"
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
              className="bg-destructive-soft/20 text-label text-destructive-foreground rounded-md px-3 py-2"
              role="alert"
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* 底部操作按钮 */}
        <div className="border-warning-border/40 flex items-center justify-end gap-2 border-t px-4 py-2.5">
          {/* 拒绝按钮 */}
          <Button
            ref={firstButtonRef}
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive-border text-destructive hover:bg-destructive-soft/20 active:bg-destructive-soft/30 focus-visible:ring-destructive/20"
            onClick={() => {
              void executeAction('reject')
            }}
            disabled={isSubmitting || isResolved}
            aria-label="拒绝此命令执行"
          >
            {isSubmitting && activeAction === 'reject' ? (
              <LoaderCircle
                size={12}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Ban size={12} aria-hidden="true" />
            )}
            拒绝
          </Button>

          {approval.riskLevel !== 'high' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void executeAction('approve-always')
              }}
              disabled={isSubmitting || isResolved}
              aria-label="始终允许此 Agent 在当前工作目录执行此命令"
            >
              {isSubmitting && activeAction === 'approve-always' ? (
                <LoaderCircle
                  size={12}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <ShieldCheck size={12} aria-hidden="true" />
              )}
              始终允许
            </Button>
          )}

          {/* 允许本次按钮 */}
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => {
              void executeAction('approve-once')
            }}
            disabled={isSubmitting || isResolved}
            aria-label="仅允许本次执行此命令"
          >
            {isSubmitting && activeAction === 'approve-once' ? (
              <LoaderCircle
                size={12}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Check size={12} aria-hidden="true" />
            )}
            允许本次
          </Button>
        </div>
      </div>
    </div>
  )
}
