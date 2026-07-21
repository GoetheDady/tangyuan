# 展示并持久化 Agent 执行历史

聊天主界面的消息流除对话消息外，还展示并持久化与 Agent 回复关联的执行历史，包括 Runtime 提供的 thinking 原文、中间文字、工具步骤摘要、命令审批和问题澄清结果。执行历史在运行期间默认展开，最终回复确认后按 Pencil 规则自动收起，并在完成、失败、中断或重新打开会话后仍可回看；工具原始参数和完整输出不进入 Renderer 展示。

Pi session 继续是会话唯一真相，TangyuanRuntime 负责把 Pi SDK 的 turn、message、tool call、tool result 和运行结束事件归一化为 Renderer 可直接消费的结构化会话视图；只有 Pi session 无法表达的汤圆专属用户决策才使用会话扩展数据保存。这样选择了过程透明和可追溯性，而不是只展示最终回复的安静消息流，也避免 Renderer 直接依赖 Pi SDK 事件细节。
