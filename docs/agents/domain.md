# 领域文档

本仓库使用 single-context 领域文档结构。

## 开始工程任务前先读

- 根目录 `CONTEXT.md`，如果存在。
- `docs/adr/` 下和当前任务相关的 ADR，如果存在。
- `docs/` 下的产品和架构文档，尤其是：
  - `docs/prd-v1-desktop-pi-sdk.md`
  - `docs/mvp-roadmap.md`
  - `docs/pi-agent-sdk-capability-plan.md`
  - `docs/theme-colors.md`

如果 `CONTEXT.md` 或 ADR 还不存在，静默继续，不需要因为缺失而停止任务。

## 术语规则

输出 issue、方案、测试名、重构建议时，优先使用项目文档中已经确定的术语。不要随意替换同一概念的名称。

如果缺少某个关键术语，可以在任务中标记为后续需要补充的领域语言，而不是现场创造一套新词。
