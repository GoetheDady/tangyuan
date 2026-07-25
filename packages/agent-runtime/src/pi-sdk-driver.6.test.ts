import { afterEach, describe, expect, it } from 'vitest'
import { type PiSdkPromptOptions } from './index'
import {
  cleanupTempDirs,
  createDeferred,
  createDriver,
  createPiSdkGateway,
} from './pi-sdk-driver.test-helpers'

afterEach(cleanupTempDirs)

describe('PiSdkDriver', () => {
  it('retry：会话正在运行时拒绝', async () => {
    const runStarted = createDeferred<void>()
    const releasePrompt = createDeferred<void>()
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
          prompt: async (prompt: string, options?: PiSdkPromptOptions) => {
            handle.prompts.push(prompt)
            options?.onEvent?.({ type: 'text-delta', delta: '部分' })
            runStarted.resolve()
            await releasePrompt.promise
            return '部分'
          },
          abort: async () => {
            releasePrompt.resolve()
          },
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)
        return handle
      },
    })
    const { driver } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })
    const sendPromise = driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '你好',
    })
    await runStarted.promise

    await expect(
      driver.retryMessage({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
        userMessageId: `${session.sessionId}-message-1`,
      }),
    ).rejects.toThrow('当前会话正在运行')

    await driver.cancelRun({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
    })
    await expect(sendPromise).resolves.toBeUndefined()
  })
})
