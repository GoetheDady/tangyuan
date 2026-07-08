# 实现默认 Agent Home 与 profile 文件初始化

## What to build

实现首次启动时的默认 Agent Home 初始化，为默认 Agent `tangyuan` 创建工作目录和固定 bootstrap 模板。

默认工作目录是 `~/.tangyuan/agents/tangyuan`。v1 不创建额外 `workspace/` 目录，并为后续多 Agent 预留 `agentId`。

## Acceptance criteria

- [ ] 首次启动时创建 `~/.tangyuan/agents/tangyuan`。
- [ ] 创建 `bootstrap.md`、`memory/`、`skills/`、`soul.history/`、`user.history/`。
- [ ] 如果 `soul.md`、`user.md` 和 `bootstrap.md` 都缺失，会重建固定 `bootstrap.md`。
- [ ] 如果 `soul.md` 缺失但 `bootstrap.md` 存在，RuntimeSnapshot 标记为需要 bootstrap。
- [ ] `bootstrap.md` 固定模板覆盖称呼、语言语气、主要工作、确认边界、禁区、长期偏好、失败处理和长期规则。
- [ ] Renderer 显示轻量 profile 状态：是否初始化、`soul.md` / `user.md` 最近更新时间、配置状态。
- [ ] 测试覆盖首次创建、重复启动不覆盖已有文件、缺失文件重建、profile 状态读取。

## Blocked by

- 建立 Driver、RuntimeSnapshot 与 IPC 契约
