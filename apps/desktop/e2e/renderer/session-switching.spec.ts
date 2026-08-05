import { expect, test } from '@playwright/test'
import type {
  AgentSessionSummary,
  RuntimeSnapshot,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'
import {
  createPreloadApiInitScript,
  createReadyRuntimeSnapshot,
} from '../fixtures/preload-mock'

const FIXED_TIME = '2026-07-22T08:30:00.000Z'

function transcript(
  sessionId: string,
  content: string,
): TranscriptSnapshot {
  return {
    sessionId,
    agentId: 'yuanxiao',
    entries: [
      {
        kind: 'user-message',
        index: 0,
        messageId: `${sessionId}-user-0`,
        content: `问题（${content}）`,
        createdAt: FIXED_TIME,
      },
      {
        kind: 'agent-reply',
        index: 1,
        messageId: `${sessionId}-agent-0`,
        content: `回复（${content}）`,
        createdAt: FIXED_TIME,
        attempt: null,
        turns: [],
      },
    ],
    updatedAt: FIXED_TIME,
  }
}

function createRendererInitScript(
  runtime: RuntimeSnapshot,
  sessions: AgentSessionSummary[],
  transcripts: Record<string, TranscriptSnapshot>,
  slowSessionId: string,
): string {
  const base = createPreloadApiInitScript(runtime, sessions, [])
  const serialized = JSON.stringify(transcripts)
  const activeSession = sessions[0]

  return `${base}
    (() => {
      const transcripts = ${serialized};
      window.api = {
        ...window.api,
        resumeSession: async () => {
          const activeSession = ${JSON.stringify(activeSession ?? null)};
          return {
            sessions: ${JSON.stringify(sessions)},
            archivedSessions: [],
            activeSession,
            transcript: activeSession ? transcripts[activeSession.sessionId] : null
          };
        },
        getTranscript: async (request) => {
          if (request.sessionId === ${JSON.stringify(slowSessionId)}) {
            await new Promise((resolve) => setTimeout(resolve, 400));
          }
          return transcripts[request.sessionId] || {
            sessionId: request.sessionId,
            agentId: request.agentId,
            entries: [],
            updatedAt: '${FIXED_TIME}'
          };
        }
      };
    })();`
}

test('切换会话时先显示会话读取提示，内容就绪后淡入替换', async ({ page }) => {
  const runtime = createReadyRuntimeSnapshot()
  const sessions: AgentSessionSummary[] = [
    {
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      title: '架构讨论',
      state: 'idle',
      updatedAt: FIXED_TIME,
    },
    {
      agentId: 'yuanxiao',
      sessionId: 'session-2',
      title: '新话题',
      state: 'idle',
      updatedAt: FIXED_TIME,
    },
  ]

  await page.addInitScript({
    content: createRendererInitScript(
      runtime,
      sessions,
      {
        'session-1': transcript('session-1', '历史会话'),
        'session-2': transcript('session-2', '慢读取会话'),
      },
      'session-2',
    ),
  })
  await page.goto('/#/chat/yuanxiao/session-1')

  await expect(page.getByText('回复（历史会话）')).toBeVisible()

  await page.getByRole('treeitem', { name: /新话题/ }).click()

  await expect(page.getByTestId('session-loading-hint')).toBeVisible()
  await expect(page.getByText('回复（慢读取会话）')).toBeVisible()
  await expect(page.getByTestId('session-loading-hint')).not.toBeVisible()
  await expect(page.getByTestId('message-stream')).toHaveClass(
    /animate-session-content-enter/,
  )
})
