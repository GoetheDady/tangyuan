# 用全局窗口外壳承载窗口拖拽

macOS 采用 `titleBarStyle: 'hiddenInset'`，没有系统标题栏，窗口拖拽只能靠 CSS `-webkit-app-region: drag` 指定。原本只有聊天主界面的 Agent rail 标了拖拽区，Console 各页完全没有，导致大部分页面无法拖动窗口。

我们引入一个轻量的全局窗口外壳（Shell）包裹所有路由，在顶部渲染一条透明、独占的窗口拖拽区，左侧为系统红绿灯预留空位。拖拽职责由此收敛到一处：ChatPage rail 不再兼任拖拽区，也移除其假红绿灯占位。外壳采用 `h-screen` 纵向布局、内容区在剩余高度内滚动，避免各页面沿用 `min-h-screen` 时因顶部条产生多余滚动。
