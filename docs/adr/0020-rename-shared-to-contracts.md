# 将 shared package 改为 contracts

`packages/shared` 重命名为 `packages/contracts`，包名改为 `@tangyuan/contracts`。该 package 只保存 Renderer、Preload、Main 和 Runtime 共同遵守的 Zod schema、可序列化类型、IPC channel、Agent 事件和纯映射函数。

文件系统、Electron、Pi SDK、React、状态存储和业务编排不得进入 contracts。明确命名和依赖规则可避免 `shared` 演变成无边界杂物包，并让跨进程输入都能由同一 Zod schema 在 Main 侧运行时校验。
