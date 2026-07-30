import type { ProviderConfiguration, RuntimeSnapshot } from '@tangyuan/contracts'
import {
  Eye,
  EyeOff,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type ViewState =
  | { mode: 'list' }
  | { mode: 'add' }
  | { mode: 'edit'; providerId: string }
  | { mode: 'delete'; providerId: string }

export function SettingsProviderPage(): React.JSX.Element {
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [viewState, setViewState] = useState<ViewState>({ mode: 'list' })
  const [isRestoringConfiguration, setIsRestoringConfiguration] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationError, setVerificationError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    void window.api
      .getRuntimeSnapshot()
      .then((snapshot) => {
        if (!isMounted) return
        setRuntime(snapshot)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const configuredProviderIds = useMemo(
    () =>
      runtime
        ? Object.entries(runtime.configuredProviders)
            .filter(([, auth]) => auth.configured)
            .map(([id]) => id)
        : [],
    [runtime],
  )

  const unconfiguredProviders = useMemo(
    () =>
      runtime?.providers.filter((p) => !configuredProviderIds.includes(p.providerId)) ?? [],
    [runtime, configuredProviderIds],
  )

  const selectedProviderDisplayName =
    runtime?.providers.find((p) => p.providerId === selectedProviderId)?.displayName ?? ''

  const canSubmit = Boolean(selectedProviderId) && apiKey.trim().length > 0

  const openAdd = (): void => {
    setSelectedProviderId(unconfiguredProviders[0]?.providerId ?? '')
    setApiKey('')
    setShowApiKey(false)
    setVerificationError(null)
    setViewState({ mode: 'add' })
  }

  const openEdit = (providerId: string): void => {
    setSelectedProviderId(providerId)
    setApiKey('')
    setShowApiKey(false)
    setVerificationError(null)
    setViewState({ mode: 'edit', providerId })
  }

  const cancelForm = (): void => {
    setIsVerifying(false)
    setVerificationError(null)
    setViewState({ mode: 'list' })
  }

  const saveProvider = async (): Promise<void> => {
    const config: ProviderConfiguration = { providerId: selectedProviderId, apiKey }
    setIsVerifying(true)
    setVerificationError(null)
    try {
      const nextRuntime = await window.api.saveProvider(config)
      setRuntime(nextRuntime)
      setViewState({ mode: 'list' })
      toast.success('Provider 已保存')
    } catch (error) {
      setVerificationError(
        error instanceof Error ? error.message : '认证失败，请检查 API Key 是否有效或网络是否可用。',
      )
    } finally {
      setIsVerifying(false)
    }
  }

  const cancelVerification = async (): Promise<void> => {
    try {
      const nextRuntime = await window.api.cancelRuntimeConfigurationVerification({
        verificationId: 'current',
      })
      setRuntime(nextRuntime)
      setVerificationError(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '取消配置验证失败')
    } finally {
      setIsVerifying(false)
    }
  }

  const deleteProvider = async (providerId: string): Promise<void> => {
    try {
      const nextRuntime = await window.api.deleteProvider({ providerId })
      setRuntime(nextRuntime)
      setViewState({ mode: 'list' })
      toast.success('Provider 已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 Provider 失败')
      setViewState({ mode: 'list' })
    }
  }

  if (isLoading) {
    return <div className="text-body text-muted-foreground">正在加载配置...</div>
  }

  const isConfigCorrupted =
    runtime?.configRecovery.state === 'corrupted' ||
    runtime?.configRecovery.state === 'migration-failed'

  if (isConfigCorrupted) {
    return (
      <div className="w-full max-w-[520px] space-y-6">
        <div className="bg-warning-soft grid size-11 place-items-center rounded-xl">
          <TriangleAlert size={20} className="text-warning-foreground" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-page-title leading-tight font-semibold">无法读取本地配置</h1>
          <p className="text-body text-muted-foreground">
            {runtime?.configRecovery.state === 'migration-failed'
              ? '本地配置在迁移过程中出现问题。你可以恢复最近的备份，或清除配置后重新连接模型服务。'
              : '配置文件已损坏，无法读取。你可以恢复最近的备份，或重置配置后重新连接模型服务。'}
          </p>
        </div>
        {runtime?.configRecovery.hasBackup ? (
          <div className="bg-card flex items-start gap-2.5 rounded-lg p-3">
            <History size={15} className="text-success-foreground mt-px shrink-0" aria-hidden="true" />
            <div>
              <p className="text-caption font-semibold">最近备份可用</p>
              <p className="text-muted-foreground text-[10px]">恢复后将重新检查 Provider 和模型配置</p>
            </div>
          </div>
        ) : null}
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
        <div className="flex items-center gap-2">
          <ShieldCheck size={13} className="text-muted-foreground shrink-0" aria-hidden="true" />
          <p className="text-muted-foreground text-[10px]">不会删除 Agent、用户资料或历史会话</p>
        </div>
      </div>
    )
  }

  if (viewState.mode === 'add' || viewState.mode === 'edit') {
    const isEdit = viewState.mode === 'edit'
    const formProviders = isEdit ? (runtime?.providers ?? []) : unconfiguredProviders

    return (
      <div className="w-full max-w-[520px] space-y-5">
        <div className="space-y-2">
          <h1 className="text-page-title leading-tight font-semibold">
            {isEdit ? '编辑 Provider' : '添加 Provider'}
          </h1>
        </div>

        <div className="space-y-4">
          <div className="space-y-[7px]">
            <Label className="text-label font-medium">Provider</Label>
            <Select
              value={selectedProviderId}
              onValueChange={(v) => { setSelectedProviderId(v); setVerificationError(null) }}
              disabled={isVerifying || isEdit}
            >
              <SelectTrigger data-testid="settings-provider-select" className="bg-card text-body h-10">
                <SelectValue placeholder="选择 Provider" />
              </SelectTrigger>
              <SelectContent>
                {formProviders.map((provider) => (
                  <SelectItem key={provider.providerId} value={provider.providerId}>
                    {provider.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-[7px]">
            <Label htmlFor="settings-api-key-input" className="text-label font-medium">API Key</Label>
            <div className="relative">
              <Input
                id="settings-api-key-input"
                data-testid="settings-api-key-input"
                type={showApiKey ? 'text' : 'password'}
                placeholder="sk-ant-••••••••••••••••••••"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setVerificationError(null) }}
                disabled={isVerifying}
                className={verificationError ? 'border-destructive ring-destructive/20' : ''}
                aria-invalid={Boolean(verificationError)}
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors duration-200 disabled:opacity-50"
                onClick={() => { setShowApiKey(!showApiKey) }}
                disabled={isVerifying}
                aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showApiKey ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ShieldCheck size={13} className="text-muted-foreground shrink-0" aria-hidden="true" />
          <p className="text-muted-foreground text-[10px]">API Key 使用 macOS 安全存储加密保存在本机</p>
        </div>

        {verificationError ? (
          <div className="bg-destructive-soft border-destructive-border flex items-start gap-2.5 rounded-lg border p-3">
            <TriangleAlert size={15} className="text-destructive-soft-foreground mt-px shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-caption text-destructive-soft-foreground font-semibold">无法连接模型服务</p>
              <p className="text-destructive-soft-foreground text-[10px] leading-[1.45]">{verificationError}</p>
            </div>
          </div>
        ) : null}

        {isVerifying ? (
          <div className="bg-info-soft flex items-center gap-2 rounded-lg p-2.5">
            <LoaderCircle size={14} className="text-info-foreground animate-spin" aria-hidden="true" />
            <p className="text-caption text-info-foreground font-medium">
              正在验证 {selectedProviderDisplayName}
            </p>
          </div>
        ) : null}

        <div className="space-y-2.5">
          <Button
            className="w-full"
            disabled={!canSubmit || isVerifying}
            onClick={() => { void saveProvider() }}
          >
            {isVerifying ? (
              <><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />正在验证</>
            ) : verificationError ? '重新验证' : '验证并保存'}
          </Button>
          {isVerifying ? (
            <button
              type="button"
              className="text-caption text-muted-foreground hover:text-foreground block w-full rounded-lg py-2 font-medium transition-colors duration-200"
              onClick={() => { void cancelVerification() }}
            >
              取消验证
            </button>
          ) : (
            <button
              type="button"
              className="text-caption text-muted-foreground hover:text-foreground block w-full rounded-lg py-2 font-medium transition-colors duration-200"
              onClick={cancelForm}
            >
              取消
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-[520px] space-y-5">
      <div className="space-y-2">
        <h1 className="text-page-title leading-tight font-semibold">模型服务</h1>
        <p className="text-body text-muted-foreground">管理已连接的模型服务 Provider。</p>
      </div>

      {configuredProviderIds.length === 0 ? (
        <div className="bg-card rounded-lg py-8 text-center">
          <p className="text-body text-muted-foreground">尚未配置任何 Provider</p>
        </div>
      ) : (
        <div className="space-y-2">
          {configuredProviderIds.map((providerId) => {
            const displayName =
              runtime?.providers.find((p) => p.providerId === providerId)?.displayName ?? providerId
            const auth = runtime?.configuredProviders[providerId]
            const isDeleting = viewState.mode === 'delete' && viewState.providerId === providerId

            if (isDeleting) {
              return (
                <div
                  key={providerId}
                  className="bg-destructive-soft border-destructive-border space-y-3 rounded-lg border p-3"
                >
                  <div className="flex items-start gap-2.5">
                    <TriangleAlert size={15} className="text-destructive-soft-foreground mt-px shrink-0" aria-hidden="true" />
                    <div className="space-y-0.5">
                      <p className="text-caption text-destructive-soft-foreground font-semibold">
                        删除 {displayName}？
                      </p>
                      <p className="text-destructive-soft-foreground text-[10px] leading-[1.45]">
                        使用此 Provider 的 Agent 和会话将无法继续调用模型，此操作无法撤销。
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setViewState({ mode: 'list' }) }}>
                      取消
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => { void deleteProvider(providerId) }}>
                      确认删除
                    </Button>
                  </div>
                </div>
              )
            }

            return (
              <div key={providerId} className="bg-card flex items-center gap-3 rounded-lg px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-label font-medium">{displayName}</p>
                  {auth?.maskedValue ? (
                    <p className="text-muted-foreground font-mono text-[10px]">{auth.maskedValue}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={`编辑 ${displayName}`}
                    className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors duration-200"
                    onClick={() => { openEdit(providerId) }}
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`删除 ${displayName}`}
                    className="text-muted-foreground hover:text-destructive rounded p-1 transition-colors duration-200"
                    onClick={() => { setViewState({ mode: 'delete', providerId }) }}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {unconfiguredProviders.length > 0 ? (
        <Button variant="outline" className="w-full" onClick={openAdd}>
          <Plus aria-hidden="true" />
          添加 Provider
        </Button>
      ) : null}

      <div className="flex justify-end pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              const nextRuntime = await window.api.refreshRuntime()
              setRuntime(nextRuntime)
              toast.success('已刷新可用模型资源')
            } catch (error) {
              toast.error(error instanceof Error ? error.message : '刷新运行时资源失败')
            }
          }}
        >
          <RefreshCcw aria-hidden="true" />
          刷新资源
        </Button>
      </div>
    </div>
  )
}
