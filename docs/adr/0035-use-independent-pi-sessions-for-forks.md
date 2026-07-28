# 使用独立 Pi session 文件实现分叉会话

汤圆的分叉会话使用 Pi SDK `SessionManager.createBranchedSession()` 创建独立 JSONL 和新的 Pi session ID，而不以 `SessionManager.branch()` 在同一文件内移动临时 leaf。这样分叉会话可独立运行、恢复和切换模型，并在遵守全局并发上限的前提下并行执行。会话谱系仍是生命周期边界：归档或删除父会话会分别可恢复地隐藏或永久级联处理其后代；分叉来源写入新分叉会话的 Pi JSONL，作为不参与模型上下文的汤圆 custom entry（`tangyuan:fork-source`），并同时保留 Pi 原生 `parentSession` 关系；会话索引仅作为可重建的投影。这样索引丢失后仍可从 Pi session 文件恢复精确来源。

Pi SDK 只在保留路径中已有 assistant 回复时才立刻把分叉文件写入磁盘，且写入时会原样带上从父路径继承来的旧分叉来源记录。因此汤圆在 `createBranchedSession()` 之后统一用切换后的内存状态重写一次分叉文件：写出 header 与保留路径条目，剔除继承来的旧来源记录并重连 `parentId`。这同时解决两件事：文件缺失时避免重新打开退化成另建会话（丢失 session ID、工作目录与继承历史），这是首条用户消息分叉与递归分叉能成立的前提；以及使每个分叉文件只保留一条指向直接父会话的分叉来源记录，不因分叉深度而累积出多条矛盾的来源。从首条用户消息分叉时保留路径本来为空，直接新建只含 header 的会话文件。
