# 用全局窗口外壳承载窗口拖拽

macOS 采用 `titleBarStyle: 'hiddenInset'`，没有系统标题栏，窗口拖拽只能靠 CSS `-webkit-app-region: drag` 指定。原本只有聊天主界面的 Agent rail 标了拖拽区，Console 各页完全没有，导致大部分页面无法拖动窗口。

我们引入一个轻量的全局窗口外壳（Shell）包裹所有路由，在顶部覆盖一条透明、独占的窗口拖拽区。拖拽区以覆盖层定位、不占布局高度，页面内容仍贴着窗口顶边、不会整体下移；非交互内容透过它可拖动，落在其内的交互元素（Agent rail、新建会话、Console 返回按钮）由页面抬升到拖拽区之上并标记 `window-no-drag`。拖拽职责由此收敛到一处：ChatPage rail 不再兼任拖拽区，仅保留红绿灯避让间距。
