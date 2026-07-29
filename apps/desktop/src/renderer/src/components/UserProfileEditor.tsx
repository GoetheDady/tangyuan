import type { UserProfileContent } from '@tangyuan/contracts'
import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface UserProfileEditorProps {
  editable: boolean
}

/** 设置页中的共享用户画像受控编辑入口。 */
export function UserProfileEditor({
  editable,
}: UserProfileEditorProps): React.JSX.Element {
  const [profile, setProfile] = useState<UserProfileContent | null>(null)
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void window.api
      .getUserProfile()
      .then((result) => {
        if (cancelled) return
        setProfile(result)
        setContent(result.content)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(
          loadError instanceof Error ? loadError.message : '加载用户画像失败',
        )
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave(): Promise<void> {
    if (!profile || !content.trim()) return

    setIsSaving(true)
    setError(null)
    try {
      const result = await window.api.updateUserProfile({
        content,
        expectedVersion: profile.version,
      })

      if (result.status === 'rejected') {
        setError(result.reason.message)
        if (result.reason.code === 'version-conflict') {
          const latestProfile = await window.api
            .getUserProfile()
            .catch(() => null)
          if (latestProfile) {
            setProfile(latestProfile)
            setContent(latestProfile.content)
          }
        }
        return
      }

      setProfile({ ...profile, content, version: result.version })
      toast.success(
        result.status === 'updated' ? '用户画像已更新' : '用户画像没有变化',
      )
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error ? saveError.message : '保存用户画像失败',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const canSave =
    editable &&
    profile !== null &&
    content.trim().length > 0 &&
    content !== profile.content

  return (
    <section className="bg-card rounded-lg border p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-section-heading font-semibold">共享用户画像</h2>
          <p className="text-label text-muted-foreground mt-1">
            所有 Agent 共享的长期偏好、工作方式和边界。
          </p>
        </div>
        {editable ? (
          <Button onClick={handleSave} disabled={!canSave || isSaving}>
            <Save aria-hidden="true" />
            {isSaving ? '保存中...' : '保存用户画像'}
          </Button>
        ) : null}
      </div>
      {isLoading ? (
        <p className="text-body text-muted-foreground">正在加载用户画像...</p>
      ) : (
        <Textarea
          id="user-profile"
          aria-label="共享用户画像"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          readOnly={!editable}
          disabled={isSaving || profile === null}
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
