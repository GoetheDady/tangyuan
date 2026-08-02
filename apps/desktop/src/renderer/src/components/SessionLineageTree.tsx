import type { AgentSessionSummary } from '@yuanxiao/contracts'
import React, { useMemo } from 'react'

/**
 * 会话谱系树的属性。
 */
export interface SessionLineageTreeProps {
  /** 当前 Agent 的全部会话，用于推导任意深度的父子关系。 */
  sessions: readonly AgentSessionSummary[]
  /** 作为树根展示的会话（分组后的根会话）。 */
  rootSessions: readonly AgentSessionSummary[]
  /** 当前选中的会话标识。 */
  selectedSessionId: string | null
  /** 存在待审批请求的会话标识列表。 */
  pendingApprovalSessionIds: readonly string[]
  /** 选中某个会话时的回调。 */
  onSelect: (session: AgentSessionSummary) => void
}

/**
 * 按分叉来源把会话聚合成 父会话标识 → 子会话列表。
 *
 * @param sessions - 当前 Agent 的全部会话。
 * @returns 父会话标识到子会话列表的映射，子会话按更新时间倒序。
 */
function groupChildrenByParentId(
  sessions: readonly AgentSessionSummary[],
): Map<string, AgentSessionSummary[]> {
  const children = new Map<string, AgentSessionSummary[]>()

  for (const session of sessions) {
    const parentSessionId = session.forkedFrom?.sessionId
    if (!parentSessionId) continue

    const siblings = children.get(parentSessionId) ?? []
    siblings.push(session)
    children.set(parentSessionId, siblings)
  }

  for (const siblings of children.values()) {
    siblings.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
  }

  return children
}

/**
 * 递归渲染一个会话节点及其全部后代分叉。
 *
 * `visitedSessionIds` 保证异常数据形成环时递归会终止。
 *
 * @param props - 节点渲染所需的上下文。
 * @returns 该节点及其后代的树节点组件树。
 * @throws 此组件不会主动抛出错误。
 */
function SessionLineageNode(props: {
  session: AgentSessionSummary
  depth: number
  childrenByParentId: Map<string, AgentSessionSummary[]>
  selectedSessionId: string | null
  pendingApprovalSessionIds: readonly string[]
  visitedSessionIds: readonly string[]
  onSelect: (session: AgentSessionSummary) => void
}): React.JSX.Element {
  const {
    session,
    depth,
    childrenByParentId,
    selectedSessionId,
    pendingApprovalSessionIds,
    visitedSessionIds,
    onSelect,
  } = props
  const isSelected = session.sessionId === selectedSessionId
  const hasPendingApproval = pendingApprovalSessionIds.includes(
    session.sessionId,
  )
  const isRunning = session.state === 'running' || session.state === 'queued'
  const isRoot = depth === 1
  const childSessions = (
    childrenByParentId.get(session.sessionId) ?? []
  ).filter((child) => !visitedSessionIds.includes(child.sessionId))

  return (
    <div role="none">
      <div
        role="treeitem"
        tabIndex={0}
        aria-level={depth}
        aria-selected={isSelected}
        data-session-id={session.sessionId}
        className={`focus-visible:ring-ring/50 flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-left transition-colors focus-visible:ring-[3px] focus-visible:outline-none ${
          isRoot ? 'text-caption h-10' : 'h-8 text-[11px]'
        } ${
          isSelected
            ? isRoot
              ? 'bg-secondary text-foreground'
              : 'bg-secondary/60 text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        }`}
        onClick={() => {
          onSelect(session)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(session)
          }
        }}
      >
        <span
          className={`min-w-0 flex-1 truncate ${
            isRoot
              ? `text-body ${isSelected ? 'font-semibold' : 'font-medium'}`
              : ''
          }`}
        >
          {session.title}
        </span>
        {(isRunning || hasPendingApproval) && (
          <>
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${
                hasPendingApproval ? 'bg-warning' : 'bg-info'
              }`}
            />
            <span className="sr-only">
              {hasPendingApproval ? '待审批' : '运行中'}
            </span>
          </>
        )}
      </div>
      {childSessions.length > 0 && (
        <div role="group" className="border-border ml-4 border-l pl-2">
          {childSessions.map((childSession) => (
            <SessionLineageNode
              key={childSession.sessionId}
              session={childSession}
              depth={depth + 1}
              childrenByParentId={childrenByParentId}
              selectedSessionId={selectedSessionId}
              pendingApprovalSessionIds={pendingApprovalSessionIds}
              visitedSessionIds={[...visitedSessionIds, childSession.sessionId]}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 以任意深度展示会话的分叉谱系。
 *
 * 每个节点是一棵子树的根，子会话按分叉来源递归缩进展示；
 * 父会话缺失的分叉由调用方作为根会话传入，避免整条谱系不可见。
 *
 * @param props - 组件属性。
 * @returns 会话谱系树组件树。
 * @throws 此组件不会主动抛出错误。
 */
export function SessionLineageTree({
  sessions,
  rootSessions,
  selectedSessionId,
  pendingApprovalSessionIds,
  onSelect,
}: SessionLineageTreeProps): React.JSX.Element {
  const childrenByParentId = useMemo(
    () => groupChildrenByParentId(sessions),
    [sessions],
  )

  return (
    <>
      {rootSessions.map((session) => (
        <SessionLineageNode
          key={session.sessionId}
          session={session}
          depth={1}
          childrenByParentId={childrenByParentId}
          selectedSessionId={selectedSessionId}
          pendingApprovalSessionIds={pendingApprovalSessionIds}
          visitedSessionIds={[session.sessionId]}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}
