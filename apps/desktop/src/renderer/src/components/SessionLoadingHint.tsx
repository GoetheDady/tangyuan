import React from 'react'

/**
 * 会话读取提示。
 *
 * 切换会话后、该会话消息内容读取完成前，在对话区展示的轻量指示；
 * 内容就绪即被取代。它不属于对话消息、Agent 执行历史或响应等待提示。
 *
 * 形态遵循黑芝麻元宵主题的克制调性：一行低对比度文字，不模拟内容结构。
 * 淡入动画带 150ms 延迟，读取很快时提示不会闪现。
 *
 * @returns 会话读取提示组件树。
 * @throws 此组件不会主动抛出错误。
 */
export function SessionLoadingHint(): React.JSX.Element {
  return (
    <div
      className="animate-session-hint-in flex min-h-0 flex-1 items-center justify-center"
      data-testid="session-loading-hint"
      role="status"
      aria-label="正在打开会话"
    >
      <p className="text-body text-muted-foreground">正在打开会话…</p>
    </div>
  )
}
