import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import {
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  type DesktopPreloadApi,
  type RuntimeSnapshot
} from '@tangyuan/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    const runtime = createMissingConfigurationSnapshot()
    const api: DesktopPreloadApi = {
      getRuntimeSnapshot: vi.fn().mockResolvedValue(runtime),
      refreshRuntime: vi.fn().mockResolvedValue(runtime),
      listSessions: vi.fn().mockResolvedValue([
        createDefaultSessionSummary({
          sessionId: 'welcome',
          title: '新会话',
          updatedAt: '2026-07-08T00:00:00.000Z'
        })
      ]),
      createSession: vi.fn().mockResolvedValue(
        createDefaultSessionSummary({
          sessionId: 'session-1',
          title: '新会话',
          updatedAt: '2026-07-08T00:00:00.000Z'
        })
      )
    }

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: api
    })
  })

  it('renders the minimum desktop workbench shell', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '汤圆' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新会话' })).toBeInTheDocument()
  })

  it('loads runtime and session data through the preload API', async () => {
    render(<App />)

    expect(await screen.findByText('缺少配置')).toBeInTheDocument()
    expect(screen.getByText('未保存')).toBeInTheDocument()
    expect(screen.getByText('空闲')).toBeInTheDocument()
  })
})

/**
 * 创建 Renderer 测试使用的缺配置运行时快照。
 *
 * @returns 一个默认 Agent 下缺少 Provider、Model 和 API Key 的 RuntimeSnapshot。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createMissingConfigurationSnapshot(): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: 'tangyuan',
      displayName: '汤圆',
      homePath: '~/.tangyuan/agents/tangyuan',
      profile: {
        initialized: false,
        bootstrapRequired: true,
        soulUpdatedAt: null,
        userUpdatedAt: null
      }
    },
    providers: [],
    models: [],
    settings: {
      selectedProviderId: null,
      selectedModelId: null
    },
    auth: {
      apiKey: {
        configured: false,
        maskedValue: null
      }
    }
  })
}
