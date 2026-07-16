# Pi Agent 0.80.3 Skills 支持研究

研究对象：项目当前安装的 `@earendil-works/pi-coding-agent@0.80.3`。上游官方仓库版本固定到 tag `v0.80.3`（commit `a23abe4a695df8b69b613f73e9fdda2a8af894d4`），避免后续主分支变化影响结论。

## 结论

Pi 原生支持 Skills，不需要汤圆自建 Skill 解析器。推荐汤圆显式配置两层目录：

```text
~/.tangyuan/
├── skills/                         # 所有 Agent 共享
└── agents/<agentId>/skills/        # 当前 Agent 专属
```

每次为 Agent 创建 Pi `ResourceLoader` 时，关闭 Pi 默认 Skill 自动发现，仅装载这两层：

```ts
const loader = new DefaultResourceLoader({
  cwd: agentWorkspacePath,
  agentDir: piAgentDir,
  noSkills: true,
  additionalSkillPaths: [agentSkillsPath, sharedSkillsPath],
})

await loader.reload()
```

`ResourceLoader` = Pi 用于发现、校验并向会话提供 Skill 等资源的加载器。

专属目录必须排在共享目录前。Pi 同名 Skill 采用“先加载者胜”，后者只产生冲突诊断，不覆盖前者。因此 Agent 可用同名 Skill 覆盖共享默认版本。当前安装版本已用双目录最小实验验证该顺序。

使用 `noSkills: true` 很重要：它避免自动混入用户机器上的 `~/.pi/agent/skills`、`~/.agents/skills`，以及 Agent workspace 或祖先目录中的 `.pi/skills`、`.agents/skills`。这样汤圆可明确控制每个 Agent 实际拥有的能力集合。显式 `additionalSkillPaths` 在 `noSkills` 开启后仍会加载。[官方类型定义](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.d.ts#L61-L85)；[加载实现](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js#L284-L295)

## Pi 默认发现范围

不自定义 `ResourceLoader` 时，Pi 会发现：

- 全局：`~/.pi/agent/skills/`、`~/.agents/skills/`
- 项目：`<cwd>/.pi/skills/`
- 项目与祖先目录：`.agents/skills/`，向上扫描到 Git 仓库根；不在 Git 仓库时扫到文件系统根
- Package：包内 `skills/` 或 `package.json` 的 `pi.skills`
- Settings：`settings.json` 的 `skills` 文件或目录数组
- CLI：可重复的 `--skill <path>`

项目 Skill 只有项目被信任后才加载。`cwd` = 当前工作目录，也是 Pi 判断项目级资源范围的起点。[官方 Skills 文档](https://github.com/earendil-works/pi/blob/a23abe4a695df8b69b613f73e9fdda2a8af894d4/packages/coding-agent/docs/skills.md#locations)；[祖先目录扫描实现](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js#L260-L290)

默认资源同名时，官方源码定义优先级如下，高者先加载并获胜：

1. 项目 settings 显式条目
2. 项目自动发现
3. 用户 settings 显式条目
4. 用户自动发现
5. Package 资源

[优先级源码](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js#L48-L65)；[排序源码](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js#L1981-L2003)

## 目录扫描规则

- 任意扫描位置中，只要目录含 `SKILL.md`，该目录就是一个 Skill 根目录；不会继续递归其内部寻找其他 Skill。
- 其他子目录会递归扫描 `SKILL.md`。
- `~/.pi/agent/skills/` 与 `.pi/skills/` 根目录下的普通 `.md` 文件也可作为单文件 Skill。
- `.agents/skills/` 根目录下普通 `.md` 文件会忽略，只认递归发现的 `SKILL.md`。
- 隐藏目录、`node_modules` 会跳过；`.gitignore`、`.ignore`、`.fdignore` 规则会参与过滤。
- 指向目录或文件的符号链接会跟随；同一真实文件经多个符号链接发现时会静默去重。

[官方发现规则](https://github.com/earendil-works/pi/blob/a23abe4a695df8b69b613f73e9fdda2a8af894d4/packages/coding-agent/docs/skills.md#locations)；[扫描实现](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js#L113-L207)；[真实路径去重](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js#L291-L327)

## `SKILL.md` 结构与校验

推荐结构：

```text
skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

最小 `SKILL.md`：

```md
---
name: skill-name
description: 该 Skill 做什么，以及什么情况下使用。
---

# Instructions

具体操作说明。
```

关键规则：

- `description` 实际必需；缺失或空值时 Skill 不加载。
- `name` 文档标准标为必需，但 0.80.3 实现缺失时会退回父目录名。
- `name` 建议 1–64 字符，仅小写字母、数字、连字符；不能首尾连字符，不能连续连字符。
- `description` 最长 1024 字符。
- 多数格式违规只产生 warning（警告），Skill 仍加载。
- Pi 允许 frontmatter 中的 `name` 与父目录名不同。
- `disable-model-invocation: true` 会把 Skill 从系统提示词隐藏，但仍允许用户显式执行 `/skill:<name>`。
- `scripts/`、`references/`、`assets/` 不是固定协议；它们只是约定目录。Skill 正文中的相对路径以 `SKILL.md` 所在目录为基准。

[官方结构与字段](https://github.com/earendil-works/pi/blob/a23abe4a695df8b69b613f73e9fdda2a8af894d4/packages/coding-agent/docs/skills.md#skill-structure)；[解析与校验实现](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js#L208-L247)

## 运行时加载方式

Pi 使用“渐进披露”：启动或 reload 时只扫描 Skill，并把 `name`、`description`、`SKILL.md` 路径写入系统提示词；不会把所有 Skill 正文一次性塞进模型上下文。任务匹配后，模型通过 `read` 工具读取完整 `SKILL.md`。[官方说明](https://github.com/earendil-works/pi/blob/a23abe4a695df8b69b613f73e9fdda2a8af894d4/packages/coding-agent/docs/skills.md#how-skills-work)；[XML 提示词格式实现](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js#L249-L277)

系统提示词只有在会话具备 `read` 工具时才列出可由模型调用的 Skills。因此汤圆若希望模型自动使用 Skill，必须保留 Pi 的 `read` 能力，或自行设计等价加载工具。[系统提示词实现](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js#L102-L114)

显式 `/skill:<name> 参数` 会读取对应文件、移除 frontmatter，把正文包装成 `<skill>` 块，并把参数追加到正文后。该入口可强制使用 Skill，也可调用 `disable-model-invocation` Skill。[命令展开实现](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L881-L909)

Skill 文件变更后不会自动热更新。应调用 `session.reload()`；它会重新加载 `ResourceLoader` 并重建会话运行时与系统提示词。[reload 实现](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L1966-L1986)

## SDK 可配置能力

Pi SDK 已直接提供：

- `DefaultResourceLoader.additionalSkillPaths`：追加 Skill 文件或目录
- `DefaultResourceLoader.noSkills`：关闭默认发现
- `DefaultResourceLoader.skillsOverride`：过滤、合并或完全替换发现结果
- `loadSkills()`、`loadSkillsFromDir()`：直接加载 Skill
- 自定义 `ResourceLoader`：完全接管 Skills、Extensions、Prompts、Themes、上下文文件等资源

传入自定义 `ResourceLoader` 后，`createAgentSession()` 不会替调用方执行 `reload()`；汤圆需先 `await loader.reload()`，再创建 session。[SDK 文档](https://github.com/earendil-works/pi/blob/a23abe4a695df8b69b613f73e9fdda2a8af894d4/packages/coding-agent/docs/sdk.md#resourceloader)；[SDK 创建实现](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js#L63-L78)

## Tangyuan 架构建议

1. 共享 Skills 固定在 `~/.tangyuan/skills/`。
2. Agent 专属 Skills 固定在 `~/.tangyuan/agents/<agentId>/skills/`。
3. 每个 Agent session 使用独立 `DefaultResourceLoader`。
4. 使用 `noSkills: true`，避免汤圆边界外的 Pi/Codex/Claude Skills 自动混入。
5. `additionalSkillPaths` 顺序固定为 `[agentSkillsPath, sharedSkillsPath]`，专属同名 Skill 覆盖共享 Skill。
6. 读取并展示 `loader.getSkills().diagnostics`。同名覆盖虽然可工作，但应在控制台明确显示 winner（生效版本）与 loser（被忽略版本）。
7. 安装、删除、启停 Skill 后调用当前 Agent session 的 `reload()`；其他 Agent 无需 reload，除非改动的是共享 Skill。
8. 共享 Skill 变更后 reload 所有活跃 Agent session；未活跃 Agent 下次创建 session 时自然读取最新版。
9. MVP 不必把 Skill 列表写入 `config.json`。目录内容是 Skill 事实来源；`config.json` 只需保存扩展元数据，例如禁用状态、来源、安装记录。若要支持单个 Skill 启停，可用 `skillsOverride` 按配置过滤。
10. Agent 归档时保留其专属 Skills；恢复后继续可用。共享 Skills 不随 Agent 生命周期移动。

## 风险

- Skill 可指示模型执行命令，也可携带脚本，等同本地可执行能力扩展。安装前必须展示来源并要求用户信任；官方文档也明确要求审查 Skill 内容。[安全提示](https://github.com/earendil-works/pi/blob/a23abe4a695df8b69b613f73e9fdda2a8af894d4/packages/coding-agent/docs/skills.md#locations)
- “同名专属覆盖共享”依赖 Pi 0.80.3 的 first-wins（先加载者胜）规则。升级 Pi 时需保留自动化回归测试：构造两个同名 Skill，断言专属目录版本获胜并产生 collision diagnostic（冲突诊断）。[冲突实现](../../packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js#L300-L327)
- 不应把 Agent workspace 直接作为 `agentDir`。`agentDir` 同时影响 settings、credentials、sessions 等 Pi 全局资源。汤圆应通过自定义 `ResourceLoader` 单独注入 Skill 路径，保持 Skills 隔离与模型凭据架构解耦。[目录语义](https://github.com/earendil-works/pi/blob/a23abe4a695df8b69b613f73e9fdda2a8af894d4/packages/coding-agent/docs/sdk.md#directories)
