import { Bot, Settings } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

/**
 * Agent 控制台页面：展示所有 Agent 列表、状态和归档管理。
 *
 * @returns Agent 列表控制台页面。
 * @throws 此组件不会主动抛出错误。
 */
export function ConsoleAgentListPage(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
              <Bot size={20} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold leading-tight">Agent 管理</h1>
              <p className="text-sm text-muted-foreground">查看和管理所有 Agent 的状态与默认模型</p>
            </div>
          </div>
        </header>

        <Separator className="mb-8" />

        <div className="rounded-lg border bg-card p-12 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-muted">
            <Bot size={22} className="text-muted-foreground" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-medium">Agent 列表即将上线</h2>
          <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
            Agent 列表功能正在建设中。完成后，您可以在此处查看所有 Agent
            的状态、修改默认模型以及管理归档。
          </p>
          <div className="mt-6">
            <Link to="/console/providers">
              <Button variant="outline" size="sm">
                <Settings aria-hidden="true" />
                前往 Provider 控制台
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
