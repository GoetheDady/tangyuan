# 分层加载共享与 Agent 专属 Skill

汤圆直接使用 Pi Agent 的 `DefaultResourceLoader` 加载 Skill，不自建 Skill 解析器。共享 Skill 位于 `~/.tangyuan/skills/`，Agent 专属 Skill 位于 `~/.tangyuan/agents/<agentId>/skills/`；每个 Agent session 使用自己的 loader，并设置 `noSkills: true`，防止自动混入汤圆管理范围外的 Pi、Codex 或项目 Skill。

`additionalSkillPaths` 固定按 Agent 专属目录、共享目录排序。Pi 对同名 Skill 使用先加载者生效的规则，因此 Agent 专属版本覆盖共享版本，并在控制台展示冲突诊断。安全规则和权限限制不得放在可覆盖 Skill 中，而应由系统提示词、工具授权和 Main 进程校验强制执行。

Agent 专属 Skill 变更后 reload 该 Agent 的活跃 session；共享 Skill 变更后 reload 所有活跃 Agent session。目录内容是 Skill 事实来源，`config.json` 只保存启停、来源和安装记录等扩展状态。

默认 Agent“汤圆”通过受控工具管理共享 Skill；每个 Agent 只能管理自己的专属 Skill，不能修改其他 Agent 的目录。新增、更新或删除 Skill 前必须获得用户确认，Main 校验目标路径、`SKILL.md` 和同名覆盖诊断，并对携带脚本的 Skill 展示来源与执行风险。汤圆保持 Pi Agent Skills 标准和加载行为，只增加权限与产品界面，不另造 Skill 格式。
