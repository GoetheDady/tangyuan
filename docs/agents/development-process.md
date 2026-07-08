# 开发流程

这份文档把本仓库里“从 issue 到完成”的默认做法固定下来。

## 适用范围

适用于功能开发、契约补齐、缺陷修复和需要落到 GitHub Issue 的工作。

## 默认顺序

1. 读取输入
   - 先看 issue、PRD、相关 ADR 和当前仓库约定。
   - Issue 状态代表流程阶段，Acceptance criteria（验收标准，完成后要勾选的清单）代表完成内容。

2. 锁定范围
   - 把 acceptance criteria 拆成可验证的小目标。
   - 明确测试 seam（测试缝，也就是对外可观察的公共边界）。
   - 如果需求还不清楚，先补信息，不要直接扩大实现范围。

3. 开始实现
   - 按 `/implement` 进入实现。
   - 需要时内部按 `/tdd`（测试驱动开发，先写会失败的测试，再写最小实现）推进。
   - 每次只做一条垂直切片：一条测试、一小段实现、再验证。

4. 过程门禁
   - 单包测试和类型检查要频繁跑。
   - 触及共享契约、跨进程接口、Renderer 边界时，要额外检查调用链。
   - 代码评论和方法注释要完整，技术术语第一次出现时要解释。

5. 收尾验证
   - 跑完仓库级 `pnpm test`、`pnpm typecheck`、`pnpm lint`，必要时再跑 `pnpm build`。
   - 再走一次 `/code-review`，按 Standards 和 Spec 两个维度复查。

6. 结束 issue
   - `git add`、commit、push。
   - 在 GitHub Issue 正文里把 acceptance criteria 勾上。
   - 关闭 issue，并在评论里写明 commit 和验证命令。

## 状态约定

- `待评估`：信息不够，先补齐再做。
- `需要更多信息`：缺少关键上下文，不能安全开工。
- `可交给 Agent`：可直接进入 `/implement`。
- `需要人工处理`：必须人工判断或操作。
- `不处理`：明确拒绝范围。

## 收尾原则

- 代码完成不等于 issue 完成。
- issue 只有在代码已提交、已推送、验证已通过、acceptance criteria 已勾选后，才算真正收口。
- 如果 issue 已经关闭但发现正文里还有未勾选项，直接补勾，再保留 closed 状态即可。
