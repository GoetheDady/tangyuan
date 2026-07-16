# 限制并排队 Agent run

同一 session 同时只允许一个 active run；不同 session 和不同 Agent 可以并发运行。应用全局最多允许 4 个 active run，超过上限的新请求进入等待队列，用户可以取消运行中或排队中的请求。

Main 进程集中维护 run 调度、队列和取消状态，Renderer 只展示事件投影，不能自行判断并发名额。该限制控制本地资源与模型调用成本，同时保留多 Agent 并行工作能力。
