# 隔离 Agent 身份文件写入

每个 Agent 只能通过 Main 受控工具更新自己的 `soul.md`，写入前备份到该 Agent 的 `soul.history/`。默认 Agent“汤圆”仅在创建新 Agent 时可以写入其初始 `soul.md`；创建完成后不能直接修改其他 Agent 的身份文件。

Pi 的普通 `write`、`edit` 和 shell 工具不得修改共享 `user.md`、任何 Agent 的身份文件或其他 Agent 目录，只能自由读写当前 Agent 的 `workspace/`。该限制由 Main 工具授权或 Pi extension 强制执行，不依赖 prompt 自律。
