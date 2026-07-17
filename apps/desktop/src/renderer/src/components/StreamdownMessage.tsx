import { Streamdown, type ExtraProps } from 'streamdown'
import { code } from '@streamdown/code'
import { cjk } from '@streamdown/cjk'

type StreamdownAnchorProps = React.ClassAttributes<HTMLAnchorElement> &
  React.AnchorHTMLAttributes<HTMLAnchorElement> &
  ExtraProps

/**
 * 使用 Streamdown 安全渲染 Agent 的流式 Markdown 消息。
 *
 * 启用 Shiki 代码语法高亮（@streamdown/code）和
 * 中日韩文本处理（@streamdown/cjk）。
 * 不安装数学插件（@streamdown/math）。
 * Mermaid 由 streamdown 核心按需动态加载。
 *
 * 安全措施：
 * - streamdown 内置 rehype-harden 自动清理危险 HTML
 * - 外部链接通过 Main 进程安全打开（http/https 协议校验）
 * - 流式未闭合 Markdown 通过 parseIncompleteMarkdown 稳定渲染
 *
 * @param props - 组件的属性。
 * @param props.content - Agent 消息的 Markdown 文本。
 * @param props.isAnimating - 是否正在流式传输中。
 * @returns Streamdown 渲染的 Markdown 元素。
 * @throws 此组件不会主动抛出错误。
 */
export function StreamdownMessage({
  content,
  isAnimating = false
}: {
  content: string
  isAnimating?: boolean
}): React.JSX.Element {
  return (
    <Streamdown
      parseIncompleteMarkdown
      isAnimating={isAnimating}
      plugins={{ code, cjk }}
      components={{ a: SafeExternalLink }}
    >
      {content}
    </Streamdown>
  )
}

/**
 * 安全的外部链接组件。
 *
 * 拦截链接点击，通过 Main 进程验证协议（仅允许 http/https）
 * 后使用系统浏览器打开，防止 Renderer 跳转到未知页面。
 *
 * 使用与 Streamdown Components 类型兼容的 props 参数。
 *
 * @param props - Streamdown 传递的锚元素属性（含 href 和 children）。
 * @returns 安全链接元素。
 * @throws 此组件不会主动抛出错误；链接打开失败静默处理。
 */
function SafeExternalLink(props: StreamdownAnchorProps): React.JSX.Element {
  return (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault()
        if (props.href) {
          window.api.openExternalLink({ url: props.href }).catch(() => undefined)
        }
      }}
    />
  )
}
