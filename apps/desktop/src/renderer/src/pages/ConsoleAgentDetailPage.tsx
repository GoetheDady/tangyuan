import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bot,
  HardDrive,
  MessageCircle,
  Puzzle,
  Settings,
  TriangleAlert
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
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
import type {
  AgentSummary,
  ModelDescriptor,
  ProviderDescriptor,
  RuntimeSnapshot,
  SkillInstallRecord,
  SkillSummary
} from '@tangyuan/contracts'

/**
 * Agent 详情控制台页面：展示单个 Agent 的配置、模型选择和状态。
 *
 * @returns Agent 详情控制台页面。
 * @throws 此组件不会主动抛出错误。
 */
export function ConsoleAgentDetailPage(): React.JSX.Element {
  const { agentId } = useParams<{ agentId: string }>()
  const [agent, setAgent] = useState<AgentSummary | null>(null)
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [showRecoverConfirm, setShowRecoverConfirm] = useState(false)
  const [isRebuilding, setIsRebuilding] = useState(false)
  const [skills, setSkills] = useState<SkillSummary[] | null>(null)
  const [isLoadingSkills, setIsLoadingSkills] = useState(true)
  const [installRecords, setInstallRecords] = useState<SkillInstallRecord[] | null>(null)

  useEffect(() => {
    void Promise.all([window.api.listAgents(), window.api.getRuntimeSnapshot()])
      .then(([agents, snapshot]) => {
        const found = agents.find((a) => a.agentId === agentId) ?? null
        setAgent(found)
        setRuntime(snapshot)

        if (found) {
          setSelectedProviderId(found.defaultProviderId ?? '')
          setSelectedModelId(found.defaultModelId ?? '')
        }
      })
      .catch(() => {
        // 未找到
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [agentId])

  useEffect(() => {
    if (!agentId) return

    window.api
      .listAgentSkills({ agentId })
      .then((result) => {
        setSkills(result)
      })
      .catch(() => {
        setSkills(null)
      })
      .finally(() => {
        setIsLoadingSkills(false)
      })
  }, [agentId])

  useEffect(() => {
    window.api
      .getSkillInstallRecords()
      .then((records) => {
        // 过滤：当前 Agent 的专属 Skill + 所有共享 Skill
        const filtered = records.filter(
          (record) => record.source === 'shared' || record.targetAgentId === agentId
        )
        setInstallRecords(filtered)
      })
      .catch(() => {
        setInstallRecords(null)
      })
  }, [agentId])

  // 列出所有已知 Provider（Console 中允许从所有已知 Provider 中选择）
  const configuredProviders = useMemo<ProviderDescriptor[]>(() => {
    if (!runtime) return []
    return runtime.providers
  }, [runtime])

  // 根据选中的 Provider 过滤可用模型
  const selectableModels = useMemo<ModelDescriptor[]>(() => {
    if (!runtime || !selectedProviderId) return []

    return runtime.models.filter((model) => model.providerId === selectedProviderId)
  }, [runtime, selectedProviderId])

  const isEditable = agent?.status === 'active'

  async function handleProviderChange(providerId: string): Promise<void> {
    setSelectedProviderId(providerId)
    // 切换 Provider 时重置 Model
    setSelectedModelId('')

    if (!agent || !providerId) return

    await saveAgentConfig(agent.agentId, {
      defaultProviderId: providerId,
      defaultModelId: null
    })
  }

  async function handleModelChange(modelId: string): Promise<void> {
    setSelectedModelId(modelId)

    if (!agent || !modelId) return

    await saveAgentConfig(agent.agentId, { defaultModelId: modelId })
  }

  async function saveAgentConfig(
    id: string,
    patch: {
      defaultProviderId?: string | null
      defaultModelId?: string | null
    }
  ): Promise<void> {
    setIsSaving(true)

    try {
      const updated = await window.api.updateAgentConfig({
        agentId: id,
        ...patch
      })
      setAgent(updated)

      if (patch.defaultProviderId !== undefined) {
        toast.success('默认 Provider 已更新')
      } else if (patch.defaultModelId !== undefined) {
        toast.success('默认 Model 已更新')
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '保存 Agent 配置失败')
      // 回滚 UI 状态
      if (patch.defaultProviderId !== undefined) {
        setSelectedProviderId(agent?.defaultProviderId ?? '')
      }
      if (patch.defaultModelId !== undefined) {
        setSelectedModelId(agent?.defaultModelId ?? '')
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function handleArchive(): Promise<void> {
    if (!agent) return

    try {
      const updated = await window.api.archiveAgent({
        agentId: agent.agentId
      })
      setAgent(updated)
      toast.success(`已归档 Agent「${agent.displayName}」`)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '归档 Agent 失败')
    } finally {
      setShowArchiveConfirm(false)
    }
  }

  async function handleRecover(): Promise<void> {
    if (!agent) return

    try {
      const updated = await window.api.recoverAgent({
        agentId: agent.agentId
      })
      setAgent(updated)
      toast.success(`已恢复 Agent「${agent.displayName}」`)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '恢复 Agent 失败')
    } finally {
      setShowRecoverConfirm(false)
    }
  }

  async function handleRebuildTangyuan(): Promise<void> {
    setIsRebuilding(true)

    try {
      const updated = await window.api.rebuildTangyuanHome()
      setAgent(updated)
      toast.success('汤圆目录已重建')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '重建汤圆目录失败')
    } finally {
      setIsRebuilding(false)
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-full bg-background px-6 py-8 text-foreground">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm text-muted-foreground">正在加载 Agent 详情...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-full bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <div className="window-no-drag relative z-50 mb-4">
            <Link to="/console/agents">
              <Button variant="ghost" size="sm">
                <ArrowLeft aria-hidden="true" />
                返回 Agent 列表
              </Button>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
              <Bot size={20} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold leading-tight">
                {agent?.displayName ?? 'Agent 详情'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {agentId ? `ID: ${agentId}` : '配置 Agent 默认模型和状态'}
              </p>
            </div>
          </div>
        </header>

        <Separator className="mb-8" />

        {!agent ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-muted">
              <Settings size={22} className="text-muted-foreground" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-medium">Agent 未找到</h2>
            <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
              找不到 Agent「{agentId}」。可能已被删除或 ID 不正确。
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-lg border bg-card p-6">
              <h2 className="mb-4 text-lg font-semibold">基本信息</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">展示名称</dt>
                  <dd className="font-medium">{agent.displayName}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Agent ID</dt>
                  <dd className="max-w-[300px] truncate font-mono text-xs">{agent.agentId}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">状态</dt>
                  <dd>
                    <Badge variant={agent.status === 'active' ? 'success' : 'secondary'}>
                      {agent.status === 'active' ? '活跃' : '已归档'}
                    </Badge>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">目录状态</dt>
                  <dd className="flex items-center gap-1.5">
                    {agent.directoryStatus === 'damaged' ? (
                      <>
                        <TriangleAlert size={14} className="text-destructive" />
                        <span className="text-destructive font-medium">已损坏</span>
                      </>
                    ) : (
                      <>
                        <HardDrive size={14} className="text-muted-foreground" />
                        <span className="font-medium">正常</span>
                      </>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-muted-foreground">默认 Provider</dt>
                  <dd className="w-[240px]">
                    {isEditable ? (
                      <Select
                        value={selectedProviderId}
                        onValueChange={handleProviderChange}
                        disabled={isSaving}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="选择 Provider" />
                        </SelectTrigger>
                        <SelectContent>
                          {configuredProviders.map((provider) => (
                            <SelectItem key={provider.providerId} value={provider.providerId}>
                              {provider.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="font-medium">{agent.defaultProviderId ?? '未配置'}</span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-muted-foreground">默认 Model</dt>
                  <dd className="w-[240px]">
                    {isEditable ? (
                      <Select
                        value={selectedModelId}
                        onValueChange={handleModelChange}
                        disabled={isSaving || !selectedProviderId}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue
                            placeholder={selectedProviderId ? '选择 Model' : '请先选择 Provider'}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {selectableModels.map((model) => (
                            <SelectItem key={model.modelId} value={model.modelId}>
                              {model.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="font-medium">{agent.defaultModelId ?? '未配置'}</span>
                    )}
                  </dd>
                </div>
                {agent.archivedAt ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">归档时间</dt>
                    <dd className="font-medium">{agent.archivedAt}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            {/* Skills 区域 */}
            <div className="rounded-lg border bg-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Skills</h2>
                {skills ? (
                  <span className="text-xs text-muted-foreground">{skills.length} 个 Skill</span>
                ) : null}
              </div>
              {isLoadingSkills ? (
                <p className="text-sm text-muted-foreground">正在加载 Skills...</p>
              ) : !skills || skills.length === 0 ? (
                <div className="rounded-md bg-muted/50 px-4 py-8 text-center">
                  <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-muted">
                    <Puzzle size={18} className="text-muted-foreground" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">暂无 Skill</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    将 Skill 目录放入 Agent 专属或共享 Skills 目录后即可在此查看。
                  </p>
                </div>
              ) : (
                <ul className="divide-y">
                  {skills.map((skill) => (
                    <li
                      key={`${skill.source}-${skill.name}`}
                      className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded bg-muted">
                        <Puzzle size={14} aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-medium">{skill.name}</h3>
                          <Badge
                            variant={skill.source === 'agent' ? 'default' : 'secondary'}
                            className="shrink-0"
                          >
                            {skill.source === 'agent' ? '专属' : '共享'}
                          </Badge>
                          {skill.conflict ? (
                            <Badge
                              variant="outline"
                              className="shrink-0 text-amber-600 border-amber-300"
                            >
                              已覆盖同名共享 Skill
                            </Badge>
                          ) : null}
                          {skill.hasScripts ? (
                            <Badge
                              variant="outline"
                              className="shrink-0 text-orange-600 border-orange-300"
                            >
                              含脚本
                            </Badge>
                          ) : null}
                        </div>
                        {skill.description ? (
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {skill.description}
                          </p>
                        ) : null}
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/60">
                          {skill.path}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Skill 安装记录 */}
            <div className="rounded-lg border bg-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">安装记录</h2>
                {installRecords ? (
                  <span className="text-xs text-muted-foreground">
                    {installRecords.length} 条记录
                  </span>
                ) : null}
              </div>
              {!installRecords || installRecords.length === 0 ? (
                <div className="rounded-md bg-muted/50 px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">暂无安装记录</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    通过控制台或汤圆对话安装 Skill 后，记录会出现在此处。
                  </p>
                </div>
              ) : (
                <ul className="divide-y">
                  {installRecords.map((record) => (
                    <li
                      key={`${record.source}-${record.targetAgentId ?? 'shared'}-${record.skillName}`}
                      className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded bg-muted">
                        <Puzzle size={14} aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-medium">{record.skillName}</h3>
                          <Badge
                            variant={record.source === 'agent' ? 'default' : 'secondary'}
                            className="shrink-0"
                          >
                            {record.source === 'agent' ? '专属' : '共享'}
                          </Badge>
                          <Badge
                            variant={record.status === 'active' ? 'success' : 'secondary'}
                            className="shrink-0"
                          >
                            {record.status === 'active' ? '生效中' : '已删除'}
                          </Badge>
                          {record.targetAgentId ? (
                            <span className="truncate text-[10px] text-muted-foreground font-mono">
                              {record.targetAgentId}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex gap-4 text-[10px] text-muted-foreground">
                          <span>安装: {record.installedAt}</span>
                          <span>更新: {record.updatedAt}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center gap-3">
              {agent.directoryStatus !== 'damaged' && agent.status === 'active' ? (
                <Link to={`/chat/${agent.agentId}`}>
                  <Button>
                    <MessageCircle aria-hidden="true" />
                    开始对话
                  </Button>
                </Link>
              ) : null}
              {agent.status === 'active' && agent.agentId !== 'tangyuan' ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowArchiveConfirm(true)
                  }}
                >
                  <Archive aria-hidden="true" />
                  归档 Agent
                </Button>
              ) : null}
              {agent.status === 'archived' ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowRecoverConfirm(true)
                  }}
                >
                  <ArchiveRestore aria-hidden="true" />
                  恢复 Agent
                </Button>
              ) : null}
              {agent.agentId === 'tangyuan' && agent.directoryStatus === 'damaged' ? (
                <Button variant="outline" onClick={handleRebuildTangyuan} disabled={isRebuilding}>
                  <HardDrive aria-hidden="true" />
                  {isRebuilding ? '重建中...' : '重建目录'}
                </Button>
              ) : null}
              {agent.agentId === 'tangyuan' && agent.directoryStatus !== 'damaged' ? (
                <p className="text-xs text-muted-foreground">默认 Agent 不可归档</p>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>归档 Agent</AlertDialogTitle>
            <AlertDialogDescription>
              确定归档 Agent「{agent?.displayName}」吗？归档后该 Agent 将默认隐藏，但
              soul、skills、workspace 和 Pi session 不会被删除，以后可以恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>确认归档</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showRecoverConfirm} onOpenChange={setShowRecoverConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复 Agent</AlertDialogTitle>
            <AlertDialogDescription>
              确定恢复 Agent「{agent?.displayName}」吗？恢复后该 Agent
              将重新出现在活跃列表中并可以正常聊天。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecover}>确认恢复</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
