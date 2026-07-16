# 集中保存多 Agent 配置

所有应用级配置和各 Agent 配置统一写入一个带版本号的 `config.json`。模型服务凭据按 Provider 保存为应用级共享配置，只通过默认 Agent“汤圆”的配置流程维护；其他 Agent 不复制或直接管理 API Key。每个 Agent 以 `agentId` 为键保存名称、状态、`providerId` 和 `modelId`，不在各 Agent Home 中复制配置文件。

新 Agent 默认继承汤圆当前的 Provider 和 Model，创建后允许切换到任意已配置凭据的 Provider 及其 Pi Agent 已有模型。创建 session 时，将该 Agent 当时选择的 Provider 和 Model 写入 Pi session 的原生元数据；修改 Agent 配置只影响之后创建的 session，不改写已有 session。

API Key 使用 Electron `safeStorage` 在 Main 进程中加密，以可序列化密文写入同一 `config.json`。Main 进程只在验证配置或调用 Pi Agent 时解密，Renderer 保存后只能读取“已配置”和脱敏展示状态，不能取回完整密钥；操作系统加密能力不可用时拒绝保存，不降级为明文。
