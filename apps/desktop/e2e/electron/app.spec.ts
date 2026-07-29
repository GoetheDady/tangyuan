import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'

const PARENT_SESSION_ID = 'electron-parent-session'
const CHILD_SESSION_ID = 'electron-child-session'
const PARENT_SOURCE_MESSAGE_ID = 'electron-parent-source-message'
const SESSION_MODEL_ID = 'claude-sonnet-4-5'

/**
 * 在 QA 隔离目录中写入真实 Main/Preload/Renderer 启动链路使用的持久化数据。
 *
 * @param tempHome - Electron 进程使用的临时 HOME。
 * @returns 分叉会话 Pi 文件路径。
 */
function writeStartupRestorationFixture(tempHome: string): string {
  const userDataPath = join(tempHome, '.tangyuan-qa-root', '.tangyuan')
  const sessionDir = join(userDataPath, 'sessions')
  const sdkSessionDir = join(sessionDir, 'pi-sdk')
  const agentHomePath = join(userDataPath, 'agents', 'tangyuan')
  const parentSessionFile = join(sdkSessionDir, `${PARENT_SESSION_ID}.jsonl`)
  const childSessionFile = join(sdkSessionDir, `${CHILD_SESSION_ID}.jsonl`)
  const parentTimestamp = '2026-07-28T00:00:00.000Z'
  const childTimestamp = '2026-07-28T00:01:00.000Z'

  mkdirSync(sdkSessionDir, { recursive: true })
  writeFileSync(
    join(userDataPath, 'config.json'),
    JSON.stringify({
      schemaVersion: 2,
      providers: {
        anthropic: {
          encryptedApiKey: 'sk-electron-e2e-placeholder',
          updatedAt: childTimestamp
        }
      },
      agents: {
        tangyuan: {
          displayName: '汤圆',
          defaultProviderId: 'anthropic',
          defaultModelId: SESSION_MODEL_ID,
          status: 'active',
          archivedAt: null
        }
      }
    })
  )
  writeFileSync(
    parentSessionFile,
    [
      {
        type: 'session',
        version: 3,
        id: PARENT_SESSION_ID,
        timestamp: parentTimestamp,
        cwd: agentHomePath
      },
      {
        type: 'message',
        id: PARENT_SOURCE_MESSAGE_ID,
        parentId: null,
        timestamp: parentTimestamp,
        message: { role: 'user', content: '父会话中的分叉源消息', timestamp: 1 }
      }
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  )
  writeFileSync(
    childSessionFile,
    [
      {
        type: 'session',
        version: 3,
        id: CHILD_SESSION_ID,
        timestamp: childTimestamp,
        cwd: agentHomePath,
        parentSession: parentSessionFile
      },
      {
        type: 'custom',
        customType: 'tangyuan:fork-source',
        id: 'electron-fork-source',
        parentId: null,
        timestamp: childTimestamp,
        data: { sessionId: PARENT_SESSION_ID, entryId: PARENT_SOURCE_MESSAGE_ID }
      },
      {
        type: 'model_change',
        id: 'electron-model-change',
        parentId: 'electron-fork-source',
        timestamp: childTimestamp,
        provider: 'anthropic',
        modelId: SESSION_MODEL_ID
      },
      {
        type: 'thinking_level_change',
        id: 'electron-thinking-change',
        parentId: 'electron-model-change',
        timestamp: childTimestamp,
        thinkingLevel: 'high'
      },
      {
        type: 'message',
        id: 'electron-child-message',
        parentId: 'electron-thinking-change',
        timestamp: childTimestamp,
        message: { role: 'user', content: '最后激活分叉会话内容', timestamp: 2 }
      }
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  )
  writeFileSync(
    join(sessionDir, 'index.json'),
    JSON.stringify({
      sessions: [
        {
          sessionId: CHILD_SESSION_ID,
          sdkSessionFile: childSessionFile,
          title: '应恢复的分叉会话',
          createdAt: childTimestamp,
          updatedAt: childTimestamp,
          provider: 'anthropic',
          model: SESSION_MODEL_ID,
          thinkingLevel: 'high',
          agentId: 'tangyuan',
          lastMessagePreview: '最后激活分叉会话内容',
          status: 'completed',
          forkedFrom: {
            sessionId: PARENT_SESSION_ID,
            entryId: PARENT_SOURCE_MESSAGE_ID
          }
        },
        {
          sessionId: PARENT_SESSION_ID,
          sdkSessionFile: parentSessionFile,
          title: '默认 Agent 最近可用会话',
          createdAt: parentTimestamp,
          updatedAt: parentTimestamp,
          provider: 'anthropic',
          model: SESSION_MODEL_ID,
          thinkingLevel: 'low',
          agentId: 'tangyuan',
          lastMessagePreview: '父会话中的分叉源消息',
          status: 'completed'
        }
      ]
    })
  )
  writeFileSync(
    join(sessionDir, 'last-active-session.json'),
    JSON.stringify({
      agentId: 'tangyuan',
      sessionId: CHILD_SESSION_ID,
      updatedAt: childTimestamp
    })
  )

  return childSessionFile
}

/**
 * 使用临时 HOME 和 QA 明文适配器启动真实 Electron 应用。
 *
 * @param mainEntry - 已构建的 Electron Main 入口。
 * @param tempHome - 隔离的临时 HOME。
 * @returns Electron 应用与主窗口。
 */
async function launchRestorationApp(
  mainEntry: string,
  tempHome: string
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      HOME: tempHome,
      TANGYUAN_QA_API_KEY: 'enable-plaintext-e2e-adapter',
      TANGYUAN_DESKTOP_SMOKE_TEST_RESULT_PATH: ''
    }
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

/**
 * 桌面端 Electron 窗口测试。
 *
 * 使用 Playwright 内置 electron.launch() 启动真实 Electron 应用，
 * 验证 Preload API、IPC 通信和渲染页面是否正常工作。
 * 所有测试使用临时 HOME 目录，不会读写真实 API Key 或配置。
 */
test.describe('Electron 窗口', () => {
  let electronApp: ElectronApplication
  let mainWindow: Page
  let tempHome: string

  test.beforeAll(async () => {
    // Playwright 从 playwright.config.ts 所在目录运行，process.cwd() 即 apps/desktop
    const mainEntry = join(process.cwd(), 'out/main/index.js')

    // 创建临时 HOME 目录，避免污染真实 ~/.tangyuan 配置
    tempHome = mkdtempSync(join(tmpdir(), 'tangyuan-e2e-electron-'))

    electronApp = await electron.launch({
      args: [mainEntry],
      env: {
        ...process.env,
        HOME: tempHome,
        // 确保不会触发打包 smoke test 模式
        TANGYUAN_DESKTOP_SMOKE_TEST_RESULT_PATH: ''
      }
    })

    // 等待第一个窗口加载完成
    mainWindow = await electronApp.firstWindow()
    await mainWindow.waitForLoadState('domcontentloaded')
  })

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close()
    }
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test('应用启动后窗口打开', async () => {
    expect(mainWindow).toBeDefined()
    // 窗口应该有内容
    const title = await mainWindow.title()
    expect(title).toBeTruthy()
  })

  test('Preload API 在窗口中可用', async () => {
    // 验证 window.api 存在
    const apiExists = await mainWindow.evaluate(() => {
      return typeof window.api !== 'undefined'
    })
    expect(apiExists).toBe(true)
  })

  test('window.api 包含预期的方法', async () => {
    const apiKeys = await mainWindow.evaluate(() => {
      return Object.keys(window.api).sort()
    })

    // 验证 Preload API 方法都存在
    expect(apiKeys).toContain('getRuntimeSnapshot')
    expect(apiKeys).toContain('refreshRuntime')
    expect(apiKeys).toContain('saveRuntimeConfiguration')
    expect(apiKeys).toContain('cancelRuntimeConfigurationVerification')
    expect(apiKeys).toContain('listSessions')
    expect(apiKeys).toContain('getLastActiveSession')
    expect(apiKeys).toContain('setLastActiveSession')
    expect(apiKeys).toContain('createSession')
    expect(apiKeys).toContain('getTranscript')
    expect(apiKeys).toContain('sendMessage')
    expect(apiKeys).toContain('cancelRun')
    expect(apiKeys).toContain('subscribeToAgentEvents')
    expect(apiKeys).toContain('openExternalLink')
    expect(apiKeys).toContain('forkSession')
    expect(apiKeys).toContain('archiveSession')
    expect(apiKeys).toContain('recoverSession')
  })

  test('调用 forkSession 在会话不存在时被 Runtime 拒绝', async () => {
    const result = await mainWindow.evaluate(async () => {
      try {
        await window.api.forkSession({
          agentId: 'tangyuan',
          sessionId: 'missing-session',
          entryId: 'missing-entry'
        })
        return { rejected: false, message: '' }
      } catch (error) {
        return {
          rejected: true,
          message: error instanceof Error ? error.message : String(error)
        }
      }
    })

    // IPC 贯通到 Runtime：请求通过 schema 校验后，由 Runtime 报告会话不存在。
    expect(result.rejected).toBe(true)
    expect(result.message).toContain('missing-session')
  })

  test('页面渲染了配置页或聊天页之一', async () => {
    await mainWindow.waitForFunction(() => {
      const text = document.body.innerText
      return text.includes('连接模型服务') || text.includes('大语言模型对话')
    })
    const bodyText = await mainWindow.evaluate(() => {
      return document.body.innerText
    })

    // 根据 smoke test 的分类逻辑：页面应显示 setup 或 chat
    const isSetupPage =
      bodyText.includes('连接模型服务') &&
      bodyText.includes('Provider') &&
      bodyText.includes('API Key')
    const isChatPage = bodyText.includes('大语言模型对话') && bodyText.includes('新建会话')

    expect(isSetupPage || isChatPage).toBe(true)
  })

  test('HashRouter 正确导航', async () => {
    // 等待 React Router 完成启动时重定向（Navigate 组件在渲染后更新 hash）
    await mainWindow.waitForFunction(() => {
      return window.location.hash.length > 0
    })

    const currentUrl = await mainWindow.evaluate(() => {
      return window.location.hash
    })

    // URL 应该包含 /console/providers 或 /chat
    expect(currentUrl).toMatch(/\/(console\/providers|chat)/)
  })

  test('调用 getRuntimeSnapshot 返回有效数据', async () => {
    const snapshot = await mainWindow.evaluate(async () => {
      return await window.api.getRuntimeSnapshot()
    })

    expect(snapshot).toBeDefined()
    expect(snapshot.activeAgent).toBeDefined()
    expect(snapshot.activeAgent.agentId).toBe('tangyuan')
    expect(snapshot.providers).toBeInstanceOf(Array)
    expect(snapshot.status).toMatch(/^(missing-config|ready)$/)
  })

  test('调用 listSessions 返回会话列表', async () => {
    const sessions = await mainWindow.evaluate(async () => {
      return await window.api.listSessions()
    })

    expect(sessions).toBeInstanceOf(Array)
  })

  test('最后激活会话 IPC 在无可用会话时返回 null', async () => {
    const result = await mainWindow.evaluate(async () => {
      const initial = await window.api.getLastActiveSession()
      const updated = await window.api.setLastActiveSession({
        agentId: 'tangyuan',
        sessionId: 'missing-session'
      })
      return { initial, updated }
    })

    expect(result).toEqual({ initial: null, updated: null })
  })

  test('调用 openExternalLink 被拒绝当协议不是 http/https', async () => {
    const error = await mainWindow.evaluate(async () => {
      try {
        await window.api.openExternalLink({ url: 'file:///etc/passwd' })
        return null
      } catch (e) {
        return String(e)
      }
    })

    expect(error).toBeTruthy()
  })
})

test.describe('真实 Electron 启动恢复', () => {
  test('恢复最后激活分叉会话，失效后回退默认 Agent 最近可用会话', async () => {
    const mainEntry = join(process.cwd(), 'out/main/index.js')
    const tempHome = mkdtempSync(join(tmpdir(), 'tangyuan-e2e-restoration-'))
    const childSessionFile = writeStartupRestorationFixture(tempHome)
    let runningApp: ElectronApplication | null = null

    try {
      const firstLaunch = await launchRestorationApp(mainEntry, tempHome)
      runningApp = firstLaunch.app
      await firstLaunch.window.waitForFunction(
        ({ sessionId, transcriptText }) =>
          window.location.hash === `#/chat/tangyuan/${sessionId}` &&
          document.body.innerText.includes(transcriptText),
        { sessionId: CHILD_SESSION_ID, transcriptText: '最后激活分叉会话内容' }
      )

      await expect(
        firstLaunch.window.getByRole('heading', { name: '应恢复的分叉会话' })
      ).toBeVisible()
      await expect(firstLaunch.window.getByTestId('fork-source-notice')).toContainText(
        '分叉自「默认 Agent 最近可用会话」'
      )
      const sessionModelInfo = await firstLaunch.window.evaluate(
        async ({ agentId, sessionId }) =>
          window.api.getSessionModelInfo({
            agentId,
            sessionId
          }),
        { agentId: 'tangyuan', sessionId: CHILD_SESSION_ID }
      )
      expect(sessionModelInfo).toMatchObject({
        providerId: 'anthropic',
        modelId: SESSION_MODEL_ID,
        thinkingLevel: 'high'
      })

      const archiveRoundTrip = await firstLaunch.window.evaluate(
        async ({ agentId, parentSessionId, childSessionId }) => {
          const archived = await window.api.archiveSession({
            agentId,
            sessionId: parentSessionId,
            confirmActivityStop: false
          })
          const visibleAfterArchive = await window.api.listSessions({ agentId })
          const allAfterArchive = await window.api.listSessions({
            agentId,
            includeArchived: true
          })
          const recovered = await window.api.recoverSession({
            agentId,
            sessionId: parentSessionId
          })
          const childTranscript = await window.api.getTranscript({
            agentId,
            sessionId: childSessionId
          })
          return {
            archived,
            visibleAfterArchive,
            allAfterArchive,
            recovered,
            childTranscript
          }
        },
        {
          agentId: 'tangyuan',
          parentSessionId: PARENT_SESSION_ID,
          childSessionId: CHILD_SESSION_ID
        }
      )
      expect(archiveRoundTrip.archived).toMatchObject({
        status: 'archived',
        affectedSessionIds: [PARENT_SESSION_ID, CHILD_SESSION_ID]
      })
      expect(archiveRoundTrip.visibleAfterArchive).toEqual([])
      expect(archiveRoundTrip.allAfterArchive).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: PARENT_SESSION_ID,
            archivedAt: expect.any(String)
          }),
          expect.objectContaining({
            sessionId: CHILD_SESSION_ID,
            archivedAt: expect.any(String)
          })
        ])
      )
      expect(archiveRoundTrip.recovered).toHaveLength(2)
      expect(archiveRoundTrip.childTranscript.sessionId).toBe(CHILD_SESSION_ID)

      await runningApp.close()
      runningApp = null
      unlinkSync(childSessionFile)

      const secondLaunch = await launchRestorationApp(mainEntry, tempHome)
      runningApp = secondLaunch.app
      await secondLaunch.window.waitForFunction(
        ({ sessionId, transcriptText }) =>
          window.location.hash === `#/chat/tangyuan/${sessionId}` &&
          document.body.innerText.includes(transcriptText),
        { sessionId: PARENT_SESSION_ID, transcriptText: '父会话中的分叉源消息' }
      )

      expect(
        await secondLaunch.window.evaluate(async () => window.api.getLastActiveSession())
      ).toMatchObject({ agentId: 'tangyuan', sessionId: PARENT_SESSION_ID })
    } finally {
      await runningApp?.close()
      rmSync(tempHome, { recursive: true, force: true })
    }
  })
})
