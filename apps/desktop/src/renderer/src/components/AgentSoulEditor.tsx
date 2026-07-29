import type { SoulContent } from '@tangyuan/contracts'
import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface AgentSoulEditorProps {
  agentId: string
  editable: boolean
}

/** 设置页中的 Agent 灵魂受控编辑入口。 */
export function AgentSoulEditor({
  agentId,
  editable,
}: AgentSoulEditorProps): React.JSX.Element {
  const [soul, setSoul] = useState<SoulContent | null>(null)
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void window.api
      .getSoul({ agentId })
      .then((result) => {
        if (cancelled) return
        setSoul(result)
        setContent(result.content)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : '加载 Agent 灵魂失败',
        )
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [agentId])

  async function handleSave(): Promise<void> {
    if (!soul || !content.trim()) return

    setIsSaving(true)
    setError(null)
    try {
      const result = await window.api.updateSoul({
        agentId,
        content,
        expectedVersion: soul.version,
      })

      if (result.status === 'rejected') {
        setError(result.reason.message)
        if (result.reason.code === 'version-conflict') {
          const latestSoul = await window.api
            .getSoul({ agentId })
            .catch(() => null)
          if (latestSoul) {
            setSoul(latestSoul)
            setContent(latestSoul.content)
          }
        }
        return
      }

      setSoul({ ...soul, content, version: result.version })
      toast.success(
        result.status === 'updated' ? 'Agent 灵魂已更新' : 'Agent 灵魂没有变化',
      )
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error ? saveError.message : '保存 Agent 灵魂失败',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const canSave =
    editable &&
    soul !== null &&
    content.trim().length > 0 &&
    content !== soul.content

  return (
    <section className="bg-card rounded-lg border p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-section-heading font-semibold">Agent 灵魂</h2>
        {editable ? (
          <Button onClick={handleSave} disabled={!canSave || isSaving}>
            <Save aria-hidden="true" />
            {isSaving ? '保存中...' : '保存 Agent 灵魂'}
          </Button>
        ) : null}
      </div>
      {isLoading ? (
        <p className="text-body text-muted-foreground">
          正在加载 Agent 灵魂...
        </p>
      ) : (
        <Textarea
          id="agent-soul"
          aria-label="Agent 灵魂"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          readOnly={!editable}
          disabled={isSaving || soul === null}
          className="min-h-48 font-mono leading-6"
        />
      )}
      {error ? (
        <p role="alert" className="text-label text-destructive mt-3">
          {error}
        </p>
      ) : null}
    </section>
  )
}
