import type { SessionModelInfo } from '@yuanxiao/contracts'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

interface UseSessionModelControllerOptions {
  agentId: string
  sessionId: string | undefined
}

/** 统一会话模型读取与写入的 latest-request-wins 状态机。 */
export function useSessionModelController({
  agentId,
  sessionId,
}: UseSessionModelControllerOptions): {
  sessionModelInfo: SessionModelInfo | null
  isLoadingModelInfo: boolean
  isSwitchingModel: boolean
  setModel(providerId: string, modelId: string): Promise<void>
  setThinkingLevel(level: string): Promise<void>
} {
  const [sessionModelInfo, setSessionModelInfo] =
    useState<SessionModelInfo | null>(null)
  const [isLoadingModelInfo, setIsLoadingModelInfo] = useState(false)
  const [isSwitchingModel, setIsSwitchingModel] = useState(false)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    if (!sessionId || !agentId) {
      setSessionModelInfo(null)
      setIsLoadingModelInfo(false)
      setIsSwitchingModel(false)
      return
    }

    setIsLoadingModelInfo(true)
    void window.api
      .getSessionModelInfo({ agentId, sessionId })
      .then((info) => {
        if (requestId === requestIdRef.current) setSessionModelInfo(info)
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setSessionModelInfo(null)
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setIsLoadingModelInfo(false)
      })
  }, [agentId, sessionId])

  async function setModel(providerId: string, modelId: string): Promise<void> {
    if (!sessionId || !agentId) return
    const requestId = ++requestIdRef.current
    setIsSwitchingModel(true)
    setIsLoadingModelInfo(false)
    try {
      const info = await window.api.setSessionModel({
        agentId,
        sessionId,
        providerId,
        modelId,
      })
      if (requestId !== requestIdRef.current) return
      setSessionModelInfo(info)
      toast.success(`已切换到 ${info.displayName}`)
    } catch (error: unknown) {
      if (requestId !== requestIdRef.current) return
      toast.error(error instanceof Error ? error.message : '切换模型失败')
    } finally {
      if (requestId === requestIdRef.current) setIsSwitchingModel(false)
    }
  }

  async function setThinkingLevel(level: string): Promise<void> {
    if (!sessionId || !agentId) return
    const requestId = ++requestIdRef.current
    setIsSwitchingModel(true)
    setIsLoadingModelInfo(false)
    try {
      const info = await window.api.setSessionThinkingLevel({
        agentId,
        sessionId,
        level,
      })
      if (requestId !== requestIdRef.current) return
      setSessionModelInfo(info)
      toast.success(`已切换到 Thinking Level: ${level}`)
    } catch (error: unknown) {
      if (requestId !== requestIdRef.current) return
      toast.error(
        error instanceof Error ? error.message : '切换 Thinking Level 失败',
      )
    } finally {
      if (requestId === requestIdRef.current) setIsSwitchingModel(false)
    }
  }

  return {
    sessionModelInfo,
    isLoadingModelInfo,
    isSwitchingModel,
    setModel,
    setThinkingLevel,
  }
}
