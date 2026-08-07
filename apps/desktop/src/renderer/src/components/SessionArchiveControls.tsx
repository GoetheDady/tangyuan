import type {
  AgentSessionSummary,
  SessionLineageActivity,
  SessionLineageActivityKind,
} from '@yuanxiao/contracts'
import { ArchiveRestore } from 'lucide-react'
import { useMemo } from 'react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

const activityKindLabels: Record<SessionLineageActivityKind, string> = {
  running: '运行中',
  queued: '排队中',
}

export function ArchivedSessionList(props: {
  sessions: readonly AgentSessionSummary[]
  recoveringSessionId: string | null
  onRecover(session: AgentSessionSummary): void
}): React.JSX.Element | null {
  const rootSessions = useMemo(() => {
    const archivedIds = new Set(
      props.sessions.map((session) => session.sessionId),
    )
    return props.sessions.filter(
      (session) =>
        !session.forkedFrom || !archivedIds.has(session.forkedFrom.sessionId),
    )
  }, [props.sessions])

  if (rootSessions.length === 0) return null

  return (
    <section
      aria-labelledby="archived-sessions-heading"
      className="border-border border-t px-2 py-2"
    >
      <h3
        id="archived-sessions-heading"
        className="text-muted-foreground flex h-5 items-center px-2.5 font-mono text-[8px] font-semibold"
      >
        已归档
      </h3>
      <div className="space-y-0.5">
        {rootSessions.map((session) => (
          <div
            key={session.sessionId}
            className="text-muted-foreground hover:bg-secondary/60 flex h-8 min-w-0 items-center gap-1 rounded-lg px-2.5 text-[11px] transition-colors"
          >
            <span className="min-w-0 flex-1 truncate">{session.title}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`恢复「${session.title}」会话谱系`}
              title={`恢复「${session.title}」会话谱系`}
              disabled={props.recoveringSessionId !== null}
              onClick={() => {
                props.onRecover(session)
              }}
            >
              <ArchiveRestore aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}

export function SessionDeleteDialog(props: {
  open: boolean
  activities: readonly SessionLineageActivity[]
  isDeleting: boolean
  onCancel(): void
  onConfirm(): void
}): React.JSX.Element {
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {props.activities.length > 0
              ? '停止活动并永久删除会话谱系？'
              : '永久删除会话谱系？'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {props.activities.length > 0
              ? '以下会话仍有活动。确认后会先停止这些活动，再永久删除目标会话及其后代。此操作不可撤销。'
              : '确认后将永久删除当前会话及其全部后代。此操作不可撤销。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {props.activities.length > 0 ? (
          <ul className="text-foreground space-y-1 text-sm">
            {props.activities.map((activity) => (
              <li key={activity.sessionId}>
                {activity.title}：
                {activity.kinds
                  .map((kind) => activityKindLabels[kind])
                  .join('、')}
              </li>
            ))}
          </ul>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.isDeleting}>
            取消
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={props.isDeleting}
            onClick={props.onConfirm}
          >
            {props.activities.length > 0
              ? '停止活动并永久删除'
              : '确认永久删除'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
