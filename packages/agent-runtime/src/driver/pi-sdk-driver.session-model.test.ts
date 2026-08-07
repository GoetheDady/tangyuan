import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupTempDirs,
  createDriver,
  createPiSdkGateway,
  createPromptingHandle,
  readJson,
} from './pi-sdk-driver.test-helpers'

afterEach(cleanupTempDirs)

describe('PiSdkDriver 会话模型配置', () => {
  it('持久化 SDK 夹紧后的实际 Thinking Level', async () => {
    let thinkingLevel = 'off'
    const gateway = createPiSdkGateway({
      createSession: async (request) => ({
        ...createPromptingHandle(
          request.sessionId,
          undefined,
          request.sdkSessionFile,
        ),
        setThinkingLevel: async (level: string) => {
          thinkingLevel = level === 'xhigh' ? 'high' : level
        },
        getModelInfo: async () => ({
          providerId: request.providerId,
          modelId: request.modelId,
          displayName: request.modelId,
          thinkingLevel,
          supportedThinkingLevels: ['off', 'low', 'medium', 'high'],
          supportsThinking: true,
        }),
      }),
    })
    const { runtime, userDataPath } = await createDriver({ gateway })
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: 'Thinking 夹紧测试',
    })

    await expect(
      runtime.setSessionThinkingLevel({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
        level: 'xhigh',
      }),
    ).resolves.toMatchObject({ thinkingLevel: 'high' })

    const index = (await readJson(
      join(userDataPath, 'sessions/index.json'),
    )) as { sessions: Array<{ sessionId: string; thinkingLevel?: string }> }
    expect(
      index.sessions.find((entry) => entry.sessionId === session.sessionId),
    ).toMatchObject({ thinkingLevel: 'high' })
  })
})
