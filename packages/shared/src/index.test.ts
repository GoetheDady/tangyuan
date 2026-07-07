import { describe, expect, it } from 'vitest'
import { createRuntimeSnapshot } from './index'

describe('createRuntimeSnapshot', () => {
  it('reports missing configuration until provider, model, and API key are configured', () => {
    expect(
      createRuntimeSnapshot({
        agentId: 'tangyuan',
        providerId: 'openai',
        modelId: null,
        hasApiKey: true,
      }).status,
    ).toBe('missing-config')
  })

  it('reports ready when the minimum runtime configuration exists', () => {
    expect(
      createRuntimeSnapshot({
        agentId: 'tangyuan',
        providerId: 'openai',
        modelId: 'gpt-5',
        hasApiKey: true,
      }).status,
    ).toBe('ready')
  })
})
