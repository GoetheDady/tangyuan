import type { QuestionClarificationRequest } from '@tangyuan/contracts'
import { Check, HelpCircle, LoaderCircle, MessageSquare, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 澄清卡片当前阶段。
 */
type CardPhase = 'entering' | 'pending' | 'submitting' | 'resolved' | 'exiting'

/**
 * QuestionClarificationCard 组件的属性。
 */
export interface QuestionClarificationCardProps {
  /** 待回答的澄清请求。 */
  clarification: QuestionClarificationRequest
  /** 提交答案的回调。 */
  onAnswer: (clarificationId: string, answer: string) => Promise<void>
  /** 取消澄清的回调。 */
  onCancel: (clarificationId: string) => Promise<void>
}

/**
 * 按 Pencil 设计渲染单问题澄清卡片。
 *
 * 卡片从 Composer 后方升到上方，展示问题、预设选项和可选"其他"自由输入。
 * 点击预设选项立即提交；选择"其他"后在内联输入中提交非空文本。
 * 支持键盘导航和屏幕阅读器语义。
 *
 * @param props - 组件属性。
 * @returns 单问题澄清卡片组件树。
 * @throws 此组件不会主动抛出错误。
 */
export function QuestionClarificationCard({
  clarification,
  onAnswer,
  onCancel
}: QuestionClarificationCardProps): React.JSX.Element {
  const [phase, setPhase] = useState<CardPhase>('entering')
  const [customAnswer, setCustomAnswer] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [activeOption, setActiveOption] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)
  const enteringTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const exitingTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  // 当"其他"输入展开时聚焦输入框
  useEffect(() => {
    if (showCustomInput && customInputRef.current && phase === 'pending') {
      customInputRef.current.focus()
    }
  }, [showCustomInput, phase])

  // 清理退出定时器
  useEffect(() => {
    return () => {
      if (exitingTimerRef.current) clearTimeout(exitingTimerRef.current)
    }
  }, [])

  // 当 clarification 变化时重置状态（同时处理首次挂载和连续多个单问题）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clarificationId changes start a new interaction state
    setPhase('entering')
    setCustomAnswer('')
    setShowCustomInput(false)
    setActiveOption(null)
    setErrorMessage(null)

    enteringTimerRef.current = setTimeout(() => {
      setPhase('pending')
      firstOptionRef.current?.focus()
    }, 0)

    return () => {
      if (enteringTimerRef.current) clearTimeout(enteringTimerRef.current)
    }
  }, [clarification.clarificationId])

  /**
   * 提交预设选项答案。
   *
   * @param option - 用户选择的预设选项。
   * @returns 无返回值。
   */
  const submitOption = useCallback(
    async (option: string): Promise<void> => {
      if (phase === 'submitting' || phase === 'resolved' || phase === 'exiting') return

      setPhase('submitting')
      setActiveOption(option)
      setErrorMessage(null)

      try {
        await onAnswer(clarification.clarificationId, option)

        setPhase('resolved')
        setActiveOption(null)

        exitingTimerRef.current = setTimeout(() => {
          setPhase('exiting')
        }, 800)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '操作失败，请重试'
        setErrorMessage(message)
        setPhase('pending')
        setActiveOption(null)
      }
    },
    [phase, clarification.clarificationId, onAnswer]
  )

  /**
   * 提交自定义答案。
   *
   * @returns 无返回值。
   */
  const submitCustomAnswer = useCallback(async (): Promise<void> => {
    const trimmed = customAnswer.trim()

    if (!trimmed) return

    if (phase === 'submitting' || phase === 'resolved' || phase === 'exiting') return

    setPhase('submitting')
    setErrorMessage(null)

    try {
      await onAnswer(clarification.clarificationId, trimmed)

      setPhase('resolved')
      setCustomAnswer('')

      exitingTimerRef.current = setTimeout(() => {
        setPhase('exiting')
      }, 800)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '操作失败，请重试'
      setErrorMessage(message)
      setPhase('pending')
    }
  }, [phase, customAnswer, clarification.clarificationId, onAnswer])

  /**
   * 取消澄清。
   *
   * @returns 无返回值。
   */
  const handleCancel = useCallback(async (): Promise<void> => {
    if (phase === 'submitting' || phase === 'resolved' || phase === 'exiting') return

    setPhase('submitting')
    setErrorMessage(null)

    try {
      await onCancel(clarification.clarificationId)

      setPhase('resolved')

      exitingTimerRef.current = setTimeout(() => {
        setPhase('exiting')
      }, 800)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '操作失败，请重试'
      setErrorMessage(message)
      setPhase('pending')
    }
  }, [phase, clarification.clarificationId, onCancel])

  /**
   * 处理键盘事件：支持 Enter 提交自定义答案、Escape 取消。
   *
   * @param event - 键盘事件。
   * @returns 无返回值。
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (phase !== 'pending') return

      if (event.key === 'Escape') {
        event.preventDefault()
        void handleCancel()
      }

      if (event.key === 'Enter' && showCustomInput && customAnswer.trim().length > 0) {
        event.preventDefault()
        void submitCustomAnswer()
      }
    },
    [phase, showCustomInput, customAnswer, handleCancel, submitCustomAnswer]
  )

  const isSubmitting = phase === 'submitting'
  const isResolved = phase === 'resolved'
  const isExiting = phase === 'exiting'

  if (isExiting) {
    return (
      <div
        className="mx-auto mb-3 max-w-3xl animate-[approval-card-exit_240ms_cubic-bezier(0.2,0,0,1)_forwards]"
        aria-hidden="true"
        data-testid="clarification-card"
      >
        <div className="rounded-lg border bg-card px-4 py-3 opacity-0" />
      </div>
    )
  }

  const animationClass =
    phase === 'entering' ? 'animate-[approval-card-enter_240ms_cubic-bezier(0.2,0,0,1)_both]' : ''

  return (
    <div
      className={`mx-auto mb-3 max-w-3xl ${animationClass}`}
      role="region"
      aria-label="问题澄清"
      aria-live="polite"
      data-testid="clarification-card"
    >
      <div
        ref={cardRef}
        className={`rounded-lg border shadow-level-1 transition-colors duration-200 ${
          isResolved
            ? 'border-success-border bg-success-soft/30'
            : 'border-primary-border/40 bg-primary-soft/10'
        }`}
        onKeyDown={handleKeyDown}
      >
        {/* 头部 */}
        <div className="flex items-center gap-2 border-b border-primary-border/30 px-4 py-2.5">
          {isResolved ? (
            <>
              <Check size={14} className="shrink-0 text-success-foreground" aria-hidden="true" />
              <span className="text-xs font-semibold text-success-foreground">已回答</span>
            </>
          ) : (
            <>
              <HelpCircle size={14} className="shrink-0 text-primary" aria-hidden="true" />
              <span className="text-xs font-semibold text-primary">待回答</span>
              <span className="text-xs text-muted-foreground">Agent 需要更多信息</span>
            </>
          )}
        </div>

        {/* 主体内容 */}
        <div className="space-y-3 px-4 py-3">
          {/* 问题文本 */}
          <div>
            <p
              className="text-sm leading-relaxed text-foreground"
              aria-label={`问题：${clarification.question}`}
            >
              {clarification.question}
            </p>
          </div>

          {/* 预设选项 */}
          <div className="space-y-1.5" role="radiogroup" aria-label="回答选项">
            {clarification.options.map((option, index) => (
              <button
                key={option}
                ref={index === 0 ? firstOptionRef : undefined}
                type="button"
                className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isResolved
                    ? 'cursor-not-allowed border-border text-muted-foreground'
                    : 'border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                onClick={() => {
                  void submitOption(option)
                }}
                disabled={isSubmitting || isResolved}
                role="radio"
                aria-checked={false}
                aria-label={`选择：${option}`}
              >
                {isSubmitting && activeOption === option ? (
                  <LoaderCircle size={14} className="animate-spin shrink-0" aria-hidden="true" />
                ) : (
                  <MessageSquare
                    size={14}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="flex-1">{option}</span>
              </button>
            ))}
          </div>

          {/* 自定义答案输入 */}
          {clarification.allowCustomAnswer && (
            <div className="space-y-2">
              {!showCustomInput && !isResolved ? (
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isResolved
                      ? 'cursor-not-allowed border-border text-muted-foreground'
                      : 'border-muted-foreground/30 bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setShowCustomInput(true)}
                  disabled={isSubmitting || isResolved}
                  aria-label="输入自定义答案"
                >
                  <span>其他（自定义答案）...</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    ref={customInputRef}
                    type="text"
                    className={`min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isResolved ? 'cursor-not-allowed text-muted-foreground' : 'border-input'
                    }`}
                    value={customAnswer}
                    onChange={(e) => setCustomAnswer(e.target.value)}
                    placeholder="输入你的答案..."
                    disabled={isSubmitting || isResolved}
                    aria-label="自定义答案输入"
                  />
                  <button
                    type="button"
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isResolved || !customAnswer.trim()
                        ? 'cursor-not-allowed bg-muted text-muted-foreground'
                        : 'bg-primary text-primary-foreground hover:bg-primary-hover'
                    }`}
                    onClick={() => {
                      void submitCustomAnswer()
                    }}
                    disabled={isSubmitting || isResolved || !customAnswer.trim()}
                    aria-label="提交自定义答案"
                  >
                    {isSubmitting ? (
                      <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Check size={14} aria-hidden="true" />
                    )}
                    提交
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 错误消息 */}
          {errorMessage && (
            <div
              className="rounded-md bg-destructive-soft/20 px-3 py-2 text-xs text-destructive-foreground"
              role="alert"
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* 底部取消 */}
        {!isResolved && (
          <div className="flex items-center justify-end gap-2 border-t border-primary-border/30 px-4 py-2.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                void handleCancel()
              }}
              disabled={isSubmitting}
              aria-label="取消澄清"
            >
              <X size={12} aria-hidden="true" />
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
