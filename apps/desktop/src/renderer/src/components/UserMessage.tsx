/**
 * 渲染用户发送的纯文本消息。
 *
 * 默认保持消息内容简单、可换行，并避免将用户输入解析成 Markdown 或 HTML。
 *
 * @param props - 组件的属性。
 * @param props.content - 用户消息的纯文本内容。
 * @returns 纯文本消息元素。
 * @throws 此组件不会主动抛出错误。
 */
export function UserMessage({
  content,
}: {
  content: string
}): React.JSX.Element {
  return <p className="break-words whitespace-pre-wrap">{content}</p>
}
