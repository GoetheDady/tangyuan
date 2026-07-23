import React from 'react'

/**
 * 响应等待提示。
 *
 * Agent 执行尝试已开始但尚未产生任何可见内容时，在消息流末尾 Agent 一侧
 * 展示的轻量指示。首个思考、文字或工具步骤到达即被真实的执行历史/回复取代；
 * 失败或取消时消失。它不属于对话消息或 Agent 执行历史。
 *
 * 形态遵循黑芝麻汤圆主题的克制调性：一组低对比度的脉冲点，不模拟内容结构。
 *
 * @returns 响应等待提示组件树。
 * @throws 此组件不会主动抛出错误。
 */
export function AwaitingResponseIndicator(): React.JSX.Element {
  return (
    <div className="py-2.5" data-testid="awaiting-response-indicator">
      <article className="flex justify-start" role="status" aria-label="Agent 正在响应">
        <div className="flex items-center gap-1.5 px-1 py-2 text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:0ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:200ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:400ms]" />
        </div>
      </article>
    </div>
  )
}
