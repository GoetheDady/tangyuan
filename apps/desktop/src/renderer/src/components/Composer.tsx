import { Send } from 'lucide-react'
import { useCallback, useRef, useState, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Composer 组件的属性。
 */
export interface ComposerProps {
  /** 当前输入文本。 */
  value: string
  /** 输入文本变化时的回调。 */
  onChange: (value: string) => void
  /** 用户提交（Enter 发送）时的回调。 */
  onSubmit: () => void
  /** 是否禁用输入和发送。 */
  disabled: boolean
  /** Textarea 的占位文本。 */
  placeholder: string
  /** 是否正在发送中，用于显示按钮状态。 */
  isSending: boolean
}

/**
 * 聊天输入组件：支持多行自动增高、IME 输入法保护和 Enter 发送。
 *
 * 键盘行为：
 * - Enter（非 Shift）：触发 onSubmit 发送消息
 * - Shift+Enter：插入换行符
 * - 中文输入法组合期间（compositionstart → compositionend）：
 *   Enter 不会触犯发送，确保输入法确认字符时不会误发送
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
  disabled,
  placeholder,
  isSending
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
      if (!disabled && value.trim()) {
        onSubmit()
      }
    }
  }

  return (
    <form
      className="mx-auto max-w-3xl"
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled && value.trim()) {
          onSubmit()
        }
      }}
    >
      <div className="rounded-lg border bg-card p-2 shadow-sm">
        <Label htmlFor="composer" className="sr-only">
          消息
        </Label>
        <Textarea
          ref={textareaRef}
          id="composer"
          className="max-h-40 min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
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
        <div className="flex items-center justify-end">
          <Button type="submit" size="sm" disabled={disabled || !value.trim()}>
            <Send aria-hidden="true" />
            {isSending ? '发送中' : '发送'}
          </Button>
        </div>
      </div>
    </form>
  )
}
