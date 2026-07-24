import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionDriver } from './index'
import { SessionModelService } from './session-model-service'

function createService(driver: Partial<AgentSessionDriver>) {
  return new SessionModelService({
    sessionDriver: driver as AgentSessionDriver,
  })
}

describe('SessionModelService', () => {
  it('getInfo / setModel / setThinkingLevel 委托 Driver', async () => {
    const service = createService({
      getSessionModelInfo: vi.fn(async () => ({ modelId: 'm' }) as never),
      setSessionModel: vi.fn(async () => ({ modelId: 'm2' }) as never),
      setSessionThinkingLevel: vi.fn(async () => ({ modelId: 'm3' }) as never),
    })

    expect(await service.getInfo({} as never)).toEqual({ modelId: 'm' })
    expect(await service.setModel({} as never)).toEqual({ modelId: 'm2' })
    expect(await service.setThinkingLevel({} as never)).toEqual({
      modelId: 'm3',
    })
  })

  it('缺少能力时各方法抛错', async () => {
    const service = createService({})
    await expect(service.getInfo({} as never)).rejects.toThrow(
      '不支持读取 Session 模型信息',
    )
    await expect(service.setModel({} as never)).rejects.toThrow(
      '不支持切换 Session 模型',
    )
    await expect(service.setThinkingLevel({} as never)).rejects.toThrow(
      '不支持切换 Thinking Level',
    )
  })
})
