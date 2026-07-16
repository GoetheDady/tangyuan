# 对外只暴露一个 TangyuanRuntime 深模块

仓库继续保留 `apps/desktop`、`packages/contracts` 和 `packages/agent-runtime` 三个 workspace，不把每个内部职责拆成公开 package。`packages/agent-runtime` 对 Electron Main 只暴露一个 `TangyuanRuntime` 深模块，集中提供应用快照、Agent、配置、session、消息、run 和事件能力。

配置存储、Agent 目录、session catalog、Skill 加载、profile 更新、run 调度和 Pi session 执行作为运行时内部模块存在。IPC adapter 只依赖 `TangyuanRuntime` 接口；测试也通过同一接口观察结果。Pi Agent 是产品基础，不为替换引擎暴露公开 seam，只有真实 Pi 调用和本地文件系统等测试需要替身的依赖保留内部 adapter。
