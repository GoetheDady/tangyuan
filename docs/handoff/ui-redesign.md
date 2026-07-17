# 汤圆 UI 重设计交接

## 目标

继续在 Pencil 中建立统一的汤圆 UI 设计系统。当前阶段只设计和确认规范与组件，不修改产品代码；所有组件确认后，才能开始完整页面设计，页面设计确认后再进入实现。

## 核心产物

- 项目内 Pencil 文件：`docs/design/tangyuan-ui.pen`
- 该项目副本已经过哈希一致性校验，并由 Pencil 成功读取。
- 后续必须直接打开并编辑项目内副本。此前 Pencil 打开的外部文件只是来源快照，继续编辑它不会自动同步到项目。
- 用户提供的 Ant Design 参考规范位于同级仓库 `../ant-design/docs/spec/`，设计稿已经吸收其中的布局、字体、阴影、动效、亲密性、对齐、对比和反馈原则。

## 协作方式

1. 一次只设计一个组件。
2. 每个组件完成布局检查和截图检查后，交给用户确认。
3. 用户明确确认前，不得开始下一个组件。
4. 组件全部确认前，不得开始整页 UI。
5. 整页 UI 确认前，不得修改产品代码。

## 当前状态

已确认：

- `00 基础规范`，Pencil 节点 `UVk1L`
- `01 Button 组件`，节点 `IiJZ9`
- `02 Input 组件`，节点 `n0PzQU`
- `03 Textarea 组件`，节点 `cVR9i`
- `04 Select 组件`，节点 `o9Xft`
- `05 Field 组件`，节点 `knoXw`
- `06 InputGroup 组件`，节点 `KWlgr`
- `07 Badge 组件`，节点 `cjmQt`

已设计并校验、等待用户明确确认：

- `08 Card 组件`，节点 `DCStC`

新会话的第一步是打开项目内 Pencil 文件并请用户确认 `08 Card`。不要直接设计下一个组件。

## 已确定的设计规则

- 组件基础：shadcn/new-york、Radix UI；图标统一使用 Lucide。
- 品牌方向：保留糯米白、芝麻黑、豆青、红豆色，不引入 Ant Design 蓝色作为主色。
- 布局：8px 基准网格，4px 仅用于组件内部微调。
- 字体：正文基准 14px/22px，常用字重 400、500、600。
- 桌面适配：重点覆盖 1024、1280、1440+ 宽度。
- 阴影：Level 0–3 只表达真实层级；Input、Textarea、Select Trigger 和默认 Card 属于 Level 0，不使用阴影；Select Content 使用 Level 2。
- 动效：0/100/160/240ms，服务于状态反馈，不作为装饰。
- 边框：结构分隔和控件默认使用 1px；聚焦和错误使用外层焦点环，不使用粗描边。
- 状态不能只依赖颜色，必须同时提供文字、图标或结构变化。
- 不使用 Card 嵌套 Card。

已确认或当前设计稿采用的细节：

- Button 水平内边距：xs 6px、sm 10px、default 12px、lg 18px。
- Field 横向布局：120px 标签列、12px 标签与内容间距。
- Badge：22px 高、6px 圆角、7px 水平内边距、11px/600 字体、无阴影；包含 `success` 语义变体。
- Card（待确认）：8px 圆角、默认 20px 内边距、紧凑模式 16px；默认 Level 0；整卡可操作时才展示悬停、键盘聚焦、按下、选中和禁用状态。

## Card 待确认内容

`08 Card` 已包含：

- Header、Content、Footer 完整组合结构。
- Level 0 默认、Level 1 浮起和 Muted 次级容器样式。
- 整卡操作的默认、悬停、键盘聚焦、按下、选中、禁用状态。
- 静态 Card 不响应悬停、不显示焦点环。
- 整卡操作必须由链接、按钮或选择控件提供可访问语义。
- Pencil 布局检查结果为无裁切、无溢出、无重叠。

## 后续组件候选

项目当前已有但尚未设计的 UI 组件包括 `Alert`、`Separator`、`Tooltip`、`AlertDialog`。Card 获得确认后，再结合页面使用频率选择其中一个；建议先设计 `Alert`，因为它建立成功、警告、错误和信息反馈的视觉规则。

不要在设计阶段处理 shadcn CLI 环境问题。当前 `pnpm dlx shadcn@latest` 会因本机 `zod` 包导出冲突失败，设计依据应使用项目现有组件源码、Pencil 基础规范和 shadcn 技能规则。

## Pencil 操作注意事项

- `.pen` 文件只能通过 Pencil 工具读取和修改，不要用文本工具解析。
- 新建顶层画板时先使用 `FindEmptySpace`，整个编辑期间设置 `placeholder: true`，完成后立即取消。
- 创建新顶层画板后，优先分批添加内容；不要在同一次插入中先创建空容器再逐层插入大量子节点。
- 本次 Card 曾出现统一 50px 偏移。有效修复方式是使用 `Replace` 一次性写入包含 `children` 的完整子树，再运行 `snapshot_layout` 和 `get_screenshot`。
- 每完成一个组件都必须检查裁切、溢出、对齐、颜色对比、边框、阴影和状态表达。

## 仓库约束

- 工作区存在大量用户未提交改动，不要回退、覆盖或格式化无关文件。
- 仓库存在 `.codegraph/`；理解或定位代码时先使用 `codegraph explore`，再使用 `rg`。
- 如果后续开始编写方法，必须提供完整的方法注释，并在回复中解释首次出现的专业术语。
- 本轮只新增设计文件和本交接文档，没有修改产品实现。

## Suggested Skills

- `build-web-apps:frontend-app-builder`：继续组件设计、整页概念确认以及后续高保真实现流程。
- `build-web-apps:shadcn`：核对 shadcn 组件结构、语义、变体和交互状态。
- `build-web-apps:frontend-testing-debugging`：仅在设计全部确认并进入代码实现后，用于浏览器视觉验证和问题修复。
