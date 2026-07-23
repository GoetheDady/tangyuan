/**
 * 内置工具名称到中文标签的映射。
 *
 * 只包含 Pi SDK 默认安装的常见工具；不在列表中的视为自定义工具。
 */
const BUILTIN_TOOL_LABELS: Record<
  string,
  { completed: string; running: string; failed: string }
> = {
  read: {
    completed: '读取文件',
    running: '正在读取文件',
    failed: '读取文件失败',
  },
  write: {
    completed: '写入文件',
    running: '正在写入文件',
    failed: '写入文件失败',
  },
  edit: {
    completed: '编辑文件',
    running: '正在编辑文件',
    failed: '编辑文件失败',
  },
  bash: {
    completed: '执行命令',
    running: '正在执行命令',
    failed: '执行命令失败',
  },
  search: {
    completed: '搜索代码',
    running: '正在搜索代码',
    failed: '搜索代码失败',
  },
  grep: {
    completed: '搜索文本',
    running: '正在搜索文本',
    failed: '搜索文本失败',
  },
  glob: {
    completed: '查找文件',
    running: '正在查找文件',
    failed: '查找文件失败',
  },
  ls: {
    completed: '列出目录',
    running: '正在列出目录',
    failed: '列出目录失败',
  },
  web_search: {
    completed: '搜索网页',
    running: '正在搜索网页',
    failed: '搜索网页失败',
  },
  web_fetch: {
    completed: '获取网页',
    running: '正在获取网页',
    failed: '获取网页失败',
  },
}

/**
 * 为工具步骤生成不包含敏感参数的安全摘要。
 *
 * 常见内置工具使用确定性的中文标签；
 * 无法安全摘要的自定义工具回退为工具名和状态，不调用模型。
 *
 * @param toolName - 工具原名。
 * @param status - 工具执行状态。
 * @returns 可安全展示给 Renderer 的工具摘要。
 * @throws 此方法不会主动抛出错误。
 */
export function createToolStepSummary(
  toolName: string,
  status: 'running' | 'completed' | 'failed',
): string {
  const labels = BUILTIN_TOOL_LABELS[toolName]

  if (labels) {
    return labels[status]
  }

  // 自定义工具：回退为工具名和状态，不暴露参数或输出
  const statusLabel =
    status === 'running' ? '执行中' : status === 'completed' ? '已完成' : '失败'

  return `${toolName}（${statusLabel}）`
}
