import { GitBranchPlus } from 'lucide-react'

/**
 * 渲染用户发送的纯文本消息。
 *
 * 默认保持消息内容简单、可换行，并避免将用户输入解析成 Markdown 或 HTML。
 * 当提供 onFork 时，消息 hover 或按钮获得焦点后展示分叉入口。
 *
 * @param props - 组件的属性。
 * @param props.content - 用户消息的纯文本内容。
 * @param props.onFork - 用户点击分叉按钮时的回调。
 * @returns 纯文本消息元素。
 * @throws 此组件不会主动抛出错误。
 */
export function UserMessage({
  content,
  onFork
}: {
  content: string
  onFork?: () => void
}): React.JSX.Element {
  return (
    <div className="group relative">
      <p className="whitespace-pre-wrap break-words">{content}</p>
      {onFork ? (
        <button
          type="button"
          aria-label="从此处分叉"
          title="从此处分叉"
          className="absolute -bottom-4 left-0 flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 shadow-sm transition-[color,background-color,opacity] hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation()
            onFork()
          }}
        >
          <GitBranchPlus size={10} aria-hidden="true" />
          分叉
        </button>
      ) : null}
    </div>
  )
}
