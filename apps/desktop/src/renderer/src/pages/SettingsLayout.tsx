import { ArrowLeft, Bot, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useSearchParams } from 'react-router'
import desktopPackage from '../../../../package.json'

/**
 * 设置页布局外壳：左侧导航 200px + 右侧内容区 Outlet。
 *
 * @returns 设置页布局。
 */
export function SettingsLayout(): React.JSX.Element {
  const [searchParams] = useSearchParams()
  const [redirectTarget] = useState(
    () => searchParams.get('redirect') ?? '/chat/yuanxiao',
  )

  return (
    <div className="flex h-full">
      <aside className="bg-sidebar flex w-[200px] shrink-0 flex-col gap-2 p-[9px_12px_14px_12px]">
        {/* macOS 窗口控件占位，与拖拽区高度对齐 */}
        <div className="h-9" aria-hidden="true" />

        <Link
          to={redirectTarget}
          className="window-no-drag hover:bg-secondary flex h-9 items-center gap-2 rounded-lg px-2 text-sm transition-colors"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          返回聊天
        </Link>

        <p className="text-muted-foreground px-2 font-mono text-[8px] font-semibold tracking-wide uppercase">
          设置
        </p>

        <nav className="flex flex-col gap-1" aria-label="设置导航">
          <NavLink
            to="/settings/providers"
            className={({ isActive }) =>
              `window-no-drag flex h-9 items-center gap-2 rounded-lg px-2 text-sm transition-colors ${isActive ? 'bg-secondary' : 'hover:bg-secondary/60'}`
            }
          >
            <Settings2 size={15} aria-hidden="true" />
            模型服务
          </NavLink>
          <NavLink
            to="/settings/agents"
            className={({ isActive }) =>
              `window-no-drag flex h-9 items-center gap-2 rounded-lg px-2 text-sm transition-colors ${isActive ? 'bg-secondary' : 'hover:bg-secondary/60'}`
            }
          >
            <Bot size={15} aria-hidden="true" />
            Agents
          </NavLink>
        </nav>

        <div className="flex-1" />

        <p className="text-disabled px-2 font-mono text-[8px]">
          元宵 {desktopPackage.version}
        </p>
      </aside>

      <div className="bg-background flex-1 overflow-y-auto px-[72px] py-[52px]">
        <Outlet />
      </div>
    </div>
  )
}
