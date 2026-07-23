import {
  Archive,
  ArchiveRestore,
  Bot,
  ExternalLink,
  FolderSearch,
  MessageCircle,
  Settings,
  TriangleAlert
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AgentSummary, UnclaimedDirectory } from '@tangyuan/contracts'

/**
 * Agent 控制台页面：展示所有 Agent 列表、状态和归档管理。
 *
 * @returns Agent 列表控制台页面。
 * @throws 此组件不会主动抛出错误。
 */
export function ConsoleAgentListPage(): React.JSX.Element {
  const [allAgents, setAllAgents] = useState<AgentSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<AgentSummary | null>(null)
  const [recoverTarget, setRecoverTarget] = useState<AgentSummary | null>(null)
  const [isReconciling, setIsReconciling] = useState(false)
  const [unclaimedDirectories, setUnclaimedDirectories] = useState<UnclaimedDirectory[]>([])
  const [claimTarget, setClaimTarget] = useState<UnclaimedDirectory | null>(null)

  const loadAgents = useCallback(() => {
    void window.api
      .listAgents()
      .then((nextAgents) => {
        setAllAgents(nextAgents)
      })
      .catch(() => {
        // 使用空列表作为回退
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  const displayedAgents = showArchived
    ? allAgents
    : allAgents.filter((agent) => agent.status === 'active')

  const archivedCount = allAgents.filter((agent) => agent.status === 'archived').length

  async function handleArchive(): Promise<void> {
    if (!archiveTarget) return

    try {
      const updated = await window.api.archiveAgent({
        agentId: archiveTarget.agentId
      })
      setAllAgents((current) => current.map((a) => (a.agentId === updated.agentId ? updated : a)))
      toast.success(`已归档 Agent「${archiveTarget.displayName}」`)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '归档 Agent 失败')
    } finally {
      setArchiveTarget(null)
    }
  }

  async function handleRecover(): Promise<void> {
    if (!recoverTarget) return

    try {
      const updated = await window.api.recoverAgent({
        agentId: recoverTarget.agentId
      })
      setAllAgents((current) => current.map((a) => (a.agentId === updated.agentId ? updated : a)))
      toast.success(`已恢复 Agent「${recoverTarget.displayName}」`)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '恢复 Agent 失败')
    } finally {
      setRecoverTarget(null)
    }
  }

  async function handleReconcile(): Promise<void> {
    setIsReconciling(true)

    try {
      const result = await window.api.reconcileAgentDirectories()
      setAllAgents(result.agents)
      setUnclaimedDirectories(result.unclaimedDirectories)

      const damagedCount = result.agents.filter((a) => a.directoryStatus === 'damaged').length
      if (damagedCount > 0 || result.unclaimedDirectories.length > 0) {
        toast.warning(
          `对账完成：${damagedCount} 个 Agent 目录异常，${result.unclaimedDirectories.length} 个未归属目录`
        )
      } else {
        toast.success('目录对账完成，所有 Agent 目录正常')
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '目录对账失败')
    } finally {
      setIsReconciling(false)
    }
  }

  async function handleClaimDirectory(directory: UnclaimedDirectory): Promise<void> {
    try {
      const displayName = directory.agentId
      const updated = await window.api.claimAgentDirectory({
        agentId: directory.agentId,
        displayName
      })
      setAllAgents((current) => [...current, updated])
      setUnclaimedDirectories((current) => current.filter((d) => d.agentId !== directory.agentId))
      toast.success(`已认领 Agent「${displayName}」`)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '认领目录失败')
    } finally {
      setClaimTarget(null)
    }
  }

  return (
    <main className="min-h-full bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
              <Bot size={20} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold leading-tight">Agent 管理</h1>
              <p className="text-body text-muted-foreground">查看和管理所有 Agent 的状态与默认模型</p>
            </div>
          </div>
        </header>

        <Separator className="mb-8" />

        {isLoading ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <p className="text-body text-muted-foreground">正在加载 Agent 列表...</p>
          </div>
        ) : allAgents.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-muted">
              <Bot size={22} className="text-muted-foreground" aria-hidden="true" />
            </div>
            <h2 className="text-section-heading font-medium">暂无 Agent</h2>
            <p className="mt-2 max-w-md mx-auto text-body text-muted-foreground">
              请先在控制台中配置模型服务，然后在汤圆对话中创建新的 Agent。
            </p>
            <div className="mt-6">
              <Link to="/console/providers">
                <Button variant="outline" size="sm">
                  <Settings aria-hidden="true" />
                  前往 Provider 控制台
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {archivedCount > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowArchived(!showArchived)
                    }}
                  >
                    {showArchived ? '隐藏归档' : `显示归档（${archivedCount}）`}
                  </Button>
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReconcile}
                disabled={isReconciling}
              >
                <FolderSearch aria-hidden="true" />
                {isReconciling ? '对账中...' : '目录对账'}
              </Button>
            </div>

            <div className="space-y-3">
              {displayedAgents.map((agent) => (
                <div
                  key={agent.agentId}
                  className="flex items-center justify-between rounded-lg border bg-card p-4 transition hover:shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <h3 className="truncate text-body font-semibold">{agent.displayName}</h3>
                      {agent.agentId === 'tangyuan' ? (
                        <Badge variant="secondary">默认</Badge>
                      ) : null}
                      <Badge variant={agent.status === 'active' ? 'success' : 'secondary'}>
                        {agent.status === 'active' ? '活跃' : '已归档'}
                      </Badge>
                      {agent.directoryStatus === 'damaged' ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <TriangleAlert
                              size={14}
                              className="text-destructive cursor-help"
                              aria-label="Agent 目录已损坏"
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            Agent 目录缺失，无法聊天。请使用目录对账或重建。
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-label text-muted-foreground">
                      ID：{agent.agentId}
                      {agent.defaultProviderId && agent.defaultModelId
                        ? ` · 默认模型：${agent.defaultProviderId}/${agent.defaultModelId}`
                        : ' · 未配置默认模型'}
                      {agent.archivedAt ? ` · 归档于：${agent.archivedAt}` : null}
                    </p>
                  </div>
                  <div className="ml-4 flex items-center gap-2">
                    {agent.directoryStatus !== 'damaged' && agent.status === 'active' ? (
                      <Link to={`/chat/${agent.agentId}`}>
                        <Button variant="outline" size="sm">
                          <MessageCircle aria-hidden="true" />
                          对话
                        </Button>
                      </Link>
                    ) : null}
                    {agent.status === 'active' && agent.agentId !== 'tangyuan' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setArchiveTarget(agent)
                        }}
                      >
                        <Archive aria-hidden="true" />
                        归档
                      </Button>
                    ) : null}
                    {agent.status === 'archived' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRecoverTarget(agent)
                        }}
                      >
                        <ArchiveRestore aria-hidden="true" />
                        恢复
                      </Button>
                    ) : null}
                    <Link to={`/console/agents/${agent.agentId}`}>
                      <Button variant="ghost" size="icon" className="size-8">
                        <ExternalLink size={15} aria-hidden="true" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            {unclaimedDirectories.length > 0 ? (
              <div className="mt-8">
                <h2 className="mb-3 text-section-heading font-semibold">未归属目录</h2>
                <p className="mb-4 text-body text-muted-foreground">
                  以下目录存在于磁盘上但未在配置中注册，可认领为活跃 Agent。
                </p>
                <div className="space-y-3">
                  {unclaimedDirectories.map((dir) => (
                    <div
                      key={dir.agentId}
                      className="flex items-center justify-between rounded-lg border border-dashed bg-card p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-body font-semibold">{dir.agentId}</h3>
                        <p className="mt-1 truncate text-label text-muted-foreground">
                          路径：{dir.homePath}
                          {dir.hasSoul ? ' · 包含 soul.md' : ' · 缺少 soul.md'}
                        </p>
                      </div>
                      <div className="ml-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setClaimTarget(dir)
                          }}
                        >
                          认领
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>归档 Agent</AlertDialogTitle>
            <AlertDialogDescription>
              确定归档 Agent「{archiveTarget?.displayName}」吗？归档后该 Agent 将默认隐藏，但
              soul、skills、workspace 和 Pi session 不会被删除，以后可以恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>确认归档</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={recoverTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRecoverTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复 Agent</AlertDialogTitle>
            <AlertDialogDescription>
              确定恢复 Agent「{recoverTarget?.displayName}」吗？恢复后该 Agent
              将重新出现在活跃列表中并可以正常聊天。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecover}>确认恢复</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={claimTarget !== null}
        onOpenChange={(open) => {
          if (!open) setClaimTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>认领 Agent 目录</AlertDialogTitle>
            <AlertDialogDescription>
              确定认领目录「{claimTarget?.agentId}」吗？将为该目录创建 Agent
              配置条目，展示名称与目录名相同。认领后 Agent 立即可用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (claimTarget) handleClaimDirectory(claimTarget)
              }}
            >
              确认认领
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
