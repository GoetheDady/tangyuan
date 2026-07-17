/**
 * 渲染用户发送的纯文本消息。
 *
 * 用户消息不解析 Markdown，保持纯文本展示，
 * 避免用户输入被伪装成应用界面。
 *
 * @param props - 组件的属性。
 * @param props.content - 用户消息的纯文本内容。
 * @returns 纯文本消息元素。
 * @throws 此组件不会主动抛出错误。
 */
export function UserMessage({ content }: { content: string }): React.JSX.Element {
  return <p className="whitespace-pre-wrap break-words">{content}</p>
}
