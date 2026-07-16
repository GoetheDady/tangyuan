import { ArrowLeft, Bot, Settings } from 'lucide-react'
import { Link, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

/**
 * Agent 详情控制台页面：展示单个 Agent 的配置、模型选择和状态。
 *
 * @returns Agent 详情控制台页面。
 * @throws 此组件不会主动抛出错误。
 */
export function ConsoleAgentDetailPage(): React.JSX.Element {
  const { agentId } = useParams<{ agentId: string }>()

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <div className="mb-4">
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
              <h1 className="text-2xl font-semibold leading-tight">Agent 详情</h1>
              <p className="text-sm text-muted-foreground">
                {agentId ? `ID: ${agentId}` : '配置 Agent 默认模型和状态'}
              </p>
            </div>
          </div>
        </header>

        <Separator className="mb-8" />

        <div className="rounded-lg border bg-card p-12 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-muted">
            <Settings size={22} className="text-muted-foreground" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-medium">Agent 详情即将上线</h2>
          <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
            Agent 详情配置功能正在建设中。完成后，您可以在此处修改 Agent
            的默认 Provider、Model 和归档状态。
          </p>
        </div>
      </div>
    </main>
  )
}
