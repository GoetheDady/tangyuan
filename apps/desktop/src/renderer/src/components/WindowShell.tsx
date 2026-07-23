/**
 * 全局窗口外壳。
 *
 * 在所有页面顶部覆盖一条透明、独占的窗口拖拽区，用于拖动窗口。拖拽区以
 * 覆盖层形式定位，不占据布局高度，因此页面内容仍贴着窗口顶边、不会整体
 * 下移。非交互内容（标题文字等）透过透明拖拽区可见且可拖动；落在拖拽区
 * 内的交互元素由页面自行抬升到拖拽区之上并标记 `window-no-drag`。
 *
 * @param props - 组件属性。
 * @param props.children - 在拖拽区下方渲染的页面内容。
 * @returns 窗口外壳元素。
 * @throws 此组件不会主动抛出错误。
 */
export function WindowShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="relative h-screen overflow-hidden bg-background text-foreground">
      <div
        data-testid="window-drag-region"
        aria-hidden="true"
        className="window-drag-region absolute inset-x-0 top-0 z-40 h-9"
      />
      <div className="h-full overflow-y-auto">{children}</div>
    </div>
  )
}
