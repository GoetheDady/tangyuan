import { Paperclip, Send, StopCircle } from 'lucide-react'
import { useCallback, useRef, useState, type KeyboardEvent } from 'react'

import type { ModelDescriptor, ProviderDescriptor, SessionModelInfo } from '@tangyuan/contracts'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

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
  providers,
  selectableModels,
  onModelChange,
  onThinkingLevelChange
}: ComposerProps): React.JSX.Element {
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    sessionModelInfo.supportedThinkingLevels.length > 0

  return (
    <form
      className="mx-auto max-w-3xl"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSend) {
          onSubmit()
        }
      }}
    >
      {/* Pencil Card：8px 圆角、1px 边框、card 背景、Level 0 无阴影 */}
      <div className="rounded-lg border bg-card p-3 shadow-level-0">
        <Label htmlFor="composer" className="sr-only">
          消息
        </Label>
        <Textarea
          ref={textareaRef}
          id="composer"
          className="max-h-40 min-h-20 resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            // 延迟调整高度以等待 DOM 更新
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

        {/* Pencil Separator：1px color-border，全宽，Level 0 */}
        <Separator className="my-2" />

        <div className="flex items-center justify-between gap-2">
          {/* 左侧：模型和思考强度控件（仅在有会话时显示） */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
            {sessionModelInfo && (
              <>
                {/* Provider 选择器 */}
                <Select
                  value={sessionModelInfo!.providerId}
                  disabled={isSwitchingModel || isRunning}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 w-auto gap-1 border-0 bg-muted px-2 text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((provider) => (
                      <SelectItem key={provider.providerId} value={provider.providerId}>
                        {provider.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className="shrink-0 text-muted-foreground">/</span>

                {/* Model 选择器 */}
                <Select
                  value={sessionModelInfo!.modelId}
                  onValueChange={(modelId) => {
                    if (sessionModelInfo!.providerId) {
                      onModelChange(sessionModelInfo!.providerId, modelId)
                    }
                  }}
                  disabled={isSwitchingModel || isRunning}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 w-auto gap-1 border-0 bg-muted px-2 text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableModels.map((model) => (
                      <SelectItem key={model.modelId} value={model.modelId}>
                        {model.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Thinking Level 选择器：仅当模型支持 thinking 时展示 */}
                {showThinkingControl && (
                  <>
                    <span className="shrink-0 text-muted-foreground">·</span>
                    <Select
                      value={sessionModelInfo!.thinkingLevel ?? 'off'}
                      onValueChange={(level) => {
                        onThinkingLevelChange(level)
                      }}
                      disabled={isSwitchingModel || isRunning}
                    >
                      <SelectTrigger
                        size="sm"
                        className="h-7 w-auto gap-1 border-0 bg-muted px-2 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sessionModelInfo!.supportedThinkingLevels.map((level) => (
                          <SelectItem key={level} value={level}>
                            Thinking: {level}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}

                {/* 附件占位：禁用按钮 + Tooltip 说明功能暂未开放 */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled
                        className="ml-0.5 shrink-0 text-muted-foreground"
                        aria-label="附件功能暂未开放"
                      >
                        <Paperclip className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>附件功能暂未开放</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {isLoadingModelInfo && (
                  <span className="shrink-0 text-muted-foreground">加载中...</span>
                )}
              </>
            )}
          </div>

          {/* 右侧：发送/停止按钮 */}
          {isRunning ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={onCancel}
            >
              <StopCircle aria-hidden="true" />
              停止
            </Button>
          ) : (
            <Button type="submit" size="sm" className="shrink-0" disabled={!canSend}>
              <Send aria-hidden="true" />
              发送
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
