# 使用独立 Pi session 文件实现分叉会话

汤圆的分叉会话使用 Pi SDK `SessionManager.createBranchedSession()` 创建独立 JSONL 和新的 Pi session ID，而不以 `SessionManager.branch()` 在同一文件内移动临时 leaf。这样分叉会话可独立运行、恢复和切换模型，并在遵守全局并发上限的前提下并行执行。会话谱系仍是生命周期边界：归档或删除父会话会分别可恢复地隐藏或永久级联处理其后代；分叉来源写入新分叉会话的 Pi JSONL，作为不参与模型上下文的汤圆 custom entry（`tangyuan:fork-source`），并同时保留 Pi 原生 `parentSession` 关系；会话索引仅作为可重建的投影。这样索引丢失后仍可从 Pi session 文件恢复精确来源。
