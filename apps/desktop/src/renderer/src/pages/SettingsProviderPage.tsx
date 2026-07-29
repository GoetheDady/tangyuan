import type { RuntimeConfiguration, RuntimeSnapshot } from '@tangyuan/contracts'
import {
  Eye,
  EyeOff,
  History,
  LoaderCircle,
  Lock,
  RefreshCcw,
  ShieldCheck,
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

/**
 * 设置页 Provider 配置：在已配置状态下修改 Provider 凭据和默认模型。
 *
 * @returns 设置页 Provider 配置组件。
 */
export function SettingsProviderPage(): React.JSX.Element {
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

  const selectableModels = useMemo(
    () => runtime?.models.filter((m) => m.providerId === selectedProviderId) ?? [],
    [runtime, selectedProviderId],
  )

  const selectedProviderDisplayName = useMemo(
    () => runtime?.providers.find((p) => p.providerId === selectedProviderId)?.displayName ?? '',
    [runtime, selectedProviderId],
  )

  const selectedModelDisplayName = useMemo(
    () => selectableModels.find((m) => m.modelId === selectedModelId)?.displayName ?? '',
    [selectableModels, selectedModelId],
  )

  const canSubmit =
    Boolean(selectedProviderId) &&
    apiKey.trim().length > 0 &&
    Boolean(selectedModelId)

  const refreshRuntime = async (): Promise<void> => {
    try {
      const nextRuntime = await window.api.refreshRuntime()
      setRuntime(nextRuntime)
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

  const submitConfiguration = async (): Promise<void> => {
    if (!canSubmit) return
    const configuration: RuntimeConfiguration = {
      providerId: selectedProviderId,
      modelId: selectedModelId,
      apiKey,
    }
    setIsVerifying(true)
    setVerificationError(null)
    try {
      const nextRuntime = await window.api.saveRuntimeConfiguration(configuration)
      setRuntime(nextRuntime)
      setApiKey('')
      setVerificationError(null)
      toast.success('配置已保存')
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
      toast.success('已取消配置验证')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '取消配置验证失败')
    } finally {
      setIsVerifying(false)
    }
  }

  const handleProviderChange = (nextProviderId: string): void => {
    setSelectedProviderId(nextProviderId)
    setSelectedModelId('')
    setApiKey('')
    setVerificationError(null)
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

  return (
    <div className="w-full max-w-[520px] space-y-5">
      <div className="space-y-2">
        <h1 className="text-page-title leading-tight font-semibold">连接模型服务</h1>
        <p className="text-body text-muted-foreground">
          配置一个可用的模型服务，并将所选模型作为默认 Agent 汤圆的初始模型。
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-[7px]">
          <Label className="text-label font-medium">Provider</Label>
          <Select value={selectedProviderId} onValueChange={handleProviderChange} disabled={isVerifying}>
            <SelectTrigger data-testid="settings-provider-select" className="bg-card text-body h-10">
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

        <div className="space-y-[7px]">
          <Label htmlFor="settings-api-key-input" className="text-label font-medium">API Key</Label>
          <div className="relative">
            <Input
              id="settings-api-key-input"
              data-testid="settings-api-key-input"
              type={showApiKey ? 'text' : 'password'}
              placeholder="sk-ant-••••••••••••••••••••"
              value={apiKey}
              onChange={(event) => { setApiKey(event.target.value); setVerificationError(null) }}
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

        <div className="space-y-[7px]">
          <Label className="text-label font-medium">Model</Label>
          <Select
            value={selectedModelId}
            onValueChange={(value) => { setSelectedModelId(value); setVerificationError(null) }}
            disabled={isVerifying || !selectedProviderId}
          >
            <SelectTrigger data-testid="settings-model-select" className="bg-card text-body h-10">
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

      <div className="flex items-center gap-2">
        <Lock size={13} className="text-muted-foreground shrink-0" aria-hidden="true" />
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
            正在连接 {selectedProviderDisplayName}
            {selectedModelDisplayName ? ` · ${selectedModelDisplayName}` : ''}
          </p>
        </div>
      ) : null}

      <div className="space-y-2.5">
        <Button
          className="w-full"
          disabled={!canSubmit || isVerifying}
          onClick={() => { void submitConfiguration() }}
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
        ) : null}
      </div>

      <div className="flex justify-end pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => { void refreshRuntime() }}>
          <RefreshCcw aria-hidden="true" />
          刷新资源
        </Button>
      </div>
    </div>
  )
}
