import type {
  AgentSessionSummary,
  SessionLineageActivity,
  SessionLineageActivityKind
} from '@tangyuan/contracts'
import { Archive, ArchiveRestore } from 'lucide-react'
import { useMemo } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

const activityKindLabels: Record<SessionLineageActivityKind, string> = {
  running: '运行中',
  queued: '排队中',
  'pending-approval': '待审批',
  'pending-clarification': '待澄清'
}

export function SessionArchiveButton(props: {
  disabled: boolean
  onArchive(): void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="window-no-drag relative z-50"
      aria-label="归档当前会话谱系"
      title="归档当前会话谱系"
      disabled={props.disabled}
      onClick={props.onArchive}
    >
      <Archive aria-hidden="true" />
    </Button>
  )
}

export function ArchivedSessionList(props: {
  sessions: readonly AgentSessionSummary[]
  recoveringSessionId: string | null
  onRecover(session: AgentSessionSummary): void
}): React.JSX.Element | null {
  const rootSessions = useMemo(() => {
    const archivedIds = new Set(props.sessions.map((session) => session.sessionId))
    return props.sessions.filter(
      (session) => !session.forkedFrom || !archivedIds.has(session.forkedFrom.sessionId)
    )
  }, [props.sessions])

  if (rootSessions.length === 0) return null

  return (
    <section
      aria-labelledby="archived-sessions-heading"
      className="border-t border-border px-2 py-2"
    >
      <h3
        id="archived-sessions-heading"
        className="flex h-5 items-center px-2.5 font-mono text-[8px] font-semibold text-muted-foreground"
      >
        已归档
      </h3>
      <div className="space-y-0.5">
        {rootSessions.map((session) => (
          <div
            key={session.sessionId}
            className="flex h-8 min-w-0 items-center gap-1 rounded-lg px-2.5 text-[11px] text-muted-foreground"
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

export function SessionArchiveDialog(props: {
  activities: readonly SessionLineageActivity[]
  isArchiving: boolean
  onCancel(): void
  onConfirm(): void
}): React.JSX.Element {
  return (
    <AlertDialog
      open={props.activities.length > 0}
      onOpenChange={(open) => {
        if (!open) props.onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>停止活动并归档会话谱系？</AlertDialogTitle>
          <AlertDialogDescription>
            以下会话仍有活动。确认后会先停止这些活动，再归档目标会话及其后代。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="space-y-1 text-sm text-foreground">
          {props.activities.map((activity) => (
            <li key={activity.sessionId}>
              {activity.title}：{activity.kinds.map((kind) => activityKindLabels[kind]).join('、')}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.isArchiving}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={props.isArchiving}
            onClick={props.onConfirm}
          >
            停止活动并归档
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
