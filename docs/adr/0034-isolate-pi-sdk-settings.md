# 使用内存设置隔离 Pi SDK 外部配置

汤圆创建 Pi SDK 会话时不读取用户机器上的 Pi 全局配置（`~/.pi/agent/settings.json`），改为注入 `SettingsManager.inMemory()` 使用 SDK 内置默认值。汤圆与 Pi 是独立产品，仅底层共享 SDK 能力，不应让 Pi 的配置文件静默影响汤圆运行行为。

未来如需调整重试、压缩、超时等行为参数，只能通过汤圆自身配置读取并更新内存中的 SettingsManager，不可回退到读取外部 Pi 配置。
