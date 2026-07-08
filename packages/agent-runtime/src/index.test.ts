import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AgentRuntimeError,
  PiSdkDriver,
  createDefaultSessionSummary,
} from './index'

const tempDirs: string[] = []

afterEach(async () => {
  for (const directory of tempDirs.splice(0)) {
    await import('node:fs/promises').then(({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  }
})

describe('createDefaultSessionSummary', () => {
  it('creates a tangyuan session summary in the initial idle state', () => {
    expect(
      createDefaultSessionSummary({
        sessionId: 'session-1',
        title: '新会话',
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    ).toEqual({
      agentId: 'tangyuan',
      sessionId: 'session-1',
      title: '新会话',
      updatedAt: '2026-07-08T00:00:00.000Z',
      state: 'idle',
    })
  })
})

describe('AgentRuntimeError', () => {
  it('serializes a stable runtime error without leaking the original cause', () => {
    const error = new AgentRuntimeError({
      code: 'configuration-missing',
      message: 'Provider and model are required before starting a run.',
      recoverable: true,
      cause: new Error('secret API key sk-test-1234'),
    })

    expect(error.toJSON()).toEqual({
      code: 'configuration-missing',
      message: 'Provider and model are required before starting a run.',
      recoverable: true,
    })
  })
})

describe('PiSdkDriver', () => {
  it('creates the default Agent Home and bootstrap template on first read', async () => {
    const { driver, homePath, rootPath } = await createDriver()

    await expect(driver.getSnapshot()).resolves.toMatchObject({
      activeAgent: {
        agentId: 'tangyuan',
        profile: {
          initialized: false,
          bootstrapRequired: true,
        },
      },
      status: 'missing-config',
    })

    await expect(stat(join(rootPath, homePath.slice(2)))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(
      readFile(join(rootPath, homePath.slice(2), 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('1. 用户希望汤圆怎么称呼自己。')
    await expect(
      stat(join(rootPath, homePath.slice(2), 'memory')),
    ).resolves.toBeDefined()
    await expect(
      stat(join(rootPath, homePath.slice(2), 'skills')),
    ).resolves.toBeDefined()
    await expect(
      stat(join(rootPath, homePath.slice(2), 'soul.history')),
    ).resolves.toBeDefined()
    await expect(
      stat(join(rootPath, homePath.slice(2), 'user.history')),
    ).resolves.toBeDefined()
  })

  it('does not overwrite an existing bootstrap template on repeated reads', async () => {
    const { driver, rootPath, homePath } = await createDriver()
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await driver.getSnapshot()
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(join(resolvedHomePath, 'bootstrap.md'), 'custom bootstrap', 'utf8'),
    )

    await driver.refresh()

    await expect(readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8')).resolves.toBe(
      'custom bootstrap',
    )
  })

  it('recreates bootstrap.md when it and the profile files are missing', async () => {
    const { driver, rootPath, homePath } = await createDriver()
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await driver.getSnapshot()
    await import('node:fs/promises').then(({ rm }) =>
      rm(join(resolvedHomePath, 'bootstrap.md'), { force: true }),
    )

    await expect(driver.refresh()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          bootstrapRequired: true,
        },
      },
    })
    await expect(readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8')).resolves.toContain(
      '# Bootstrap',
    )
  })

  it('marks the profile as initialized only when soul.md and user.md both exist', async () => {
    const { driver, rootPath, homePath } = await createDriver()
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await driver.getSnapshot()
    await import('node:fs/promises').then(async ({ writeFile }) => {
      await writeFile(join(resolvedHomePath, 'soul.md'), '# soul', 'utf8')
      await writeFile(join(resolvedHomePath, 'user.md'), '# user', 'utf8')
    })

    await expect(driver.refresh()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: true,
          bootstrapRequired: false,
        },
      },
    })
  })
})

async function createDriver() {
  const rootPath = await mkdtemp(join(tmpdir(), 'tangyuan-agent-runtime-'))
  tempDirs.push(rootPath)

  return {
    driver: new PiSdkDriver({
      fsRoot: rootPath,
      agentHomePath: '~/.tangyuan/agents/tangyuan',
      now: () => '2026-07-08T00:00:00.000Z',
    }),
    rootPath,
    homePath: '~/.tangyuan/agents/tangyuan',
  }
}
