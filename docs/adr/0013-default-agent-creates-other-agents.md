# 仅由默认 Agent 创建其他 Agent

MVP 不提供独立的“创建 Agent”表单。用户在默认 Agent“汤圆”的会话中描述名称、职责和规则，汤圆补齐必要信息后调用 Main 提供的受控 `create_agent` 工具；Main 负责生成不可变 `agentId`、集中配置条目、Agent Home 和工作空间。

新 Agent 初始继承汤圆当前使用的 Provider 和 Model，创建成功后允许切换到任意已配置凭据的 Provider 及其模型。各 Provider 的模型服务凭据仍由汤圆统一维护，不复制到 Agent Home，也不由其他 Agent 直接管理。

只有默认汤圆使用 `bootstrap.md`。汤圆不创建特殊 bootstrap session；`~/.tangyuan/agents/tangyuan/bootstrap.md` 是否存在，是初始化状态的唯一判断。只要文件存在，每次汤圆运行都同时注入 `bootstrap.md`、当前 `soul.md` 和共享 `user.md`，优先继续补问初始化信息，不处理普通任务。

信息充分后，汤圆通过受控工具更新 `soul.md` 和共享 `user.md`，全部成功后删除 `bootstrap.md`；删除后的下一次运行才进入正常对话。应用重启、切换或新建 session 都继续遵守文件状态。创建其他 Agent 时，汤圆已通过创建对话生成初始 `soul.md`，新 Agent 不创建 `bootstrap.md`，创建完成后立即可用。
