import { resolve as pathResolve } from 'node:path'

/**
 * 文件路径校验的上下文。
 */
export interface FilePathGuardParams {
  agentId: string
  path: string
  operation: 'read' | 'write' | 'edit'
}

/**
 * 文件路径校验结果：allowed 为 false 时 reason 说明拒绝原因。
 */
export interface FilePathGuardResult {
  allowed: boolean
  reason?: string
}

const OPERATION_LABELS: Record<FilePathGuardParams['operation'], string> = {
  read: '读取',
  write: '写入',
  edit: '编辑',
}

/**
 * 校验文件路径是否允许 Agent 通过通用文件工具访问。
 *
 * 这是安全边界：拦截对 Agent 身份（soul）、Skill、配置和用户资料等
 * 受保护数据的直接读写，强制走专用工具。纯函数，不依赖运行时状态。
 *
 * @param params - 校验上下文（Agent、路径、操作类型）。
 * @returns allowed 为 true 表示允许访问；为 false 时 reason 包含拒绝原因。
 */
export function validateFilePath(
  params: FilePathGuardParams,
): FilePathGuardResult {
  const resolvedPath = pathResolve(params.path)
  const operationLabel = OPERATION_LABELS[params.operation]

  // 检查路径中是否包含受保护的子路径（soul、skills、config、profile）
  const pathSegments = resolvedPath.split('/')

  // Agent 灵魂及历史备份 → 引导使用 update_soul
  if (
    pathSegments.includes('soul.md') ||
    pathSegments.includes('soul.history')
  ) {
    return {
      allowed: false,
      reason: `不允许${operationLabel} Agent 灵魂文件：${resolvedPath}。请使用 update_soul 工具修改 Agent 灵魂。`,
    }
  }

  // 共享用户画像及历史备份 → 引导使用 update_user_profile
  if (
    pathSegments.includes('profile') &&
    (pathSegments.includes('user.md') || pathSegments.includes('user.history'))
  ) {
    return {
      allowed: false,
      reason: `不允许${operationLabel}共享用户画像文件：${resolvedPath}。请使用 update_user_profile 工具修改用户画像。`,
    }
  }

  // Skill 和配置文件 → 通用专用工具引导
  if (
    pathSegments.includes('skills') ||
    pathSegments.includes('config.json') ||
    pathSegments.includes('config.backups')
  ) {
    return {
      allowed: false,
      reason: `不允许${operationLabel}受保护的文件：${resolvedPath}。该路径包含 Agent 配置或 Skill 等受保护数据，请使用专用工具操作。`,
    }
  }

  return { allowed: true }
}
