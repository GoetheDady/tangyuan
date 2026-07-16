# Bash 执行必须获得用户审批

MVP 保留 Pi Agent 的 bash 能力，但每次执行前必须由 Main 创建审批请求，向用户展示完整命令和 `cwd`，收到明确允许后才运行。拒绝或取消审批时，工具调用以可理解的拒绝结果返回 Agent；MVP 不提供永久允许全部命令。

普通 `read`、`write` 和 `edit` 默认限制在当前 Agent workspace；共享用户资料、Agent 身份、配置和 Skill 使用各自的受控工具。Pi 默认没有文件系统 sandbox，审批界面必须明确说明获批 bash 仍拥有当前 macOS 用户权限。

审批作为 Main 持有的持久 run 状态，通过事件发送给 Renderer。聊天消息流在工具调用位置展示 ApprovalCard，包含 Agent、命令、`cwd` 和风险说明，只提供“允许本次”和“拒绝”；Agent/session 列表显示待审批徽标并可跳转到对应 session。切换页面不能丢失审批，应用退出、run 取消或请求失效时自动拒绝。
