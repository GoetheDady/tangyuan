/**
 * 生产接线回归测试：验证 Pi SDK 原生危险工具被显式排除，
 * 且只有汤圆受保护版本生效。不 mock SDK，不依赖工具的注册顺序。
 */
import { describe, expect, it } from 'vitest'
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import {
  createProtectedTools,
  NATIVE_DANGEROUS_TOOL_NAMES,
  PROTECTED_TOOL_NAMES,
} from '../core'

describe('生产接线级回归 — 原生危险工具被显式排除', () => {
  function createMockGateway() {
    return {
      requestBashApproval: async () => ({ approved: true }),
      validateFilePath: () => ({ allowed: true }),
      requestClarification: async () => ({ answer: 'test' }),
    }
  }

  it('getActiveToolNames 不应包含任何原生危险工具名', async () => {
    const authStorage = AuthStorage.inMemory()
    authStorage.setRuntimeApiKey('anthropic', 'sk-test')

    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const model = modelRegistry.getAll()[0]

    if (!model) {
      // CI 环境可能没有模型，跳过
      return
    }

    const { session } = await createAgentSession({
      authStorage,
      modelRegistry,
      model,
      sessionManager: SessionManager.inMemory(),
      customTools: createProtectedTools(
        {
          gateway: createMockGateway(),
          agentId: 'tangyuan',
          sessionId: 'test-session',
          cwd: '/tmp',
        },
        (_cwd: string) =>
          ({
            name: 'read',
            parameters: {},
            async execute() {
              return { content: [], details: undefined }
            },
          }) as unknown as ToolDefinition,
      ),
      excludeTools: [...NATIVE_DANGEROUS_TOOL_NAMES],
    })

    const activeNames = session.getActiveToolNames()
    const activeSet = new Set(activeNames)

    // 原生危险工具名不应出现在已激活工具列表中
    for (const nativeName of NATIVE_DANGEROUS_TOOL_NAMES) {
      expect(activeSet.has(nativeName)).toBe(false)
    }

    // 受保护工具名应该出现
    for (const protectedName of Object.values(PROTECTED_TOOL_NAMES)) {
      expect(activeSet.has(protectedName)).toBe(true)
    }

    session.dispose()
  })

  it('当不传 excludeTools 时，原生工具依旧在活动列表中（证明 excludeTools 确实生效）', async () => {
    // 这个测试证明：传了 excludeTools 之后原生工具才被移除了
    // 如果没有 excludeTools，原生工具确实存在——这就排除了
    //「原生工具本来就不可用」的巧合。
    const authStorage = AuthStorage.inMemory()
    authStorage.setRuntimeApiKey('anthropic', 'sk-test')

    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const model = modelRegistry.getAll()[0]

    if (!model) {
      return
    }

    const { session } = await createAgentSession({
      authStorage,
      modelRegistry,
      model,
      sessionManager: SessionManager.inMemory(),
      // 不传 customTools，不传 excludeTools
    })

    const activeNames = session.getActiveToolNames()
    const activeSet = new Set(activeNames)

    // 不传 excludeTools 时，原生工具应该自然存在
    expect(activeSet.has('read')).toBe(true)
    expect(activeSet.has('bash')).toBe(true)
    expect(activeSet.has('write')).toBe(true)
    expect(activeSet.has('edit')).toBe(true)

    session.dispose()
  })
})
