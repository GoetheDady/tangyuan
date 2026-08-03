import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupTempDirs,
  createDriver,
  createPiSdkGateway,
} from '../driver/pi-sdk-driver.test-helpers'
import { createYuanxiaoRuntimeForTesting } from './yuanxiao-runtime'

afterEach(cleanupTempDirs)

describe('YuanxiaoRuntime 生产模块组装', () => {
  it('通过真实窄模块完成配置、建会话和消息执行', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: driver.getConfigurationModule(),
      sessions: driver,
      agents: driver.getAgentLifecycleModule(),
      profiles: driver.getProfileModule(),
      skills: driver.getSkillModule(),
    })

    await expect(
      runtime.saveRuntimeConfiguration({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'sk-test-secret-7890',
      }),
    ).resolves.toMatchObject({ status: 'ready' })

    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: '真实组装测试',
    })
    const transcript = await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '你好',
    })

    expect(gateway.requests).toHaveLength(1)
    expect(gateway.sessionRequests).toHaveLength(1)
    expect(gateway.sessionHandles[0]?.prompts).toEqual(['你好'])
    expect(transcript.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'user-message', content: '你好' }),
        expect.objectContaining({ kind: 'agent-reply', content: '收到：你好' }),
      ]),
    )
  })
})
