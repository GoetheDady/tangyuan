# 以必需的职责模块组合 YuanxiaoRuntime

`YuanxiaoRuntime` 继续作为 Electron Main 和 IPC 唯一依赖的深模块，对外契约保持稳定；其内部不再注入一个同时承载配置、会话、Agent、Profile 和 Skill 的巨型 Driver，也不再用 optional 方法表达“可能支持”的能力。

Runtime 创建时必须显式提供五个按职责划分的模块：`RuntimeConfigurationModule`、`SessionModule`、`AgentLifecycleModule`、`ProfileModule` 和 `SkillModule`。这些接口是 Runtime 内部的组合接口，全部能力在应用启动时即为必需；能力缺失属于组装错误，不在业务调用时通过 `driver-unavailable` 分支兜底。

生产组装复用同一套本地实现：配置由 `DefaultRuntimeConfiguration` 负责，Agent 生命周期由 `AgentRegistry` 负责，Profile 由 `DefaultProfileModule` 负责，Skill 由 `SkillStore` 负责，会话执行暂由 `PiSdkDriver` 负责。已有公开兼容方法集中在 `PiSdkDriverFacade`，Runtime 不再依赖这些跨职责浅转发。

只有真正会变化的外部依赖保留 adapter seam：Pi Agent SDK 使用 `PiSdkGateway`，系统凭据加密使用 `ConfigEncryptionAdapter`，时间和本地路径通过构造依赖提供。不会为假设中的其他 Agent 引擎建立公开抽象，也不把 Pi SDK 接口逐方法复制成产品接口。

测试分两层：各职责模块通过自己的接口验证行为；另用临时目录、假 `PiSdkGateway` 和假加密 adapter 组装真实 Runtime，覆盖配置、建会话和消息执行的生产组合。测试替身替换外部依赖，不替换整套产品运行时。

本决策细化并取代 ADR 0019 中关于运行时内部 Driver seam 的旧描述；“对外只暴露一个深 Runtime”仍然有效。
