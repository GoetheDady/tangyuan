import type { AgentSessionSummary } from '@yuanxiao/contracts'
import { MoreHorizontal } from 'lucide-react'
import React, { useMemo } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
  /** 归档某个会话谱系的回调。 */
  onArchive: (session: AgentSessionSummary) => void
  /** 删除某个会话谱系的回调。 */
  onDelete: (session: AgentSessionSummary) => void
}

/**
 * 按分叉来源把会话聚合成 父会话标识 → 子会话列表。
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
 * 计算"自身或后代中存在活动任务"的会话标识集合。
 *
 * 用于决定下拉菜单中归档/删除项是否应置灰。
 */
function computeSubtreeActiveIds(
  sessions: readonly AgentSessionSummary[],
  childrenByParentId: Map<string, AgentSessionSummary[]>,
): Set<string> {
  const directlyActive = new Set(
    sessions
      .filter((s) => s.state === 'running' || s.state === 'queued')
      .map((s) => s.sessionId),
  )

  const cache = new Map<string, boolean>()

  function hasActiveSubtree(sessionId: string): boolean {
    const cached = cache.get(sessionId)
    if (cached !== undefined) return cached

    if (directlyActive.has(sessionId)) {
      cache.set(sessionId, true)
      return true
    }
    // 先写入 false 以打断循环引用，递归结束后再用实际结果覆盖。
    cache.set(sessionId, false)
    const children = childrenByParentId.get(sessionId) ?? []
    const result = children.some((child) => hasActiveSubtree(child.sessionId))
    cache.set(sessionId, result)
    return result
  }

  const result = new Set<string>()
  for (const session of sessions) {
    if (hasActiveSubtree(session.sessionId)) {
      result.add(session.sessionId)
    }
  }
  return result
}

/**
 * 递归渲染一个会话节点及其全部后代分叉。
 */
function SessionLineageNode(props: {
  session: AgentSessionSummary
  depth: number
  childrenByParentId: Map<string, AgentSessionSummary[]>
  selectedSessionId: string | null
  pendingApprovalSessionIds: readonly string[]
  subtreeActiveSessionIds: Set<string>
  visitedSessionIds: readonly string[]
  onSelect: (session: AgentSessionSummary) => void
  onArchive: (session: AgentSessionSummary) => void
  onDelete: (session: AgentSessionSummary) => void
}): React.JSX.Element {
  const {
    session,
    depth,
    childrenByParentId,
    selectedSessionId,
    pendingApprovalSessionIds,
    subtreeActiveSessionIds,
    visitedSessionIds,
    onSelect,
    onArchive,
    onDelete,
  } = props
  const isSelected = session.sessionId === selectedSessionId
  const hasPendingApproval = pendingApprovalSessionIds.includes(
    session.sessionId,
  )
  const isRunning = session.state === 'running' || session.state === 'queued'
  const hasSubtreeActivity = subtreeActiveSessionIds.has(session.sessionId)
  const isRoot = depth === 1
  const childSessions = (
    childrenByParentId.get(session.sessionId) ?? []
  ).filter((child) => !visitedSessionIds.includes(child.sessionId))

  return (
    <div role="none">
      {/* group/item 使 ⋯ 按钮在行 hover 时可见 */}
      <div
        role="treeitem"
        tabIndex={0}
        aria-label={[
          session.title,
          hasPendingApproval ? '待审批' : isRunning ? '运行中' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-level={depth}
        aria-selected={isSelected}
        data-session-id={session.sessionId}
        className={`group/item focus-visible:ring-ring/50 relative flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-left transition-colors focus-visible:ring-[3px] focus-visible:outline-none ${
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

        {/* ⋯ 菜单触发器：hover 时可见，下拉打开时始终可见。
            React portal 事件会沿虚拟树冒泡到 treeitem 的 onClick，
            用容器 div 阻止冒泡以防误触 onSelect。 */}
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${session.title}的操作菜单`}
              className="hover:bg-accent/80 focus-visible:ring-ring/50 invisible shrink-0 rounded p-0.5 transition-colors focus-visible:ring-[3px] focus-visible:outline-none group-hover/item:visible data-[state=open]:visible"
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom">
            {hasSubtreeActivity && (
              <>
                <DropdownMenuLabel className="text-warning text-xs">
                  请先停止运行中的任务
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              disabled={hasSubtreeActivity}
              onSelect={() => {
                onArchive(session)
              }}
            >
              归档
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={hasSubtreeActivity}
              onSelect={() => {
                onDelete(session)
              }}
            >
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
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
              subtreeActiveSessionIds={subtreeActiveSessionIds}
              visitedSessionIds={[...visitedSessionIds, childSession.sessionId]}
              onSelect={onSelect}
              onArchive={onArchive}
              onDelete={onDelete}
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
 * 每个节点的行 hover 时显示 ⋯ 按钮，点击展开下拉：归档 / 分割线 / 删除。
 * 若该会话谱系存在活动任务，归档与删除项均置灰，并在菜单顶部说明原因。
 */
export function SessionLineageTree({
  sessions,
  rootSessions,
  selectedSessionId,
  pendingApprovalSessionIds,
  onSelect,
  onArchive,
  onDelete,
}: SessionLineageTreeProps): React.JSX.Element {
  const childrenByParentId = useMemo(
    () => groupChildrenByParentId(sessions),
    [sessions],
  )

  const subtreeActiveSessionIds = useMemo(
    () => computeSubtreeActiveIds(sessions, childrenByParentId),
    [sessions, childrenByParentId],
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
          subtreeActiveSessionIds={subtreeActiveSessionIds}
          visitedSessionIds={[session.sessionId]}
          onSelect={onSelect}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      ))}
    </>
  )
}
