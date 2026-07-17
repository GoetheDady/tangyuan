import type { RuntimeConfiguration, RuntimeSnapshot } from '@tangyuan/contracts'
import { ArrowRight, Ban, Check, CheckCircle2, RefreshCcw, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Provider 控制台页面：管理多个模型服务凭据和汤圆默认配置。
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
  const [isVerifyingProvider, setIsVerifyingProvider] = useState<string | null>(null)
  const [isRestoringConfiguration, setIsRestoringConfiguration] = useState(false)

  // 每个 Provider 独立表单：modelId 和 apiKey
  const [providerForms, setProviderForms] = useState<
    Record<string, { modelId: string; apiKey: string }>
  >({})

  useEffect(() => {
    let isMounted = true

    void window.api
      .getRuntimeSnapshot()
      .then((snapshot) => {
        if (!isMounted) return
        setRuntime(snapshot)

        // 预填充已配置 Provider 的 modelId
        const forms: Record<string, { modelId: string; apiKey: string }> = {}
        for (const provider of snapshot.providers) {
          forms[provider.providerId] = {
            modelId:
              snapshot.settings.selectedProviderId === provider.providerId
                ? (snapshot.settings.selectedModelId ?? '')
                : '',
            apiKey: ''
          }
        }
        setProviderForms(forms)
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
      toast.success('已刷新可用模型资源')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '刷新运行时资源失败')
    }
  }

  /**
   * 验证并保存某个 Provider 的 API Key。
   *
   * @param providerId - 要保存凭据的 Provider 标识。
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const saveConfiguration = async (providerId: string): Promise<void> => {
    const form = providerForms[providerId]
    if (!form) return

    const configuration: RuntimeConfiguration = {
      providerId,
      modelId: form.modelId,
      apiKey: form.apiKey
    }

    setIsVerifyingProvider(providerId)

    try {
      const nextRuntime = await window.api.saveRuntimeConfiguration(configuration)
      setRuntime(nextRuntime)
      // 清空该 Provider 的 API Key 输入
      setProviderForms((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], apiKey: '' }
      }))
      await openBootstrapSessionIfRequired(nextRuntime)
      toast.success('配置已保存')
      // 不自动跳转，以便用户继续配置其他 Provider
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '配置验证失败')
    } finally {
      setIsVerifyingProvider(null)
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
      setIsVerifyingProvider(null)
    }
  }

  // 仅在初始加载时：如果配置已就绪，直接跳转到目标页
  const initialRedirectAttempted = useRef(false)
  useEffect(() => {
    if (initialRedirectAttempted.current) return
    if (!isLoading && !isVerifyingProvider && runtime?.status === 'ready') {
      initialRedirectAttempted.current = true
      navigate(redirectTarget, { replace: true })
    }
  }, [isLoading, isVerifyingProvider, runtime?.status, navigate, redirectTarget])

  /**
   * 获取指定 Provider 可供选择的模型列表。
   *
   * @param providerId - Provider 唯一标识。
   * @returns 属于该 Provider 的模型描述列表；运行时未加载时返回空数组。
   * @throws 此方法不会主动抛出错误。
   */
  const getModelsForProvider = (providerId: string): RuntimeSnapshot['models'] =>
    runtime?.models.filter((m) => m.providerId === providerId) ?? []

  // 有凭据的 Provider 列表
  const configuredProviderIds = useMemo(
    () =>
      runtime
        ? Object.entries(runtime.configuredProviders)
            .filter(([, auth]) => auth.configured)
            .map(([id]) => id)
        : [],
    [runtime]
  )

  if (isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">正在打开控制台...</div>
      </main>
    )
  }

  const isConfigCorrupted =
    runtime?.configRecovery.state === 'corrupted' ||
    runtime?.configRecovery.state === 'migration-failed'

  if (isConfigCorrupted) {
    return (
      <main className="min-h-screen bg-background px-6 py-8 text-foreground">
        <motion.section
          className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
            <h1 className="text-xl font-semibold">配置文件异常</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {runtime?.configRecovery.state === 'migration-failed'
                ? '配置文件无法自动迁移到新格式。'
                : '配置文件已损坏，无法读取。'}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {runtime?.configRecovery.hasBackup ? (
                <Button
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
                  {isRestoringConfiguration ? '恢复中' : '从备份恢复'}
                </Button>
              ) : null}
              <Button
                variant="outline"
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
                重置配置
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              重置配置不会删除 Agent 数据、用户资料或会话记录。
            </p>
          </div>
        </motion.section>
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
          {/* 左侧品牌面板 */}
          <section className="border-r bg-muted/35 p-8">
            <div className="mb-7 grid size-11 place-items-center rounded-md bg-primary text-primary-foreground">
              <Sparkles size={21} aria-hidden="true" />
            </div>
            <p className="text-sm text-muted-foreground">控制台</p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight">配置模型服务</h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
              为 Provider 配置 API Key 并选择汤圆默认模型。完成后会直接进入聊天主界面。
            </p>
          </section>

          {/* 右侧配置面板 */}
          <section className="space-y-6 overflow-y-auto p-8">
            {/* 汤圆默认模型 */}
            <div className="rounded-md border bg-muted/20 p-4">
              <h2 className="mb-3 text-sm font-semibold">汤圆默认模型</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="default-provider">Provider</Label>
                  <select
                    id="default-provider"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={runtime?.settings.selectedProviderId ?? ''}
                    disabled={configuredProviderIds.length === 0 || isVerifyingProvider !== null}
                    onChange={(event) => {
                      const newProviderId = event.target.value
                      if (!newProviderId) return
                      // 复用现有 API Key 更新默认设置
                      const existingAuth = runtime?.configuredProviders[newProviderId]
                      if (!existingAuth?.configured) return

                      // 修改默认设置：用空 apiKey 会导致 normalize 拒绝
                      // 我们需要通过 saveConfiguration 来设置默认
                      // MVP：引导用户在 Provider 卡片中重新验证以切换默认
                      toast.info('请在下方 Provider 凭据中重新验证以切换默认模型')
                    }}
                  >
                    {configuredProviderIds.length === 0 ? (
                      <option value="">请先配置 Provider 凭据</option>
                    ) : null}
                    {configuredProviderIds.map((id) => {
                      const provider = runtime?.providers.find((p) => p.providerId === id)
                      return (
                        <option key={id} value={id}>
                          {provider?.displayName ?? id}
                        </option>
                      )
                    })}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="default-model">Model</Label>
                  <select
                    id="default-model"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={runtime?.settings.selectedModelId ?? ''}
                    disabled
                  >
                    <option value="">{runtime?.settings.selectedModelId ?? '未选择'}</option>
                  </select>
                </div>
              </div>
              {configuredProviderIds.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  请先配置至少一个 Provider 的 API Key 以启用聊天。
                </p>
              ) : null}
            </div>

            {/* Provider 凭据卡片 */}
            <div>
              <h2 className="mb-3 text-sm font-semibold">Provider 凭据</h2>
              {!runtime?.providers.length ? (
                <p className="text-sm text-muted-foreground">
                  未发现可用 Provider，请检查 Pi Agent 安装后刷新资源。
                </p>
              ) : (
                <div className="space-y-3">
                  {runtime.providers.map((provider) => {
                    const providerAuth = runtime.configuredProviders[provider.providerId]
                    const isConfigured = providerAuth?.configured ?? false
                    const form = providerForms[provider.providerId] ?? {
                      modelId: '',
                      apiKey: ''
                    }
                    const isVerifyingThis = isVerifyingProvider === provider.providerId
                    const isVerifyingOther = isVerifyingProvider !== null && !isVerifyingThis
                    const models = getModelsForProvider(provider.providerId)
                    const canSubmit = Boolean(form.modelId) && form.apiKey.trim().length > 0

                    return (
                      <div key={provider.providerId} className="rounded-md border bg-card p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <h3 className="text-sm font-medium">{provider.displayName}</h3>
                          <Badge variant={isConfigured ? 'default' : 'secondary'}>
                            {isConfigured ? (
                              <Check size={12} className="mr-1" aria-hidden="true" />
                            ) : null}
                            {isConfigured ? '已配置' : '未配置'}
                          </Badge>
                        </div>

                        {isConfigured && providerAuth?.maskedValue ? (
                          <p className="mb-3 text-xs text-muted-foreground">
                            已保存：{providerAuth.maskedValue}
                          </p>
                        ) : null}

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor={`model-${provider.providerId}`}>Model</Label>
                            <select
                              id={`model-${provider.providerId}`}
                              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                              value={form.modelId}
                              onChange={(event) => {
                                setProviderForms((prev) => ({
                                  ...prev,
                                  [provider.providerId]: {
                                    ...prev[provider.providerId],
                                    modelId: event.target.value
                                  }
                                }))
                              }}
                              disabled={isVerifyingThis}
                            >
                              <option value="">选择模型</option>
                              {models.map((model) => (
                                <option
                                  key={`${model.providerId}:${model.modelId}`}
                                  value={model.modelId}
                                >
                                  {model.displayName}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`api-key-${provider.providerId}`}>API Key</Label>
                            <Input
                              id={`api-key-${provider.providerId}`}
                              type="password"
                              placeholder={isConfigured ? '留空以保留已保存的密钥' : ''}
                              value={form.apiKey}
                              onChange={(event) => {
                                setProviderForms((prev) => ({
                                  ...prev,
                                  [provider.providerId]: {
                                    ...prev[provider.providerId],
                                    apiKey: event.target.value
                                  }
                                }))
                              }}
                              disabled={isVerifyingThis}
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <Button
                            size="sm"
                            disabled={isVerifyingOther || !canSubmit}
                            onClick={() => {
                              void saveConfiguration(provider.providerId)
                            }}
                          >
                            <CheckCircle2 aria-hidden="true" />
                            {isVerifyingThis
                              ? '验证中'
                              : isConfigured
                                ? '验证并更新'
                                : '验证并保存'}
                          </Button>
                          {isVerifyingThis ? (
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={() => {
                                void cancelConfigurationVerification()
                              }}
                            >
                              <Ban aria-hidden="true" />
                              取消验证
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-3 pt-1">
              {runtime?.status === 'ready' ? (
                <Button
                  size="sm"
                  onClick={() => {
                    navigate(redirectTarget, { replace: true })
                  }}
                >
                  <ArrowRight aria-hidden="true" />
                  进入聊天
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void refreshRuntime()
                }}
              >
                <RefreshCcw aria-hidden="true" />
                刷新资源
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              配置通过真实 Provider 验证后才会保存。API Key 仅加密保存在本机。
            </p>
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
