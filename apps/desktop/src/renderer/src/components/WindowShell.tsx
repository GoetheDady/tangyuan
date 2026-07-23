/**
 * 全局窗口外壳。
 *
 * 在所有页面顶部渲染一条透明、独占的窗口拖拽区，左侧为 macOS 系统窗口控件
 * （红绿灯）预留空位，其余全宽用于拖动窗口。页面内容在拖拽区下方的剩余高度
 * 内渲染并自行滚动，因此各页面无需再单独承载窗口拖拽。
 *
 * @param props - 组件属性。
 * @param props.children - 在拖拽区下方渲染的页面内容。
 * @returns 窗口外壳元素。
 * @throws 此组件不会主动抛出错误。
 */
export function WindowShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div
        data-testid="window-drag-region"
        aria-hidden="true"
        className="window-drag-region h-9 shrink-0"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
