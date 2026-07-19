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
