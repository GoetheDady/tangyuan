import type { AppHarness } from './app-harness'

/**
 * 一次技术不变量检查的结果。
 *
 * 这些不变量与「测什么场景」无关——无论 Hermes 选择发什么消息、走哪条流程，
 * 它们都必须成立。违反即视为技术层面的 bug 信号，可据此提 issue。
 * 不判断模型回复内容质量（那由模型决定，不在判据内）。
 */
export interface InvariantViolation {
  /** 违反的不变量名称，用于 issue 去重归类。 */
  code: string
  /** 面向人类的说明。 */
  message: string
  /** 相关证据（错误文本、状态值等）。 */
  detail?: string
}

/**
 * 检查应用是否仍然存活且无运行时错误。
 *
 * @param harness - 应用夹具。
 * @returns 违反的不变量列表；为空表示通过。
 */
export async function checkAppHealth(harness: AppHarness): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = []

  // 窗口未被销毁
  if (harness.app.windows().length === 0) {
    violations.push({
      code: 'window-closed',
      message: '应用窗口在测试过程中意外关闭（可能崩溃）。'
    })
    return violations
  }

  // 无未捕获页面异常
  if (harness.pageErrors.length > 0) {
    violations.push({
      code: 'page-error',
      message: '渲染进程出现未捕获异常。',
      detail: harness.pageErrors.join('\n')
    })
  }

  // 无控制台 error
  if (harness.consoleErrors.length > 0) {
    violations.push({
      code: 'console-error',
      message: '渲染进程控制台出现 error 级日志。',
      detail: harness.consoleErrors.join('\n')
    })
  }

  // 页面未白屏：body 有可见文本
  const bodyText = await harness.window.evaluate(() => document.body.innerText?.trim() ?? '')
  if (bodyText.length === 0) {
    violations.push({
      code: 'blank-screen',
      message: '页面渲染为空白（body 无文本）。'
    })
  }

  return violations
}

/**
 * 检查运行时配置是否就绪（能进行真实对话的前提）。
 *
 * @param harness - 应用夹具。
 * @returns 违反列表；配置缺失会阻断后续对话测试。
 */
export async function checkRuntimeReady(harness: AppHarness): Promise<InvariantViolation[]> {
  const snapshot = await harness.window.evaluate(async () => {
    return await (
      window as unknown as { api: { getRuntimeSnapshot: () => Promise<{ status?: string }> } }
    ).api.getRuntimeSnapshot()
  })

  if (snapshot?.status !== 'ready') {
    return [
      {
        code: 'runtime-not-ready',
        message: '运行时未就绪，无法进行真实对话（通常是 Provider/API Key 未配置或钥匙串不可用）。',
        detail: `status=${String(snapshot?.status)}`
      }
    ]
  }

  return []
}
