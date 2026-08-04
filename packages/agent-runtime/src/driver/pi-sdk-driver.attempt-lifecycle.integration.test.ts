import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupTempDirs,
  createDeferred,
  createDriver,
  createDriverAtPath,
  createPiSdkGateway,
  readJson,
} from './pi-sdk-driver.test-helpers'

afterEach(cleanupTempDirs)

describe('PiSdkDriver · 执行尝试生命周期', () => {
  it('retry：运行中持久化 attempt，并在完成后保留启动时间', async () => {
    let promptCount = 0
    const retryStarted = createDeferred<void>()
    const releaseRetry = createDeferred<void>()
    const timestamps = [
      '2026-08-04T00:00:00.000Z',
      '2026-08-04T00:00:01.000Z',
      '2026-08-04T00:00:02.000Z',
      '2026-08-04T00:00:03.000Z',
      '2026-08-04T00:00:04.000Z',
      '2026-08-04T00:00:05.000Z',
      '2026-08-04T00:00:06.000Z',
      '2026-08-04T00:00:07.000Z',
      '2026-08-04T00:00:08.000Z',
      '2026-08-04T00:00:09.000Z',
      '2026-08-04T00:00:10.000Z',
      '2026-08-04T00:00:11.000Z',
      '2026-08-04T00:00:12.000Z',
      '2026-08-04T00:00:13.000Z',
      '2026-08-04T00:00:14.000Z',
      '2026-08-04T00:00:15.000Z',
      '2026-08-04T00:00:16.000Z',
      '2026-08-04T00:00:17.000Z',
      '2026-08-04T00:00:18.000Z',
      '2026-08-04T00:00:19.000Z',
    ]
    let timestampIndex = 0
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            promptCount++
            if (promptCount === 2) {
              retryStarted.resolve()
              await releaseRetry.promise
            }
            return `收到：${prompt}`
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)
        return handle
      },
    })
    const { runtime, userDataPath } = await createDriver({
      gateway,
      now: () => timestamps[timestampIndex++] ?? timestamps.at(-1)!,
    })

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: '新会话',
    })
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '你好',
    })

    const retryPromise = runtime.retryMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      userMessageId: `${session.sessionId}-message-1`,
    })
    await retryStarted.promise

    const runningIndex = (await readJson(
      join(userDataPath, 'sessions/index.json'),
    )) as { sessions: Array<{ attempts?: Array<Record<string, unknown>> }> }
    const runningAttempt = runningIndex.sessions[0]?.attempts?.at(-1)
    expect(runningAttempt).toMatchObject({
      status: 'running',
      inReplyTo: `${session.sessionId}-message-1`,
      completedAt: null,
    })
    const startedAt = runningAttempt?.startedAt

    releaseRetry.resolve()
    await retryPromise

    const completedIndex = (await readJson(
      join(userDataPath, 'sessions/index.json'),
    )) as { sessions: Array<{ attempts?: Array<Record<string, unknown>> }> }
    expect(completedIndex.sessions[0]?.attempts?.at(-1)).toMatchObject({
      status: 'completed',
      startedAt,
      inReplyTo: `${session.sessionId}-message-1`,
    })
  })
  it('冷启动重建 transcript 时保留持久化的自动重试次数', async () => {
    const gateway = createPiSdkGateway({
      readMessages: async ({ sessionId }) => ({
        agentId: 'yuanxiao',
        sessionId,
        entries: [
          {
            kind: 'agent-reply',
            index: 0,
            messageId: `${sessionId}-message-2`,
            content: '收到：你好',
            createdAt: '2026-07-08T00:00:00.000Z',
            attempt: null,
            turns: [],
          },
        ],
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    })
    const { runtime, rootPath, userDataPath } = await createDriver({ gateway })

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: '新会话',
    })
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '你好',
    })

    const indexPath = join(userDataPath, 'sessions/index.json')
    const index = (await readJson(indexPath)) as {
      sessions: Array<{ attempts?: Array<Record<string, unknown>> }>
    }
    index.sessions[0]!.attempts![0]!.retryCount = 2
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')

    const restartedRuntime = createDriverAtPath({
      rootPath,
      userDataPath,
      gateway,
    })
    const transcript = await restartedRuntime.getTranscript({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
    })
    const agentReply = transcript.entries.find(
      (entry) => entry.kind === 'agent-reply',
    )

    expect(agentReply?.kind).toBe('agent-reply')
    if (agentReply?.kind === 'agent-reply') {
      expect(agentReply.attempt?.retryCount).toBe(2)
    }
  })
})
