import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RealPiSdkGateway } from './gateway'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('RealPiSdkGateway ModelRuntime resources', () => {
  it('从隔离 SDK runtime 读取可展示的 Provider 和模型', async () => {
    const resources = await new RealPiSdkGateway().listProvidersAndModels()
    const providerIds = new Set(
      resources.providers.map((provider) => provider.providerId),
    )
    const modelKeys = new Set(
      resources.models.map((model) => `${model.providerId}:${model.modelId}`),
    )

    expect(resources.providers.length).toBeGreaterThan(0)
    expect(resources.models.length).toBeGreaterThan(0)
    expect(resources.models).toHaveLength(modelKeys.size)
    expect(
      resources.models.every((model) => providerIds.has(model.providerId)),
    ).toBe(true)
  })

  it('使用真实 SDK 创建、重载并重新打开会话 handle', async () => {
    const gateway = new RealPiSdkGateway()
    const resources = await gateway.listProvidersAndModels()
    const model = resources.models[0]

    expect(model).toBeDefined()
    if (!model) return

    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-pi-gateway-'))
    tempDirs.push(rootPath)
    const sessionDir = join(rootPath, 'sessions')
    const agentSkillsPath = join(rootPath, 'agent', 'skills')
    const sharedSkillsPath = join(rootPath, 'shared', 'skills')
    await Promise.all([
      mkdir(sessionDir, { recursive: true }),
      mkdir(agentSkillsPath, { recursive: true }),
      mkdir(sharedSkillsPath, { recursive: true }),
    ])

    const request = {
      providerId: model.providerId,
      modelId: model.modelId,
      apiKey: 'sk-integration-test',
      agentId: 'yuanxiao',
      sessionId: crypto.randomUUID(),
      sdkSessionFile: join(sessionDir, 'requested.jsonl'),
      cwd: rootPath,
      agentSkillsPath,
      sharedSkillsPath,
      onUpdateSoul: vi.fn(),
      onUpdateUserProfile: vi.fn(),
    }
    const created = await gateway.createSession(request)

    try {
      await expect(created.getModelInfo()).resolves.toMatchObject({
        providerId: model.providerId,
        modelId: model.modelId,
      })
      created.setSystemPromptContext('真实 SDK 上下文')
      await expect(created.reload()).resolves.toBeUndefined()
      await expect(
        created.setModel(model.providerId, model.modelId, request.apiKey),
      ).resolves.toBeUndefined()
    } finally {
      created.dispose()
    }

    const reopened = await gateway.openSession({
      ...request,
      sdkSessionFile: created.sdkSessionFile,
    })
    try {
      await expect(reopened.getModelInfo()).resolves.toMatchObject({
        providerId: model.providerId,
        modelId: model.modelId,
      })
      await expect(reopened.reload()).resolves.toBeUndefined()
    } finally {
      reopened.dispose()
    }
  })
})
