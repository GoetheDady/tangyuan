import type { AppHarness } from './app-harness'
import type { InvariantViolation } from './invariants'

/**
 * 会话管理不变量：新建的会话必须出现在会话列表中。
 *
 * @param harness - 应用夹具。
 * @param sessionId - 已创建的会话 id。
 * @returns 违反列表。
 */
export async function checkSessionListed(
  harness: AppHarness,
  sessionId: string
): Promise<InvariantViolation[]> {
  const listed = await harness.window.evaluate(async (sessionId) => {
    const api = (
      window as unknown as {
        api: { listSessions: () => Promise<Array<{ sessionId: string }>> }
      }
    ).api
    const sessions = await api.listSessions()
    return sessions.some((s) => s.sessionId === sessionId)
  }, sessionId)

  if (!listed) {
    return [
      {
        code: 'session-not-listed',
        message: '新建的会话未出现在 listSessions 返回的会话列表中。',
        detail: `sessionId=${sessionId}`
      }
    ]
  }
  return []
}

/**
 * Agent 列表不变量：listAgents 返回默认 Agent 且所有条目状态合法。
 *
 * 说明：Agent 创建/归档/恢复不通过简单 API 暴露，且归档默认 Agent 具破坏性，
 * 故此处只做安全的只读校验，不改动 Agent 状态。
 *
 * @param harness - 应用夹具。
 * @returns 违反列表。
 */
export async function checkAgentsListed(harness: AppHarness): Promise<InvariantViolation[]> {
  return await harness.window.evaluate(async () => {
    const api = (
      window as unknown as {
        api: {
          listAgents: () => Promise<Array<{ agentId: string; status: string }>>
        }
      }
    ).api

    const violations: Array<{
      code: string
      message: string
      detail?: string
    }> = []

    const agents = await api.listAgents()

    if (!agents.some((a) => a.agentId === 'tangyuan')) {
      violations.push({
        code: 'default-agent-missing',
        message: 'listAgents 未返回默认 Agent tangyuan。',
        detail: `agents=${agents.map((a) => a.agentId).join(',') || '(空)'}`
      })
    }

    const validStatus = new Set(['active', 'archived'])
    const bad = agents.filter((a) => !validStatus.has(a.status))
    if (bad.length > 0) {
      violations.push({
        code: 'illegal-agent-status',
        message: 'listAgents 返回了非法的 Agent 状态值。',
        detail: bad.map((a) => `${a.agentId}=${a.status}`).join(', ')
      })
    }

    return violations
  })
}
