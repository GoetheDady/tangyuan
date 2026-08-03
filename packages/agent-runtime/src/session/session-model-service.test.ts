import { describe, expect, it, vi } from 'vitest'
import type { SessionModule } from '../runtime/runtime-modules'
import { SessionModelService } from './session-model-service'

function createService(driver: Partial<SessionModule>) {
  return new SessionModelService({
    sessions: driver as SessionModule,
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
})
