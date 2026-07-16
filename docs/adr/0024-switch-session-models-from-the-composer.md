# 在 Composer 切换当前 session 模型

聊天 Composer 提供 Provider 和 Model 选择器。新 session 默认使用当前 Agent 在控制台保存的 Provider/Model；已有 session 切换选择时调用 Pi Agent 原生模型切换能力，把 `model_change` entry 写入该 session JSONL，后续消息使用新模型，重启后恢复 session 最后记录的选择。

Composer 切换只修改当前 session，不更新 Agent 默认配置。Agent 默认 Provider/Model 仍只在控制台修改，并只作为新 session 的初始选择。

Composer 同时提供 Pi Agent 原生 Thinking Level 选择器。仅当当前模型支持时展示可用值，切换写入 `thinking_level_change` entry，只影响当前 session，并在重启后恢复；汤圆不自行扩展 Pi 未提供的推理等级。
