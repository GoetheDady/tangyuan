import type {
  BashApprovalRequest,
  QuestionClarificationRequest,
} from '@tangyuan/contracts'
import type { ToolApprovalGateway } from './index'
import type { BashApprovalRegistry } from './bash-approval-registry'
import type { ClarificationRegistry } from './clarification-registry'
import { validateFilePath } from './file-path-guard'

/**
 * 创建 ToolApprovalGateway 所需的依赖。
 */
export interface ToolApprovalGatewayDependencies {
  bashApprovals: BashApprovalRegistry
  clarifications: ClarificationRegistry
  /** 根据会话查回当前 active run 的 runId，用于补齐工具构造时缺失的 runId。 */
  resolveRunId: (sessionId: string) => string
  now: () => string
}

/**
 * 构造供 PiSdkDriver 注入到自定义工具的 ToolApprovalGateway。
 *
 * 负责把工具侧的原始参数组装成结构化的审批/澄清请求（补齐 runId、
 * 生成 id 和时间戳），再交给对应登记表等待用户决议；文件路径校验直接
 * 走纯函数 file-path-guard。不持有状态。
 *
 * @param deps - 登记表、runId 解析器与时间源。
 * @returns ToolApprovalGateway 实例。
 */
export function createToolApprovalGateway(
  deps: ToolApprovalGatewayDependencies,
): ToolApprovalGateway {
  const { bashApprovals, clarifications, resolveRunId, now } = deps

  return {
    requestBashApproval: async (params) => {
      // bash 工具在 session 建立时构造，那时还没有 runId；
      // 真正执行时一定处于某个 active run 内，用它补齐。
      const request: BashApprovalRequest = {
        approvalId: crypto.randomUUID(),
        agentId: params.agentId,
        sessionId: params.sessionId,
        runId: params.runId || resolveRunId(params.sessionId),
        command: params.command,
        cwd: params.cwd,
        riskDescription: params.riskDescription,
        status: 'pending',
        createdAt: now(),
      }

      return bashApprovals.register(request)
    },

    validateFilePath: (params) => validateFilePath(params),

    requestClarification: async (params) => {
      const request: QuestionClarificationRequest = {
        clarificationId: crypto.randomUUID(),
        agentId: params.agentId,
        sessionId: params.sessionId,
        runId: params.runId || resolveRunId(params.sessionId),
        question: params.question,
        options: params.options,
        allowCustomAnswer: params.allowCustomAnswer,
        status: 'pending',
        createdAt: now(),
      }

      return clarifications.register(request)
    },
  }
}
