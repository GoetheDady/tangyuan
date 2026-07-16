import type {
  RuntimeConfiguration,
  RuntimeSnapshot
} from '@tangyuan/contracts'
import { Ban, CheckCircle2, RefreshCcw, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Provider 控制台页面：管理模型服务凭据和默认配置。
 *
 * @returns 控制台 Provider 配置页面。
 * @throws 此组件不会主动抛出错误；保存错误会通过 toast 反馈。
 */
export function ConsoleProviderPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const redirectTarget = searchParams.get('redirect') ?? '/chat/tangyuan'

  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isVerifyingConfiguration, setIsVerifyingConfiguration] = useState(false)
  const [configurationForm, setConfigurationForm] = useState<RuntimeConfiguration>({
    providerId: '',
    modelId: '',
    apiKey: ''
  })

  useEffect(() => {
    let isMounted = true

    void window.api
      .getRuntimeSnapshot()
      .then((snapshot) => {
        if (!isMounted) return
        setRuntime(snapshot)
        setConfigurationForm((currentForm) => ({
          providerId: currentForm.providerId || snapshot.settings.selectedProviderId || '',
          modelId: currentForm.modelId || snapshot.settings.selectedModelId || '',
          apiKey: ''
        }))
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
  }, [])

  const selectableModels = useMemo(
    () =>
      runtime?.models.filter(
        (model) => model.providerId === configurationForm.providerId
      ) ?? [],
    [configurationForm.providerId, runtime?.models]
  )

  const canSubmitConfiguration = Boolean(
    configurationForm.providerId &&
      configurationForm.modelId &&
      configurationForm.apiKey.trim()
  )

  /**
   * 刷新 Provider 和模型资源，并同步配置表单默认值。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const refreshRuntime = async (): Promise<void> => {
    try {
      const nextRuntime = await window.api.refreshRuntime()
      setRuntime(nextRuntime)
      setConfigurationForm((currentForm) => ({
        providerId: currentForm.providerId || nextRuntime.settings.selectedProviderId || '',
        modelId: currentForm.modelId || nextRuntime.settings.selectedModelId || '',
        apiKey: ''
      }))
      toast.success('已刷新可用模型资源')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '刷新运行时资源失败')
    }
  }

  /**
   * 保存配置前调用 Main 侧真实 Pi SDK 验证流程。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const saveConfiguration = async (): Promise<void> => {
    setIsVerifyingConfiguration(true)

    try {
      const nextRuntime = await window.api.saveRuntimeConfiguration(configurationForm)
      setRuntime(nextRuntime)
      setConfigurationForm({
        providerId: nextRuntime.settings.selectedProviderId ?? configurationForm.providerId,
        modelId: nextRuntime.settings.selectedModelId ?? configurationForm.modelId,
        apiKey: ''
      })
      await openBootstrapSessionIfRequired(nextRuntime)
      toast.success('配置已保存')
      navigate(redirectTarget, { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '配置验证失败')
    } finally {
      setIsVerifyingConfiguration(false)
    }
  }

  /**
   * 取消当前配置验证。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const cancelConfigurationVerification = async (): Promise<void> => {
    try {
      const nextRuntime = await window.api.cancelRuntimeConfigurationVerification({
        verificationId: 'current'
      })
      setRuntime(nextRuntime)
      toast.success('已取消配置验证')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '取消配置验证失败')
    } finally {
      setIsVerifyingConfiguration(false)
    }
  }

  // 如果配置已就绪，直接跳转到目标页
  useEffect(() => {
    if (!isLoading && !isVerifyingConfiguration && runtime?.status === 'ready') {
      navigate(redirectTarget, { replace: true })
    }
  }, [isLoading, isVerifyingConfiguration, runtime?.status, navigate, redirectTarget])

  if (isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">正在打开控制台...</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <motion.section
        className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="grid w-full grid-cols-[0.9fr_1.1fr] overflow-hidden rounded-lg border bg-card shadow-sm">
          <section className="border-r bg-muted/35 p-8">
            <div className="mb-7 grid size-11 place-items-center rounded-md bg-primary text-primary-foreground">
              <Sparkles size={21} aria-hidden="true" />
            </div>
            <p className="text-sm text-muted-foreground">控制台</p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight">配置模型服务</h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
              选择 Provider、模型并验证 API Key。完成后会直接进入聊天主界面。
            </p>
          </section>

          <section className="p-8">
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault()
                void saveConfiguration()
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <select
                  id="provider"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={configurationForm.providerId}
                  onChange={(event) => {
                    setConfigurationForm((currentForm) => ({
                      ...currentForm,
                      providerId: event.target.value,
                      modelId: ''
                    }))
                  }}
                  disabled={isVerifyingConfiguration}
                >
                  <option value="">选择模型服务</option>
                  {runtime?.providers.map((provider) => (
                    <option key={provider.providerId} value={provider.providerId}>
                      {provider.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <select
                  id="model"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={configurationForm.modelId}
                  onChange={(event) => {
                    setConfigurationForm((currentForm) => ({
                      ...currentForm,
                      modelId: event.target.value
                    }))
                  }}
                  disabled={isVerifyingConfiguration || !configurationForm.providerId}
                >
                  <option value="">选择模型</option>
                  {selectableModels.map((model) => (
                    <option key={`${model.providerId}:${model.modelId}`} value={model.modelId}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  value={configurationForm.apiKey}
                  onChange={(event) => {
                    setConfigurationForm((currentForm) => ({
                      ...currentForm,
                      apiKey: event.target.value
                    }))
                  }}
                  disabled={isVerifyingConfiguration}
                />
                {runtime?.auth.apiKey.maskedValue ? (
                  <p className="text-xs text-muted-foreground">
                    已保存：{runtime.auth.apiKey.maskedValue}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="submit"
                  disabled={isVerifyingConfiguration || isLoading || !canSubmitConfiguration}
                >
                  <CheckCircle2 aria-hidden="true" />
                  {isVerifyingConfiguration ? '验证中' : '验证并保存'}
                </Button>
                {isVerifyingConfiguration ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void cancelConfigurationVerification()
                    }}
                  >
                    <Ban aria-hidden="true" />
                    取消验证
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void refreshRuntime()
                  }}
                >
                  <RefreshCcw aria-hidden="true" />
                  刷新资源
                </Button>
              </div>
            </form>

            <p className="mt-6 text-xs text-muted-foreground">配置通过验证后才会保存。</p>
          </section>
        </div>
      </motion.section>
    </main>
  )
}

/**
 * 在首次 profile 尚未初始化时创建并选中 bootstrap 会话。
 *
 * @param nextRuntime - 保存配置后得到的最新运行时快照。
 * @returns 无返回值。
 * @throws Preload API 错误会透传给调用方，由保存配置流程统一展示。
 */
async function openBootstrapSessionIfRequired(
  nextRuntime: RuntimeSnapshot
): Promise<void> {
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
