import { Paperclip, Send, StopCircle } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import type {
  ModelDescriptor,
  ProviderDescriptor,
  SessionModelInfo,
} from '@yuanxiao/contracts'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/** 思考档位（Pi SDK 枚举）到中文文案的映射，未知档位回退为原文。 */
const THINKING_LEVEL_LABELS: Record<string, string> = {
  off: '关',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '极限',
}

/**
 * Composer 组件的属性。
 *
 * ChatPage 通过此接口把会话数据、运行状态和模型配置回调传入 Composer，
 * Composer 内部负责 Pencil 视觉呈现、键盘行为、IME 保护和状态切换，
 * ChatPage 不需关心输入框底栏的内部布局。
 */
export interface ComposerProps {
  /** 当前输入文本。 */
  value: string
  /** 输入文本变化时的回调。 */
  onChange: (value: string) => void
  /** 用户提交（Enter 发送或点击发送按钮）时的回调。 */
  onSubmit: () => void
  /** Textarea 的占位文本。 */
  placeholder: string
  /** 会话是否正在运行。运行时 textarea 仍可编辑但不可发送，配置控件禁用。 */
  isRunning: boolean
  /** 取消当前运行的会话。 */
  onCancel: () => void
  /** 是否完全禁用（无选中会话时）。禁用 textarea 和发送按钮。 */
  disabled?: boolean
  /** 当前会话模型信息；为 null 时模型控件不渲染但输入仍可用。 */
  sessionModelInfo: SessionModelInfo | null
  /** 模型信息是否正在加载。 */
  isLoadingModelInfo: boolean
  /** 模型/思考强度切换是否正在进行。 */
  isSwitchingModel: boolean
  /** 可用的 Provider 列表。 */
  providers: ProviderDescriptor[]
  /** 当前 Provider 的可选模型列表。 */
  selectableModels: ModelDescriptor[]
  /** 切换模型时的回调，传入新 Provider 和新 Model 标识。 */
  onModelChange: (providerId: string, modelId: string) => void
  /** 切换思考强度时的回调。 */
  onThinkingLevelChange: (level: string) => void
}

/**
 * 聊天输入组件：按 Pencil 规范展示输入区、底栏模型/思考控件和发送/停止按钮。
 *
 * 键盘行为：
 * - Enter（非 Shift）：触发 onSubmit 发送消息
 * - Shift+Enter：插入换行符
 * - 中文输入法组合期间（compositionstart → compositionend）：
 *   Enter 不会触犯发送，确保输入法确认字符时不会误发送
 *
 * 运行状态：
 * - 空闲时：textares 可编辑，底栏控件可用，Enter/按钮发送
 * - 运行中：textarea 可编辑草稿，底栏控件禁用，停止按钮取代发送按钮，
 *   Enter/表单提交不可发送
 *
 * 自动增高：
 * - 初始最小高度为 5rem（min-h-20）
 * - 最高不超过 10rem（max-h-40）
 * - 通过 textarea 的 scrollHeight 动态调整
 *
 * @param props - 组件的属性。
 * @returns 聊天输入区域组件树。
 * @throws 此组件不会主动抛出错误。
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  isRunning,
  onCancel,
  disabled = false,
  sessionModelInfo,
  isLoadingModelInfo,
  isSwitchingModel,
  selectableModels,
  onModelChange,
  onThinkingLevelChange,
}: ComposerProps): React.JSX.Element {
  const [isComposing, setIsComposing] = useState(false)
  const [showThinkingLevel, setShowThinkingLevel] = useState(false)
  const thinkingLevelHideTimerRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    return () => {
      if (thinkingLevelHideTimerRef.current !== null) {
        window.clearTimeout(thinkingLevelHideTimerRef.current)
      }
    }
  }, [])

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    // 重置高度以获取准确的 scrollHeight
    el.style.height = 'auto'
    // 限制最大高度为 10rem（max-h-40），最小高度由 CSS min-h-20 保证
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [])

  /**
   * 处理键盘事件：Enter 发送，Shift+Enter 换行。
   *
   * @param event - 键盘事件。
   * @returns 无返回值。
   */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // 中文输入法组合期间不处理 Enter
    if (isComposing) return

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (!isRunning && sessionModelInfo && value.trim()) {
        onSubmit()
      }
    }
  }

  const canSend = !disabled && !isRunning && value.trim().length > 0
  const showThinkingControl =
    sessionModelInfo?.supportsThinking &&
    sessionModelInfo.supportedThinkingLevels &&
    sessionModelInfo.supportedThinkingLevels.length > 1

  const thinkingLevels = sessionModelInfo?.supportedThinkingLevels ?? []
  const selectedThinkingIndex = Math.max(
    0,
    thinkingLevels.indexOf(sessionModelInfo?.thinkingLevel ?? 'off'),
  )
  const thinkingProgress =
    thinkingLevels.length <= 1
      ? 0
      : selectedThinkingIndex / (thinkingLevels.length - 1)
  const selectedThinkingLevel = thinkingLevels[selectedThinkingIndex] ?? 'off'
  const thinkingLevelLabel =
    THINKING_LEVEL_LABELS[selectedThinkingLevel] ?? selectedThinkingLevel

  const showThinkingLevelLabel = useCallback(() => {
    if (thinkingLevelHideTimerRef.current !== null) {
      window.clearTimeout(thinkingLevelHideTimerRef.current)
      thinkingLevelHideTimerRef.current = null
    }
    setShowThinkingLevel(true)
  }, [])

  const hideThinkingLevelLabelSoon = useCallback(() => {
    if (thinkingLevelHideTimerRef.current !== null) {
      window.clearTimeout(thinkingLevelHideTimerRef.current)
    }
    thinkingLevelHideTimerRef.current = window.setTimeout(() => {
      setShowThinkingLevel(false)
      thinkingLevelHideTimerRef.current = null
    }, 600)
  }, [])

  return (
    <form
      className="mx-auto w-full max-w-[720px]"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSend) {
          onSubmit()
        }
      }}
    >
      <div
        data-testid="composer-card"
        className="bg-card focus-within:ring-ring/25 flex min-h-[131px] flex-col rounded-[20px] p-[18px] shadow-[inset_0_0_0_1px_var(--border)] transition-[box-shadow] duration-200 focus-within:shadow-[inset_0_0_0_1px_var(--ring)] focus-within:ring-[3px]"
      >
        <Label htmlFor="composer" className="sr-only">
          消息
        </Label>
        <Textarea
          ref={textareaRef}
          id="composer"
          className="text-body placeholder:text-disabled-foreground max-h-40 min-h-[52px] resize-none rounded-none border-0 bg-transparent px-0 py-0 shadow-none hover:border-0 focus-visible:border-0 focus-visible:ring-0"
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            requestAnimationFrame(adjustHeight)
          }}
          onCompositionStart={() => {
            setIsComposing(true)
          }}
          onCompositionEnd={() => {
            setIsComposing(false)
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />

        <Separator />

        <div className="flex min-h-10 items-end justify-between gap-2 pt-2.5">
          <div className="text-caption text-muted-foreground flex min-w-0 flex-1 items-center gap-2.5">
            {sessionModelInfo ? (
              <Select
                value={sessionModelInfo.modelId}
                onValueChange={(modelId) => {
                  onModelChange(sessionModelInfo.providerId, modelId)
                }}
                disabled={isSwitchingModel || isRunning}
              >
                <SelectTrigger
                  aria-label="模型"
                  size="sm"
                  className="bg-secondary text-caption text-secondary-foreground h-[26px] w-auto min-w-0 gap-1 rounded-md border-0 px-2.5 font-medium"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {selectableModels.map((model) => (
                      <SelectItem key={model.modelId} value={model.modelId}>
                        {model.displayName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}

            {showThinkingControl ? (
              <>
                <span className="text-caption text-muted-foreground shrink-0">
                  思考
                </span>
                <div className="relative h-6 w-16 shrink-0">
                  <Slider
                    aria-label="思考强度"
                    aria-valuetext={thinkingLevelLabel}
                    className="h-full w-full"
                    min={0}
                    max={thinkingLevels.length - 1}
                    step={1}
                    value={[selectedThinkingIndex]}
                    disabled={isSwitchingModel || isRunning}
                    onValueChange={([index]) => {
                      onThinkingLevelChange(thinkingLevels[index] ?? 'off')
                    }}
                    onPointerDown={showThinkingLevelLabel}
                    onPointerUp={hideThinkingLevelLabelSoon}
                    onValueCommit={hideThinkingLevelLabelSoon}
                  />
                  {showThinkingLevel ? (
                    <span
                      aria-hidden="true"
                      className="bg-primary text-primary-foreground pointer-events-none absolute -top-6 z-10 -translate-x-1/2 rounded-[6px] px-1.5 py-0.5 text-[10px] whitespace-nowrap"
                      style={{
                        left: `max(16px, min(${thinkingProgress * 100}%, calc(100% - 16px)))`,
                      }}
                    >
                      {thinkingLevelLabel}
                    </span>
                  ) : null}
                </div>
              </>
            ) : null}

            {isLoadingModelInfo ? (
              <span className="text-muted-foreground text-caption shrink-0">
                加载中...
              </span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled
                  aria-label="附件功能暂未开放"
                >
                  <Paperclip aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>附件功能暂未开放</p>
              </TooltipContent>
            </Tooltip>

            {isRunning ? (
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                aria-label="停止"
                title="停止"
                onClick={onCancel}
              >
                <StopCircle aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon-sm"
                aria-label="发送"
                title="发送"
                disabled={!canSend}
              >
                <Send aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
