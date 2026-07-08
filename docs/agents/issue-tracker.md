# Issue tracker：GitHub

本仓库的 issues 和 PRD 都放在 GitHub Issues，仓库为 `GoetheDady/tangyuan`。所有 issue tracker 操作优先使用 `gh` CLI。

## 语言规则

- PRD 使用中文。
- Issues 使用中文。
- Issue 标题、目标、范围、验收标准、测试方式都使用中文。
- `Driver`、`Runtime`、`IPC`、`SDK`、`Provider`、`Model` 等技术术语可以保留英文；首次出现时尽量解释中文含义。

## 常用操作

- 创建 issue：`gh issue create --title "..." --body "..."`
- 查看 issue：`gh issue view <number> --comments`
- 列出 issues：`gh issue list --state open`
- 评论 issue：`gh issue comment <number> --body "..."`
- 添加标签：`gh issue edit <number> --add-label "..."`
- 移除标签：`gh issue edit <number> --remove-label "..."`
- 关闭 issue：`gh issue close <number> --comment "..."`

## PR 是否作为请求入口

外部 PR 不作为 triage 请求入口。

`/triage` 只处理 GitHub Issues，不把外部 PR 拉入同一队列。

## 当技能说“发布到 issue tracker”

创建 GitHub Issue。

## 当技能说“获取相关 ticket”

运行：

```sh
gh issue view <number> --comments
```

## 开发流程

默认的“从 issue 到完成”流程见 `docs/agents/development-process.md`。
