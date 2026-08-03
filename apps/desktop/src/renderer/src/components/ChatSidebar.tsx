import type { AgentSessionSummary, AgentSummary } from '@yuanxiao/contracts'
import { MessageSquarePlus, Settings } from 'lucide-react'
import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { ArchivedSessionList } from '@/components/SessionArchiveControls'
import { SessionLineageTree } from '@/components/SessionLineageTree'
import { Button } from '@/components/ui/button'

function getAgentInitial(displayName: string): string {
  return Array.from(displayName.trim())[0] ?? '汤'
}

export interface ChatSidebarProps {
  /** 当前 Agent 集合（导航栏展示 active 状态的 Agent）。 */
  agents: readonly AgentSummary[]
  /** 当前选中的 Agent 标识。 */
  activeAgentId: string
  /** 当前 Agent 的全部会话。 */
  sessions: readonly AgentSessionSummary[]
  /** 当前选中的会话标识。 */
  selectedSessionId: string | null
  /** 存在待审批请求的会话标识列表。 */
  pendingApprovalSessionIds: readonly string[]
  /** 已归档的会话列表。 */
  archivedSessions: readonly AgentSessionSummary[]
  /** 正在恢复的会话标识。 */
  recoveringSessionId: string | null
  /** 切换到指定 Agent。 */
  onAgentChange(nextAgentId: string): void
  /** 新建会话。 */
  onCreateSession(): void
  /** 选中某个会话。 */
  onSelectSession(session: AgentSessionSummary): void
  /** 恢复某个已归档会话。 */
  onRecoverSession(session: AgentSessionSummary): void
}

/**
 * 聊天主界面的左侧栏：Agent 切换导航与当前 Agent 的会话列表。
 *
 * 会话按“今天 / 更早”分组，谱系树与归档列表都由本组件承载，
 * ChatPage 只需传入会话数据和选择回调。
 *
 * @param props - 会话、Agent 与回调。
 * @returns 左侧栏组件树。
 * @throws 此组件不会主动抛出错误。
 */
export function ChatSidebar(props: ChatSidebarProps): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()

  const sessionGroups = useMemo(() => {
    const today = new Date().toDateString()
    const knownSessionIds = new Set(
      props.sessions.map((session) => session.sessionId),
    )
    // 父会话已不在列表里的分叉也作为根展示，避免整条谱系不可见。
    const rootSessions = props.sessions.filter(
      (session) =>
        !session.forkedFrom ||
        !knownSessionIds.has(session.forkedFrom.sessionId),
    )

    return [
      {
        label: '今天',
        sessions: rootSessions.filter(
          (session) => new Date(session.updatedAt).toDateString() === today,
        ),
      },
      {
        label: '更早',
        sessions: rootSessions.filter(
          (session) => new Date(session.updatedAt).toDateString() !== today,
        ),
      },
    ].filter((group) => group.sessions.length > 0)
  }, [props.sessions])

  return (
    <aside
      data-testid="chat-sidebar"
      className="border-split bg-sidebar grid min-h-0 grid-cols-[80px_216px] border-r"
    >
      <nav
        aria-label="Agent 切换"
        data-testid="chat-agent-rail"
        className="window-no-drag border-split bg-sidebar relative z-50 flex min-h-0 flex-col items-center gap-2.5 border-r px-2.5 py-2"
      >
        <div aria-hidden="true" className="h-9 shrink-0" />

        {props.agents
          .filter((agent) => agent.status === 'active')
          .map((agent) => {
            const isActive = agent.agentId === props.activeAgentId
            return (
              <button
                key={agent.agentId}
                type="button"
                aria-label={`切换到 Agent ${agent.displayName}`}
                aria-current={isActive ? 'page' : undefined}
                title={agent.displayName}
                className={`window-no-drag text-label focus-visible:ring-ring/50 grid size-9 shrink-0 place-items-center rounded-[10px] border font-semibold transition-colors focus-visible:ring-[3px] focus-visible:outline-none ${
                  isActive
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-background'
                }`}
                onClick={() => {
                  props.onAgentChange(agent.agentId)
                }}
              >
                {getAgentInitial(agent.displayName)}
              </button>
            )
          })}

        <div className="min-h-0 flex-1" />
        <button
          type="button"
          aria-label="设置"
          title="设置"
          className="window-no-drag text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-ring/50 grid size-9 shrink-0 cursor-pointer place-items-center rounded-[10px] transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
          onClick={() => {
            navigate(
              `/settings/providers?redirect=${encodeURIComponent(location.pathname)}`,
            )
          }}
        >
          <Settings size={16} aria-hidden="true" />
        </button>
      </nav>

      <section
        data-testid="chat-session-pane"
        className="bg-background/50 flex min-h-0 min-w-0 flex-col"
      >
        <div className="window-no-drag relative z-50 p-[8px_10px_10px]">
          <Button
            className="text-label h-9 w-full gap-1.5 rounded-lg px-2 font-semibold"
            onClick={() => {
              props.onCreateSession()
            }}
          >
            <MessageSquarePlus
              data-icon="inline-start"
              size={14}
              aria-hidden="true"
            />
            新建会话
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {sessionGroups.length > 0 ? (
            <div
              role="tree"
              aria-label="会话谱系"
              className="flex flex-col gap-0.5"
            >
              {sessionGroups.map((group) => (
                <div key={group.label} role="group" aria-label={group.label}>
                  <p className="text-muted-foreground flex h-5 items-center px-2.5 font-mono text-[8px] font-semibold">
                    {group.label}
                  </p>
                  <SessionLineageTree
                    sessions={props.sessions}
                    rootSessions={group.sessions}
                    selectedSessionId={props.selectedSessionId}
                    pendingApprovalSessionIds={props.pendingApprovalSessionIds}
                    onSelect={props.onSelectSession}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-caption text-muted-foreground px-2.5 py-3">
              <p className="font-medium">暂无会话</p>
              <p className="mt-1 text-[10px]">新建会话后会显示在这里</p>
            </div>
          )}
        </div>
        <ArchivedSessionList
          sessions={props.archivedSessions}
          recoveringSessionId={props.recoveringSessionId}
          onRecover={props.onRecoverSession}
        />
      </section>
    </aside>
  )
}
