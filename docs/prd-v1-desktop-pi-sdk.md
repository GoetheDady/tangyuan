# 汤圆 v1 PRD：桌面端 Pi Agent SDK 会话闭环

Status: `ready-for-agent`

## Problem Statement

用户想要一个可以直接安装和使用的桌面端 Agent 工作台，而不是每次都从命令行、脚本或零散 SDK 示例开始。第一版需要证明“汤圆”可以作为一个稳定的桌面产品壳，承载 Pi Agent SDK 的真实会话能力。

当前最大的不确定性不是记忆、技能或自我进化，而是第一条产品闭环能不能跑通：用户打开桌面应用，配置必要凭据，创建会话，发送消息，收到真实 Agent 响应，并且能保存和重新打开会话。

这里的 **产品闭环** 指一个用户从开始到完成目标的完整路径。对第一版来说，这条路径就是“安装/启动应用 -> 配置模型 -> 创建会话 -> 发送消息 -> 收到响应 -> 保存历史”。

## Solution

汤圆 v1 将提供一个 Electron 桌面应用，第一版只集成 Pi Agent SDK。用户可以在应用内配置 Provider/API Key，选择模型，创建 Agent 会话，发送消息，查看响应，取消运行，并在重启后继续查看历史会话。

架构上，Renderer UI 不直接调用 Pi Agent SDK。应用会通过 Preload API 把界面操作传给 Electron Main，再由 DesktopAppStore 调用 AgentSessionDriver。第一版只实现 PiSdkDriver，但接口设计必须允许未来替换为自有 Agent Runtime。

几个术语解释：

- **Electron**：用 Web 技术构建桌面应用的框架。它通常包含 Main 和 Renderer。Main 负责系统能力，Renderer 负责界面。
- **Preload API**：Electron 里暴露给界面的安全接口。它像一扇窄门，只允许前端调用被明确允许的方法。
- **IPC**：进程间通信。Electron 的 Main 和 Renderer 是不同进程，它们通过 IPC 发送请求和事件。
- **Driver**：适配层。上层调用统一方法，底层可以换不同实现。
- **AgentSessionDriver**：会话驱动接口，统一定义创建会话、发送消息、取消运行、订阅事件等能力。
- **PiSdkDriver**：第一版的 Driver 实现，内部负责调用 Pi Agent SDK。
- **RuntimeSnapshot**：运行时资源快照，表示当前可用 Provider、模型、设置和认证状态。
- **Agent Home**：某个 Agent 的本地工作目录。v1 默认 Agent 是 `tangyuan`，目录是 `~/.tangyuan/agents/tangyuan`。
- **soul.md**：Agent 的核心身份和行为规则。v1 由首次 bootstrap 对话生成，后续每次会话注入上下文，并允许 Agent 自动更新。
- **user.md**：Agent 对用户的用户画像。它记录用户称呼、语言偏好、工作类型、决策偏好和边界，由 Agent 在会话中自动维护。
- **bootstrap.md**：首次初始化 Agent 时使用的固定问题模板。bootstrap 完成并生成 `soul.md` / `user.md` 后删除。

## User Stories

1. As a 汤圆用户, I want to open a desktop app, so that I can use the Agent without starting from command-line tooling.
2. As a 汤圆用户, I want to see whether the app is ready to use, so that I know if I still need to configure a Provider or model.
3. As a 汤圆用户, I want to configure an API Key, so that the app can call the selected model provider.
4. As a 汤圆用户, I want the app to avoid showing my full API Key after it is saved, so that I do not accidentally expose secrets on screen.
5. As a 汤圆用户, I want to know whether an API Key has already been configured, so that I do not enter it repeatedly.
6. As a 汤圆用户, I want to choose a Provider, so that I can decide which model service should power the Agent.
7. As a 汤圆用户, I want to choose a model, so that I can control which model is used for the session.
8. As a 汤圆用户, I want to refresh available runtime resources, so that the Provider and model list reflects the current configuration.
9. As a 汤圆用户, I want to create a new Agent session, so that I can start a clean task.
10. As a 汤圆用户, I want to see a session list, so that I can switch between previous conversations.
11. As a 汤圆用户, I want to open an existing session, so that I can continue reviewing past work.
12. As a 汤圆用户, I want to type a message into a composer, so that I can give the Agent a task.
13. As a 汤圆用户, I want to send my message to the Agent, so that the Agent can start working.
14. As a 汤圆用户, I want to see my sent message immediately, so that the app feels responsive.
15. As a 汤圆用户, I want to see the Agent response stream or update as it arrives, so that I understand progress before the final answer.
16. As a 汤圆用户, I want to see when the Agent is running, so that I do not accidentally start duplicate work.
17. As a 汤圆用户, I want to cancel a running response, so that I can stop a mistaken or long-running request.
18. As a 汤圆用户, I want to see cancellation reflected in the UI, so that I know the Agent stopped.
19. As a 汤圆用户, I want to see errors in plain language, so that I can fix configuration or retry.
20. As a 汤圆用户, I want the app to preserve the transcript, so that I can return to previous answers.
21. As a 汤圆用户, I want session history to survive app restart, so that my work is not lost.
22. As a 汤圆用户, I want the current selected Provider and model to persist, so that I do not reconfigure every launch.
23. As a 汤圆用户, I want the app to prevent sending a message when required configuration is missing, so that failures are caught early.
24. As a 汤圆用户, I want the app to show enough status information during a run, so that I can distinguish idle, running, cancelled, completed, and failed states.
25. As a 汤圆用户, I want the UI to remain usable while the Agent is running, so that the app does not feel frozen.
26. As a 汤圆用户, I want the first version to be focused and predictable, so that I can trust the core conversation loop before advanced features are added.
27. As a 产品负责人, I want v1 to validate the desktop + Pi SDK path, so that later Memory and Skill work is built on a working foundation.
28. As a 产品负责人, I want clear out-of-scope boundaries, so that the first version does not expand into a full Agent platform.
29. As a 开发者, I want Renderer UI to call a narrow Preload API, so that desktop security boundaries stay clear.
30. As a 开发者, I want Pi Agent SDK usage isolated inside PiSdkDriver, so that SDK-specific behavior does not leak through the app.
31. As a 开发者, I want AgentSessionDriver to define the session contract, so that future Agent runtimes can replace Pi SDK without rewriting the UI.
32. As a 开发者, I want RuntimeResourceDriver to define runtime resource behavior, so that Provider, model, settings, and authentication state are handled consistently.
33. As a 开发者, I want DesktopAppStore to coordinate UI operations, driver events, and persistence, so that app behavior has one clear state center.
34. As a 开发者, I want driver events normalized before reaching the UI, so that the Renderer does not need to understand Pi SDK internals.
35. As a 开发者, I want tests to mock Pi SDK behavior when needed, so that core app behavior can be tested without real model calls.
36. As a 开发者, I want a small number of real Pi SDK integration checks, so that packaging and SDK wiring are still proven.
37. As a 开发者, I want packaging to be tested during v1, so that SDK dependency problems are discovered early.
38. As a 开发者, I want API Key storage decisions to be explicit, so that development shortcuts do not accidentally become production security behavior.
39. As a 开发者, I want the app to expose a RuntimeSnapshot, so that the UI can render available models and configuration state without calling low-level services.
40. As a 未来维护者, I want v1 architecture to keep Memory and Skill out of the critical path, so that future learning features can be added without destabilizing the first product loop.

## Implementation Decisions

- The first release will build an Electron desktop application as the user-facing shell.
- The first release will use Pi Agent SDK as the only real Agent execution backend.
- The application will still define a replaceable AgentSessionDriver interface from the beginning.
- The first implementation of AgentSessionDriver will be PiSdkDriver. Product runtime will not include a fake driver.
- Tests may mock Pi SDK behavior to avoid real model calls in fast local test runs.
- The first release will create only one default agent profile: `tangyuan`.
- The default agent home will be `~/.tangyuan/agents/tangyuan`.
- Runtime and session data structures must include `agentId` so later multi-agent work can add more agents without reshaping core contracts.
- First use will create a fixed `bootstrap.md` under the default agent home.
- The first conversation after verified configuration will run the bootstrap flow, generate `soul.md` and `user.md`, write both files, and delete `bootstrap.md`.
- The generated `soul.md` must cover identity, user preferences, work scope, communication style, permission boundaries, sensitive information rules, memory and skill principles, and behavior under uncertainty.
- The generated `user.md` must cover name preference, language and tone preference, common work types, decision preferences, confirmation requirements, forbidden information boundaries, and long-term preferences.
- Subsequent sessions will inject `soul.md` and `user.md` as agent context.
- v1 will allow the Agent to update `soul.md` and `user.md` during conversation without user approval.
- `soul.md` and `user.md` updates will use Pi SDK `read` / `write` / `edit` tools in v1.
- `soul.md` and `user.md` updates must back up the previous version under `soul.history/` or `user.history/`.
- Automatic `soul.md` / `user.md` updates must show a non-blocking system message in the transcript.
- Automatic updates are evaluated at most once after each main reply through a background profile maintenance turn.
- Profile maintenance turns use the same Agent context but must not be mixed into the user-facing main reply.
- Bootstrap completion is decided by the Agent using the fixed question list and the user's answers.
- The v1 UI must show lightweight profile status: initialized state, latest `soul.md` / `user.md` update time, and configuration state.
- Secrets must never be written into `soul.md` or `user.md`.
- Pi SDK supports tool-name allowlists and custom `cwd`, but v1 does not treat this as a strong path sandbox.
- Strong filesystem isolation is out of scope for v1 and should be handled later through containerization, sandboxing, or wrapped tools.
- Renderer UI will not import or directly call Pi Agent SDK.
- Renderer UI will communicate with Electron Main through a typed Preload API.
- DesktopAppStore will be the state coordination center for session state, runtime resources, driver events, and local persistence.
- PiSdkDriver will be the only module that knows Pi Agent SDK details in v1.
- RuntimeResourceDriver will expose Provider, model, selected model, API Key status, and basic settings through RuntimeSnapshot.
- RuntimeSnapshot will be treated as a read model for the UI. A read model means data shaped for display and interaction, rather than raw SDK internals.
- Session state will include at least idle, running, completed, cancelled, and failed.
- Conversation persistence is required for v1. Users must be able to restart the app and see previous sessions.
- Configuration will be stored as local JSON under Electron userData, including Provider, model, and API Key.
- API Key is stored as plaintext JSON for MVP. The UI must avoid showing the full key after save, and logs/tests must never print real keys.
- Configuration must be verified with a real Pi SDK model call before it is saved.
- Failed configuration verification must leave the user on the configuration screen and must not persist the API Key.
- Configuration verification must disable tools, avoid writing session history, and display only sanitized errors.
- Secure credential storage is out of scope for v1 and should be handled by a later security issue.
- Conversation history will use Pi SDK native session persistence as the source of truth.
- Tangyuan JSON files will store only configuration, session index data, summaries, and UI metadata.
- SQLite, Markdown, and dual-write storage are out of scope for v1.
- Packaging verification is part of v1, not a later cleanup task.
- v1 should include enough UI to operate the real loop: session list, transcript, composer, run state, cancel action, Provider/model settings, and error display.
- v1 should not include automatic Memory writes, Skill self-evolution, plugin marketplace, multi-Agent orchestration, or a custom Agent Runtime.
- Memory and Skill concepts may appear in architecture notes, but they must not block v1 delivery.
- The primary architecture should remain compatible with future Memory and Skill layers by keeping prompt/context assembly outside the Renderer.
- Pi Agent SDK capabilities and staged support decisions are tracked in `docs/pi-agent-sdk-capability-plan.md`.

## Testing Decisions

- The highest primary test seam is DesktopAppStore plus AgentSessionDriver.
- A **test seam** is the boundary where tests interact with the system. Choosing a higher seam means testing more real behavior together while replacing only the slow or external part.
- Tests should focus on external behavior: what the app does when a user creates a session, sends a message, receives events, cancels a run, hits an error, and restarts.
- Tests should not assert Pi SDK implementation details. They should assert normalized app behavior.
- Core app tests may mock Pi SDK behavior to simulate successful responses, streaming events, cancellation, and errors.
- Runtime resource tests should verify Provider/model selection, API Key configured state, and RuntimeSnapshot updates.
- Persistence tests should verify that sessions and selected settings survive restart-like reload behavior.
- Renderer-level tests should verify that users can perform the main flow through visible controls and status changes.
- A small set of integration tests or manual verification steps should exercise the real PiSdkDriver with Pi Agent SDK.
- A packaging smoke test should verify that the desktop app starts after packaging and can reach the configuration screen.
- If real model calls are expensive or unstable, they should be limited to explicit integration checks and kept out of fast local test runs.
- Good v1 tests should catch regressions in the user-visible loop without making refactors painful.

## Out of Scope

- Automatic long-term Memory extraction.
- Manual Memory management UI.
- Skill creation, Skill editing, and Skill marketplace behavior.
- Background learning review Worker.
- Multi-Agent collaboration.
- Custom Agent Runtime.
- Cloud synchronization.
- Team accounts or shared workspaces.
- Advanced tool permissions.
- Fine-grained prompt engineering UI.
- Plugin ecosystem.
- Deep transcript search.
- Mobile app.
- Browser extension.
- Full Windows and macOS release pipeline beyond initial packaging verification.

## Further Notes

This PRD intentionally narrows the first release. The first milestone is not “make the final Agent platform”; it is “prove that 汤圆 can be a reliable desktop shell around a real Pi Agent SDK session.”

The next planning artifact after this PRD should be an implementation issue list. Each issue should be small enough for an agent to complete independently, while preserving the v1 architecture boundary: UI talks to Preload API, Main talks to DesktopAppStore, DesktopAppStore talks to Driver interfaces, and Pi SDK remains behind PiSdkDriver.

The project does not currently have an issue tracker configured in this workspace. Until one is configured, this document is the local `ready-for-agent` PRD source of truth.
