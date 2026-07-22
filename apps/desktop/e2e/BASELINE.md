# Renderer E2E 基线

## #33 开始前（2026-07-19）

在提交 `42de379` 的普通生产 Renderer 构建上，先手动启动 `out/renderer` 静态服务器，再运行完整 `chromium-renderer` project：

- 38 passed
- 14 failed
- 0 skipped

14 个失败均为既有配置页测试债务：页面已经改用 Radix Select，但用例仍等待已不存在的原生 `#provider` 定位器。它们不是 #33 引入的回归。

### 失败清单

- `routing.spec.ts`（4）
  - 配置阻断保留原始目标并在配置完成后返回
  - 直接访问 `/#/console/providers` 渲染配置表单
  - 刷新后保持在当前 console 页面
  - 浏览器后退按钮可在控制台页面间导航
- `screenshots.spec.ts`（1）
  - 配置页截图与无障碍
- `setup-page.spec.ts`（9）
  - runtime 未就绪时 `/#/chat` 重定向到 `/#/console/providers`
  - 配置页显示 Provider select 和选项
  - 配置页显示 Model select
  - 选择 Provider 后 Model select 过滤对应模型
  - 配置页显示 API Key 输入框
  - 所有字段为空时提交按钮 disabled
  - 填写所有字段后提交按钮可用
  - 显示“刷新资源”按钮
  - 显示配置说明文本

## #33 的处理边界

- 不批量修复上述 14 个用例，也不修改配置页面实现。
- 原 `screenshots.spec.ts` 混合 ARIA 自动断言与只写 PNG 的 artifact；#33 将两种职责拆成 `accessibility.spec.ts` 与 `artifacts.spec.ts`。
- 旧 `#provider` 同时阻塞配置页 ARIA 回归和 artifact 命令，因此 #33 仅对这一项采用当前可访问名称做最小修复；其余 13 个配置页结构/交互债务保持不动。
- `artifacts.spec.ts` 移出常规 Renderer project，明确归类为人工验收 artifact；自动 ARIA 断言仍在常规 project 中运行。
- Playwright 静态服务器无法由现有 project 级 `webServer` 可靠启动，直接导致 52 个 `ERR_CONNECTION_REFUSED`。该问题属于 #33 的验收基础设施范围，采用顶层 `webServer` 做最小修复。

## #48 跨组件视觉验收（2026-07-21）

基础组件夹具完成 9 个分区的统一 Renderer 与视觉门禁，并以 `docs/design/tangyuan-ui.pen` 的组件画板逐区核对尺寸、间距、排版、边框、焦点环、语义色、动效和阴影层级。

### 固定视觉环境

- Playwright：`1.61.1`（由 `pnpm-lock.yaml` 锁定）
- Chromium：`149.0.7827.55`（Playwright 随附版本）
- 平台快照后缀：`darwin`
- viewport：`1440×1000`
- `deviceScaleFactor=1`
- `colorScheme=light`
- `locale=zh-CN`
- `timezoneId=Asia/Shanghai`
- `reducedMotion=reduce`
- 截图时额外固定 `animations=disabled`、`caret=hide`、`scale=css`

### 基准更新理由

- 补齐此前按 #43 范围调整而延后的 Tooltip 分区与 top/right/bottom/left 打开态视觉基准。
- Pencil 的 Tooltip 规格要求 6px 圆角、12px 字体、水平 12px/垂直 6px 内边距、Level 2 阴影、160ms 入场以及 `sideOffset=0`。真实 Chromium 验收发现组件默认仍为 `sideOffset=4`，因此做了 4px→0px 的小范围一致性修正；自定义 `sideOffset` 和边缘自动避让能力保持不变。
- 四方位展示样例固定关闭 collision avoidance，确保视觉基准稳定呈现指定方位；独立的右侧边缘样例继续启用 Radix 自动避让。
- 新增 `1024`、`1280`、`1440` 三档结构验收，检查全部分区、Tooltip、DropdownMenu 子菜单和 AlertDialog Portal 不发生水平溢出或视口裁切。
- 本次未修改聊天主界面、初始化配置页面或设置页面 JSX 布局。

### Pencil 逐区对照结果

| 夹具分区         | 对照组件                                  | 逐区结论                                                                  |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `actions`        | Button                                    | 高度、8px 圆角、排版、图标间距及 disabled/invalid/hover/active/focus 通过 |
| `tooltips`       | Tooltip                                   | 6px 圆角、间距、箭头、Level 2、160ms 和四方位通过；默认偏移修正为 0px     |
| `separators`     | Separator                                 | 1px 水平/垂直线、内缩组合、语义和 Level 0 通过                            |
| `forms`          | Input、Textarea、Label、Field、InputGroup | 36px 常用控件、8px 圆角、标签关联、状态传播、焦点环和响应式排列通过       |
| `selects`        | Select                                    | Trigger/Portal 尺寸、8px 圆角、分组、滚动、键盘、动效和 Level 2 通过      |
| `dropdown-menus` | DropdownMenu                              | 6px 圆角、分组/选择/子菜单、键盘、Portal 定位和 Level 2 通过              |
| `feedback`       | Badge、Alert、Card、AlertDialog、Toast    | 语义色、6px/8px 圆角关系、Level 0–3、内容组合和通知堆叠通过               |
| `alert-dialogs`  | AlertDialog                               | default/sm、危险与长内容、焦点陷阱、240ms 动效、Level 3 和安全边距通过    |
| `cards`          | Card                                      | default/compact、8px 圆角、Level 0、长内容和整卡交互状态通过              |

## #59 对话业务组件跨组件验收（2026-07-22）

新增独立 `conversation-components` Renderer 夹具，并以 `docs/design/tangyuan-ui.pen` 中的 Composer、User Message、Assistant Message、Bash Approval 和 Question Clarification 画板逐区核对尺寸、间距、排版、圆角、边框、语义颜色、阴影层级、图标、执行轨道和状态文案。

### 固定视觉环境

沿用 #48 的独立视觉环境：Playwright 锁定版本附带 Chromium、`1440×1000` viewport、`deviceScaleFactor=1`、`colorScheme=light`、`locale=zh-CN`、`timezoneId=Asia/Shanghai`、`reducedMotion=reduce`，截图固定 `animations=disabled`、`caret=hide` 和 `scale=css`。夹具数据使用固定的 `2026-07-22` 时间戳与 4.25 秒耗时，不依赖系统当前时间、随机数、真实 API Key 或网络。

### 基准更新理由

- 首次建立完整消息流、消息原语、Assistant 状态矩阵、Bash/澄清动作、Composer 状态和手动展开/聚焦状态的对话专属像素基准。
- 基准同时记录 Bash 已处理和 Question Clarification 已确认的短暂完成状态，避免只验收待处理卡片。
- 视觉基准仅在 `chromium-fixtures-visual` 标准环境执行；常规 Renderer/fixture 回归继续以行为、ARIA、几何和溢出断言为门禁。
- 本次没有接受产品视觉改版；新增 PNG 是对 Issue #50–#58 已完成组件的首次跨组件基线固化。

### Pencil 对照结论

- Composer：输入区、分隔线、模型/思考/附件控制栏和发送/停止动作保持单卡层级；附件仅为禁用占位。
- User/Assistant：用户纯文本右对齐，Agent Markdown 左对齐；执行 disclosure、时间线、候选正文、失败/取消与最终正文层级一致。
- Bash Approval：命令、工作目录、风险说明、警告和三决策按钮保持同一警告表面，完成态切换为成功语义。
- Question Clarification：单问题、单选项、自定义输入、取消和已回答状态保持同一主色表面与键盘焦点顺序。
- Transcript：压缩提示不进入对话气泡；长历史使用稳定条目身份和虚拟列表，不在会话切换时复用上一会话节点。

## #59 后续修正：真实 ChatPage Pencil 基准（2026-07-22）

原 #59 基准只覆盖 `conversation-components` 组件夹具；父 PRD #49 又明确把完整 ChatPage JSX 与 Sidebar 画板实现列为 Out of Scope，因此出现“组件截图通过，但产品页面仍沿用旧布局”的验收盲区。

### 修正内容

- 真实 ChatPage 改为 Pencil 的 `64px Agent Rail + 216px Session Pane` 双栏侧边栏，总宽保持 `280px`。
- 标题栏固定为 `48px`；在 Pencil 原生 `1168×820` 视口下，消息区固定为 `720×630px`，Composer 区为 `888×142px`，Composer 卡片为 `720×131px`、`20px` 圆角。
- User Message 使用 `max-width: 360px`、次级色表面、`16-16-4-16` 圆角、12/16px 内边距和 10px 时间戳；Assistant Message 移除旧卡片阴影与外边框，回到 640px 左对齐消息列。
- Composer 按 Pencil 改为单一模型 pill、思考强度轨道、附件与发送/停止图标控制；Provider 不再作为聊天输入区中的独立视觉控件。
- macOS BrowserWindow 使用 `hiddenInset` 标题栏，使系统 traffic lights 与 64px Agent Rail 对齐。
- 新增 `chat-page.visual.spec.ts`，在固定 `1168×820` viewport 下直接截图真实产品路由，而不是再次截图组件夹具。

### 基准更新理由

本次更新 `integrated`、`assistant-states`、`composer-states`、Composer focus、Assistant expanded 和 Bash resolved 六张组件基准，并新增真实 ChatPage 基准。更新原因不是产品视觉改版，而是纠正旧基准对 Pencil 的错误实现，并补上真实页面未被视觉门禁覆盖的缺口。
