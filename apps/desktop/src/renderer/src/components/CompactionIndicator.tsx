import { Archive } from 'lucide-react'

/**
 * Compaction 条目的展示属性。
 */
export interface CompactionIndicatorProps {
  /** compaction 发生的时间戳。 */
  timestamp: string
}

/**
 * Pi 自动上下文压缩的非阻塞状态指示器。
 *
 * 当 Pi 会话因长度触发自动压缩（compaction）时，transcript 中
 * 会出现一条 role=compaction 的系统条目。此组件在对应位置渲染
 * 一条不显眼的提示，告知用户上下文已被自动压缩。
 *
 * MVP 范围：仅展示状态提示，不提供手动压缩、分支或克隆操作。
 *
 * @param props - 组件的属性。
 * @returns 压缩提示条元素。
 * @throws 此组件不会主动抛出错误。
 */
export function CompactionIndicator({ timestamp }: CompactionIndicatorProps): React.JSX.Element {
  const formattedTime = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <div
      role="status"
      aria-label={`上下文已于 ${formattedTime} 自动压缩`}
      className="my-4 flex items-center justify-center gap-2"
    >
      <span className="h-px flex-1 bg-border" />
      <span className="flex items-center gap-1.5 whitespace-nowrap text-label text-muted-foreground">
        <Archive size={12} aria-hidden="true" />
        上下文已于 {formattedTime} 自动压缩
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
