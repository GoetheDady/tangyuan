# Pi Agent 0.80.3 Session 持久化研究

研究对象：项目当前安装的 `@earendil-works/pi-coding-agent@0.80.3`，上游 commit `a23abe4a695df8b69b613f73e9fdda2a8af894d4`。结论来自已安装的官方文档、类型定义和实现。

## Pi 原生行为

Pi 每个 session 使用一个 JSONL 文件保存，不维护独立数据库或 index。默认目录按 `cwd` 分组：

```text
~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<uuid>.jsonl
```

文件首行是 session header，包含 `id`、`version`、`timestamp` 和 `cwd`；后续 entry 通过 `id`、`parentId` 形成可分支树。消息、模型切换、thinking level、compaction、标签和 extension 自定义数据都追加在同一文件中。[官方 session 文档](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/docs/sessions.md)；[官方格式文档](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md)；[类型定义](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts)

`SessionManager.list(cwd)` 扫描该 `cwd` 的默认目录并解析 JSONL 文件生成 `SessionInfo`。传入自定义 `sessionDir` 时，它扫描该目录，再用文件 header 中的 `cwd` 过滤结果；`SessionManager.listAll()` 则列出所有默认 cwd 目录，传入自定义目录时列出该目录全部 session。[列表实现](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js#L1176-L1213)

Pi 默认生成 UUID session ID，也允许 `SessionManager.create(..., { id })` 接受调用方指定 ID。文件本身仍是事实来源；列表标题来自最新 `session_info` entry 或首条消息，不依赖外部 index。[创建接口](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts#L286-L324)

## 当前汤圆行为

汤圆没有使用 Pi 默认的按 cwd 分目录，而是把所有 Pi JSONL 放入统一自定义目录：

```text
~/.tangyuan/sessions/pi-sdk/
```

同时维护：

```text
~/.tangyuan/sessions/index.json
```

当前 `SessionManager.list(agentCwd, sharedSessionDir)` 会扫描共享 Pi 目录，并按 header `cwd` 过滤该 Agent 的 session；因此 Pi 原生能力已经支持“一个物理 session 目录、多个 Agent workspace”的布局。[汤圆路径实现](../../packages/agent-runtime/src/index.ts#L1399-L1422)；[Pi 自定义目录过滤](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js#L1176-L1182)

## 对多 Agent 架构的含义

1. Pi JSONL 继续作为消息、原生元数据、模型切换和分支树的唯一真相。
2. 汤圆可以继续使用一个全局 Pi session 目录，无需为每个 Agent 复制 session 存储。
3. 每个 Agent 的唯一 workspace `cwd` 让 Pi 能按 Agent 过滤 session；汤圆 index 仍应显式保存 `agentId`，避免仅依赖路径反推产品归属。
4. `sessions/index.json` 是汤圆为全局搜索、扩展数据和快速启动维护的可重建投影，不应反向覆盖 Pi session。
5. session ID 应由汤圆生成全局 UUID，并在所有 Agent 间保持唯一；Pi 的自定义 ID 能力不等于替汤圆维护全局注册表。
6. index 丢失时，可调用 `SessionManager.listAll(sharedSessionDir)` 扫描全部 JSONL，再依据 header `cwd` 对照 Agent workspace 重建基础归属。

## 建议

保留全局布局：

```text
~/.tangyuan/sessions/
├── index.json
└── pi-sdk/
    └── <pi-session-files>.jsonl
```

该布局与 Pi 原生 API 对齐，同时允许汤圆增加跨 Agent 搜索和产品扩展数据。Pi 没有提供的部分是“Agent 注册关系和汤圆扩展索引”，这部分由 `TangyuanRuntime` 维护即可。
