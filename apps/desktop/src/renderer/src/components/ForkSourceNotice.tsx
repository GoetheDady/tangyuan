import { GitBranch } from 'lucide-react'
import React from 'react'

/**
 * 分叉来源提示的属性。
 */
export interface ForkSourceNoticeProps {
  /** 来源会话标题；来源不可用时为 null。 */
  parentSessionTitle: string | null
  /** 来源会话是否仍然可用。 */
  isParentAvailable: boolean
  /** 点击「查看来源消息」时的回调。 */
  onViewSource: () => void
}

/**
 * 在分叉会话消息流顶部展示来源提示，并支持跳回来源消息。
 *
 * 来源会话不可用（文件缺失或已被清理）时降级为纯提示，不提供跳转。
 *
 * @param props - 组件属性。
 * @returns 分叉来源提示组件树。
 * @throws 此组件不会主动抛出错误。
 */
export function ForkSourceNotice({
  parentSessionTitle,
  isParentAvailable,
  onViewSource,
}: ForkSourceNoticeProps): React.JSX.Element {
  return (
    <div
      data-testid="fork-source-notice"
      className="border-border text-caption text-muted-foreground mx-auto flex w-full max-w-[720px] items-center gap-2 border-b px-5 py-2"
    >
      <GitBranch size={13} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {isParentAvailable && parentSessionTitle
          ? `分叉自「${parentSessionTitle}」`
          : '分叉自已不可用的会话'}
      </span>
      {isParentAvailable && parentSessionTitle && (
        <button
          type="button"
          className="window-no-drag text-caption text-foreground hover:bg-accent focus-visible:ring-ring/50 shrink-0 rounded-md px-2 py-1 font-medium transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
          onClick={onViewSource}
        >
          查看来源消息
        </button>
      )}
    </div>
  )
}
