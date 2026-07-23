import type { RuntimeConfiguration, RuntimeSnapshot } from '@tangyuan/contracts'
import { Eye, EyeOff, History, LoaderCircle, Lock, RefreshCcw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

/**
 * 初始化配置页面：首次启动时配置 Provider 凭据和默认模型。
 *
 * 包含四种状态：
 * - 默认：表单可填写，选择 Provider、输入 API Key、选择 Model 后提交。
 * - 验证中：表单禁用，展示连接状态和取消入口。
 * - 验证失败：表单恢复，展示脱敏错误信息。
 * - 配置恢复：配置文件损坏时提供备份恢复或重置入口。
 *
 * @returns 初始化配置页面。
 * @throws 此组件不会主动抛出错误；保存错误会通过 toast 反馈。
 */
export function ConsoleProviderPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const redirectTarget = searchParams.get('redirect') ?? '/chat/tangyuan'

  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [isRestoringConfiguration, setIsRestoringConfiguration] = useState(false)

  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)

  useEffect(() => {
    let isMounted = true

    void window.api
      .getRuntimeSnapshot()
      .then((snapshot) => {
        if (!isMounted) return
        setRuntime(snapshot)

        // 预填第一个 Provider 为默认选中
        if (snapshot.providers.length > 0 && !selectedProviderId) {
          setSelectedProviderId(snapshot.providers[0].providerId)
        }
      })
      .catch((error: unknown) => {
        if (!isMounted) return
        toast.error(error instanceof Error ? error.message : '无法读取运行时状态')
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
    // 仅在挂载时运行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 当前选中 Provider 的可用模型列表
  const selectableModels = useMemo(
    () => runtime?.models.filter((m) => m.providerId === selectedProviderId) ?? [],
    [runtime, selectedProviderId]
  )

  // 当前选中 Provider 的展示名称
  const selectedProviderDisplayName = useMemo(
    () => runtime?.providers.find((p) => p.providerId === selectedProviderId)?.displayName ?? '',
    [runtime, selectedProviderId]
  )

  // 当前选中 Model 的展示名称
  const selectedModelDisplayName = useMemo(
    () => selectableModels.find((m) => m.modelId === selectedModelId)?.displayName ?? '',
    [selectableModels, selectedModelId]
  )

  const canSubmit = Boolean(selectedProviderId) && apiKey.trim().length > 0 && Boolean(selectedModelId)

  // 配置已就绪时自动跳转
  const initialRedirectAttempted = useRef(false)
  useEffect(() => {
    if (initialRedirectAttempted.current) return
    if (!isLoading && !isVerifying && runtime?.status === 'ready') {
      initialRedirectAttempted.current = true
      navigate(redirectTarget, { replace: true })
    }
  }, [isLoading, isVerifying, runtime?.status, navigate, redirectTarget])

  /**
   * 刷新 Provider 和模型资源。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const refreshRuntime = async (): Promise<void> => {
    try {
      const nextRuntime = await window.api.refreshRuntime()
      setRuntime(nextRuntime)

      // 刷新后如果当前 Provider 不再可用，切换到第一个
      if (!nextRuntime.providers.find((p) => p.providerId === selectedProviderId)) {
        const firstProvider = nextRuntime.providers[0]
        setSelectedProviderId(firstProvider?.providerId ?? '')
        setSelectedModelId('')
        setApiKey('')
      }

      toast.success('已刷新可用模型资源')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '刷新运行时资源失败')
    }
  }

  /**
   * 验证并保存 Provider 配置。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会在页面内展示脱敏错误信息。
   */
  const submitConfiguration = async (): Promise<void> => {
    if (!canSubmit) return

    const configuration: RuntimeConfiguration = {
      providerId: selectedProviderId,
      modelId: selectedModelId,
      apiKey
    }

    setIsVerifying(true)
    setVerificationError(null)

    try {
      const nextRuntime = await window.api.saveRuntimeConfiguration(configuration)
      setRuntime(nextRuntime)
      setApiKey('')
      setVerificationError(null)
      toast.success('配置已保存')

      // 如果是首次 profile 初始化，创建 bootstrap 会话
      await openBootstrapSessionIfRequired(nextRuntime)
      navigate(redirectTarget, { replace: true })
    } catch (error) {
      setVerificationError(
        error instanceof Error ? error.message : '认证失败，请检查 API Key 是否有效或网络是否可用。'
      )
    } finally {
      setIsVerifying(false)
    }
  }

  /**
   * 取消当前配置验证。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const cancelVerification = async (): Promise<void> => {
    try {
      const nextRuntime = await window.api.cancelRuntimeConfigurationVerification({
        verificationId: 'current'
      })
      setRuntime(nextRuntime)
      setVerificationError(null)
      toast.success('已取消配置验证')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '取消配置验证失败')
    } finally {
      setIsVerifying(false)
    }
  }

  /**
   * 切换 Provider 时重置关联的 Model 和 API Key。
   *
   * @param nextProviderId - 新选中的 Provider 标识。
   * @returns 无返回值。
   */
  const handleProviderChange = (nextProviderId: string): void => {
    setSelectedProviderId(nextProviderId)
    setSelectedModelId('')
    setApiKey('')
    setVerificationError(null)
  }

  // ===== 加载态 =====
  if (isLoading) {
    return (
      <main className="grid min-h-full place-items-center bg-background text-foreground">
        <div className="text-body text-muted-foreground">正在打开控制台...</div>
      </main>
    )
  }

  // ===== 配置恢复态 =====
  const isConfigCorrupted =
    runtime?.configRecovery.state === 'corrupted' ||
    runtime?.configRecovery.state === 'migration-failed'

  if (isConfigCorrupted) {
    return (
      <main className="flex min-h-full items-center justify-center bg-background px-6 text-foreground">
        <div className="w-full max-w-[520px] space-y-6">
          {/* 警告图标 */}
          <div className="grid size-11 place-items-center rounded-xl bg-warning-soft">
            <TriangleAlert size={20} className="text-warning-foreground" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <h1 className="text-page-title font-semibold leading-tight">无法读取本地配置</h1>
            <p className="text-body text-muted-foreground">
              {runtime?.configRecovery.state === 'migration-failed'
                ? '本地配置在迁移过程中出现问题。你可以恢复最近的备份，或清除配置后重新连接模型服务。'
                : '配置文件已损坏，无法读取。你可以恢复最近的备份，或重置配置后重新连接模型服务。'}
            </p>
          </div>

          {/* 备份可用提示 */}
          {runtime?.configRecovery.hasBackup ? (
            <div className="flex items-start gap-2.5 rounded-lg bg-card p-3">
              <History size={15} className="mt-px shrink-0 text-success-foreground" aria-hidden="true" />
              <div>
                <p className="text-caption font-semibold">最近备份可用</p>
                <p className="text-[10px] text-muted-foreground">恢复后将重新检查 Provider 和模型配置</p>
              </div>
            </div>
          ) : null}

          {/* 操作按钮 */}
          <div className="space-y-2.5">
            {runtime?.configRecovery.hasBackup ? (
              <Button
                className="w-full"
                disabled={isRestoringConfiguration}
                onClick={async () => {
                  setIsRestoringConfiguration(true)
                  try {
                    const nextRuntime = await window.api.restoreFromBackup()
                    setRuntime(nextRuntime)
                    toast.success('已从备份恢复配置')
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : '恢复配置失败')
                  } finally {
                    setIsRestoringConfiguration(false)
                  }
                }}
              >
                <History aria-hidden="true" />
                从备份恢复
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="w-full"
              disabled={isRestoringConfiguration}
              onClick={async () => {
                setIsRestoringConfiguration(true)
                try {
                  const nextRuntime = await window.api.resetConfiguration()
                  setRuntime(nextRuntime)
                  toast.success('已重置配置')
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : '重置配置失败')
                } finally {
                  setIsRestoringConfiguration(false)
                }
              }}
            >
              重置并重新配置
            </Button>
          </div>

          {/* 数据安全提示 */}
          <div className="flex items-center gap-2">
            <ShieldCheck size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-[10px] text-muted-foreground">不会删除 Agent、用户资料或历史会话</p>
          </div>
        </div>
      </main>
    )
  }

  // ===== 默认 / 验证中 / 验证失败态 =====
  return (
    <main className="flex min-h-full items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-[520px] space-y-5">
        {/* 表单头部 */}
        <div className="space-y-2">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            首次配置
          </p>
          <h1 className="text-page-title font-semibold leading-tight">连接模型服务</h1>
          <p className="text-body text-muted-foreground">
            配置一个可用的模型服务，并将所选模型作为默认 Agent 汤圆的初始模型。
          </p>
        </div>

        {/* 表单字段 */}
        <div className="space-y-4">
          {/* Provider */}
          <div className="space-y-[7px]">
            <Label className="text-label font-medium">
              Provider
            </Label>
            <Select
              value={selectedProviderId}
              onValueChange={handleProviderChange}
              disabled={isVerifying}
            >
              <SelectTrigger
                data-testid="setup-provider-select"
                className="h-10 bg-card text-body"
              >
                <SelectValue placeholder="选择 Provider" />
              </SelectTrigger>
              <SelectContent>
                {runtime?.providers.map((provider) => (
                  <SelectItem key={provider.providerId} value={provider.providerId}>
                    {provider.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* API Key */}
          <div className="space-y-[7px]">
            <Label htmlFor="setup-api-key-input" className="text-label font-medium">
              API Key
            </Label>
            <div className="relative">
              <Input
                id="setup-api-key-input"
                data-testid="setup-api-key-input"
                type={showApiKey ? 'text' : 'password'}
                placeholder="sk-ant-••••••••••••••••••••"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value)
                  setVerificationError(null)
                }}
                disabled={isVerifying}
                className={verificationError ? 'border-destructive ring-destructive/20' : ''}
                aria-invalid={Boolean(verificationError)}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors duration-200 hover:text-foreground disabled:opacity-50"
                onClick={() => {
                  setShowApiKey(!showApiKey)
                }}
                disabled={isVerifying}
                aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showApiKey ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
            </div>
          </div>

          {/* Model */}
          <div className="space-y-[7px]">
            <Label className="text-label font-medium">
              Model
            </Label>
            <Select
              value={selectedModelId}
              onValueChange={(value) => {
                setSelectedModelId(value)
                setVerificationError(null)
              }}
              disabled={isVerifying || !selectedProviderId}
            >
              <SelectTrigger
                data-testid="setup-model-select"
                className="h-10 bg-card text-body"
              >
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                {selectableModels.map((model) => (
                  <SelectItem key={`${model.providerId}:${model.modelId}`} value={model.modelId}>
                    {model.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 安全提示 */}
        <div className="flex items-center gap-2">
          <Lock size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-[10px] text-muted-foreground">API Key 使用 macOS 安全存储加密保存在本机</p>
        </div>

        {/* 验证错误提示 */}
        {verificationError ? (
          <div className="flex items-start gap-2.5 rounded-lg bg-destructive-soft border border-destructive-border p-3">
            <TriangleAlert size={15} className="mt-px shrink-0 text-destructive-soft-foreground" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-caption font-semibold text-destructive-soft-foreground">无法连接模型服务</p>
              <p className="text-[10px] leading-[1.45] text-destructive-soft-foreground">{verificationError}</p>
            </div>
          </div>
        ) : null}

        {/* 验证中状态提示 */}
        {isVerifying ? (
          <div className="flex items-center gap-2 rounded-lg bg-info-soft p-2.5">
            <LoaderCircle size={14} className="animate-spin text-info-foreground" aria-hidden="true" />
            <p className="text-caption font-medium text-info-foreground">
              正在连接 {selectedProviderDisplayName}
              {selectedModelDisplayName ? ` · ${selectedModelDisplayName}` : ''}
            </p>
          </div>
        ) : null}

        {/* 操作按钮 */}
        <div className="space-y-2.5">
          <Button
            className="w-full"
            disabled={!canSubmit || isVerifying}
            onClick={() => {
              void submitConfiguration()
            }}
          >
            {isVerifying ? (
              <>
                <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                正在验证
              </>
            ) : verificationError ? (
              '重新验证'
            ) : (
              '验证并继续'
            )}
          </Button>

          {isVerifying ? (
            <button
              type="button"
              className="block w-full rounded-lg py-2 text-caption font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
              onClick={() => {
                void cancelVerification()
              }}
            >
              取消验证
            </button>
          ) : null}
        </div>

        {/* 辅助操作 */}
        <div className="flex items-center justify-between pt-1">
          {runtime?.status === 'ready' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigate(redirectTarget, { replace: true })
              }}
            >
              进入聊天
            </Button>
          ) : (
            <div />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void refreshRuntime()
            }}
          >
            <RefreshCcw aria-hidden="true" />
            刷新资源
          </Button>
        </div>
      </div>
    </main>
  )
}

/**
 * 在首次 profile 尚未初始化时创建并选中 bootstrap 会话。
 *
 * @param nextRuntime - 保存配置后得到的最新运行时快照。
 * @returns 无返回值。
 * @throws Preload API 错误会透传给调用方。
 */
async function openBootstrapSessionIfRequired(nextRuntime: RuntimeSnapshot): Promise<void> {
  if (nextRuntime.status !== 'ready' || !nextRuntime.activeAgent.profile.bootstrapRequired) {
    return
  }

  const existingSessions = await window.api.listSessions()

  if (existingSessions.length) {
    return
  }

  await window.api.createSession({
    agentId: nextRuntime.activeAgent.agentId,
    title: 'Bootstrap 初始化'
  })
}
