import { dirname, resolve as pathResolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { ToolApprovalGateway } from '../driver'
import { describeBashRisk } from './utils'

/**
 * Pi SDK 原生危险工具名：文件读取、命令执行、文件写入和文件编辑。
 *
 * 这四个原生工具不带审批和路径校验，必须在创建 session 时通过
 * `excludeTools` 显式排除，改由本模块的受保护版本接管。受保护版本
 * 使用不同的工具名（见 {@link PROTECTED_TOOL_NAMES}），因此排除原生名
 * 不会牵连它们——安全边界不依赖 SDK「后注册同名工具覆盖前者」的实现细节。
 */
export const NATIVE_DANGEROUS_TOOL_NAMES = [
  'read',
  'bash',
  'write',
  'edit',
] as const

/**
 * 元宵受保护工具名，与被排除的原生工具一一对应。
 */
export const PROTECTED_TOOL_NAMES = {
  read: 'read_file',
  bash: 'run_command',
  write: 'write_file',
  edit: 'edit_file',
} as const

/**
 * 工具执行结果：只返回纯文本内容给 Agent。
 */
interface ProtectedToolResult {
  content: Array<{ type: string; text: string }>
}

/**
 * 元宵自定义工具定义。
 *
 * 参数用 JSON Schema 字面量描述、`execute` 采用简化签名，沿用
 * profile-tools 的既有约定。转成 Pi SDK `ToolDefinition` 的适配集中在
 * {@link toSdkCustomTools} 一处，避免类型断言散落在接线代码里。
 */
export interface YuanxiaoToolDefinition extends Record<string, unknown> {
  name: string
  label: string
  description: string
  promptSnippet: string
  promptGuidelines: string[]
  parameters: Record<string, unknown>
  // 使用方法语法（非属性箭头函数），参数位置为双变，
  // 因此各工具具体的 params 类型可赋值给本签名。
  execute(toolCallId: string, params: never): Promise<ProtectedToolResult>
}

/**
 * 构造受保护工具所需的运行上下文。
 */
export interface ProtectedToolContext {
  /** 审批与路径校验网关。 */
  gateway: ToolApprovalGateway
  agentId: string
  sessionId: string
  /** 会话工作目录，用于解析相对路径和执行命令。 */
  cwd: string
}

/**
 * 把 Agent 传入的路径解析为绝对路径，并交给网关校验。
 *
 * @param context - 运行上下文。
 * @param path - Agent 传入的路径（可为相对路径）。
 * @param operation - 操作类型，决定拒绝原因的措辞。
 * @returns 校验通过时返回 `{ resolvedPath }`；被拒绝时返回 `{ reason }`。
 */
function guardPath(
  context: ProtectedToolContext,
  path: string,
  operation: 'read' | 'write' | 'edit',
): { resolvedPath: string; reason?: undefined } | { reason: string } {
  const resolvedPath = pathResolve(context.cwd, path)
  const guard = context.gateway.validateFilePath({
    agentId: context.agentId,
    path: resolvedPath,
    operation,
  })

  if (!guard.allowed) {
    return { reason: guard.reason ?? `不允许访问 ${resolvedPath}。` }
  }

  return { resolvedPath }
}

/**
 * 创建受审批的命令执行工具，替代原生 bash。
 *
 * 每次执行前都会创建审批请求；用户未批准或拒绝时命令绝不执行。
 *
 * @param context - 运行上下文。
 * @returns 命令执行工具定义。
 */
export function createRunCommandTool(
  context: ProtectedToolContext,
): YuanxiaoToolDefinition {
  return {
    name: PROTECTED_TOOL_NAMES.bash,
    label: '运行命令（需审批）',
    description:
      '在当前工作目录中执行 bash 命令。每次执行前需要用户审批。命令将以当前 macOS 用户权限运行。',
    promptSnippet: `${PROTECTED_TOOL_NAMES.bash}(command: string) → 执行 bash 命令`,
    promptGuidelines: [
      '执行前会请求用户审批，仅本次有效',
      '命令将以当前 macOS 用户权限执行',
      '如果用户拒绝，命令不会执行',
    ],
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1 },
      },
      required: ['command'],
      additionalProperties: false,
    },
    async execute(_toolCallId: string, params: { command: string }) {
      const result = await context.gateway.requestBashApproval({
        agentId: context.agentId || 'yuanxiao',
        sessionId: context.sessionId,
        runId: '',
        command: params.command,
        cwd: context.cwd,
        riskDescription: describeBashRisk(params.command),
      })

      if (!result.approved) {
        return {
          content: [{ type: 'text', text: '用户拒绝了此命令的执行。' }],
        }
      }

      try {
        const { exec } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execAsync = promisify(exec)
        const { stdout, stderr } = await execAsync(params.command, {
          cwd: context.cwd,
          timeout: 120_000,
        })

        return {
          content: [
            {
              type: 'text',
              text: stdout + (stderr ? `\nstderr:\n${stderr}` : ''),
            },
          ],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '命令执行失败'
        return {
          content: [{ type: 'text', text: `命令执行失败：${message}` }],
        }
      }
    },
  }
}

/**
 * 创建带路径校验的文件写入工具，替代原生 write。
 *
 * 路径校验拒绝时直接返回原因，不产生任何文件系统副作用。
 *
 * @param context - 运行上下文。
 * @returns 文件写入工具定义。
 */
export function createWriteFileTool(
  context: ProtectedToolContext,
): YuanxiaoToolDefinition {
  return {
    name: PROTECTED_TOOL_NAMES.write,
    label: '写入文件',
    description:
      '创建或覆盖文件。父目录不存在时会自动创建。不能写入 Agent 灵魂、共享用户画像或 Skill 等受保护文件，这些内容请使用 update_soul 或 update_user_profile 工具。',
    promptSnippet: `${PROTECTED_TOOL_NAMES.write}(path: string, content: string) → 写入文件`,
    promptGuidelines: [
      '不能写入 Agent 灵魂（soul.md）或用户画像（user.md），请使用 update_soul 或 update_user_profile',
      '不能写入 soul.history/ 或 user.history/ 中的历史备份文件',
    ],
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    async execute(
      _toolCallId: string,
      params: { path: string; content: string },
    ) {
      const guard = guardPath(context, params.path, 'write')

      if (guard.reason !== undefined) {
        return { content: [{ type: 'text', text: guard.reason }] }
      }

      await mkdir(dirname(guard.resolvedPath), { recursive: true })
      await writeFile(guard.resolvedPath, params.content, 'utf8')

      return {
        content: [{ type: 'text', text: `已写入 ${guard.resolvedPath}` }],
      }
    },
  }
}

/**
 * 创建带路径校验的文件编辑工具，替代原生 edit。
 *
 * 路径校验拒绝时直接返回原因，不读取也不写入文件。
 *
 * @param context - 运行上下文。
 * @returns 文件编辑工具定义。
 */
export function createEditFileTool(
  context: ProtectedToolContext,
): YuanxiaoToolDefinition {
  return {
    name: PROTECTED_TOOL_NAMES.edit,
    label: '编辑文件',
    description:
      '对现有文件做精确文本替换。每次编辑匹配原始文件中唯一的 oldText，替换为 newText。不能编辑 Agent 灵魂、共享用户画像或 Skill 等受保护文件，这些内容请使用 update_soul 或 update_user_profile 工具。',
    promptSnippet: `${PROTECTED_TOOL_NAMES.edit}(path: string, edits: {oldText, newText}[]) → 编辑文件`,
    promptGuidelines: [
      '不能编辑 Agent 灵魂（soul.md）或用户画像（user.md），请使用 update_soul 或 update_user_profile',
      '不能编辑 soul.history/ 或 user.history/ 中的历史备份文件',
      'oldText 必须在文件中唯一存在，且不同的 edits 不得重叠',
    ],
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string', minLength: 1 },
              newText: { type: 'string' },
            },
            required: ['oldText', 'newText'],
            additionalProperties: false,
          },
          minItems: 1,
        },
      },
      required: ['path', 'edits'],
      additionalProperties: false,
    },
    async execute(
      _toolCallId: string,
      params: {
        path: string
        edits: Array<{ oldText: string; newText: string }>
      },
    ) {
      const guard = guardPath(context, params.path, 'edit')

      if (guard.reason !== undefined) {
        return { content: [{ type: 'text', text: guard.reason }] }
      }

      const original = await readFile(guard.resolvedPath, 'utf8')
      let result = original

      for (const edit of params.edits) {
        const occurrences = result.split(edit.oldText).length - 1

        if (occurrences === 0) {
          return {
            content: [
              {
                type: 'text',
                text: '编辑失败：在文件中找不到要替换的文本。',
              },
            ],
          }
        }

        if (occurrences > 1) {
          return {
            content: [
              {
                type: 'text',
                text: `编辑失败：要替换的文本在文件中出现了 ${occurrences} 次，oldText 必须在文件中唯一。`,
              },
            ],
          }
        }

        result = result.replace(edit.oldText, edit.newText)
      }

      await writeFile(guard.resolvedPath, result, 'utf8')

      return {
        content: [{ type: 'text', text: `已编辑 ${guard.resolvedPath}` }],
      }
    },
  }
}

/**
 * 创建带路径校验的文件读取工具，替代原生 read。
 *
 * 复用 Pi SDK 原生 read 实现（保留图片、offset/limit 和截断能力），
 * 只在执行前插入路径校验；被拒绝时不读取文件内容。
 *
 * @param context - 运行上下文。
 * @param createNativeReadToolDefinition - 原生 read 工具定义工厂。
 * @returns 文件读取工具定义（Pi SDK 原生形状，参数为 TypeBox schema）。
 */
export function createReadFileTool(
  context: ProtectedToolContext,
  createNativeReadToolDefinition: (cwd: string) => ToolDefinition,
): ToolDefinition {
  const native = createNativeReadToolDefinition(context.cwd)

  return {
    ...native,
    name: PROTECTED_TOOL_NAMES.read,
    label: '读取文件',
    promptSnippet: `${PROTECTED_TOOL_NAMES.read}(path: string) → 读取文件内容`,
    promptGuidelines: [
      '不能读取 Agent 灵魂（soul.md）或用户画像（user.md）等受保护文件',
      '读取文件请使用此工具，不要用命令行的 cat 或 sed',
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const guard = guardPath(
        context,
        (params as { path: string }).path,
        'read',
      )

      if (guard.reason !== undefined) {
        return {
          content: [{ type: 'text', text: guard.reason }],
          details: undefined,
        }
      }

      return native.execute(toolCallId, params, signal, onUpdate, ctx)
    },
  }
}

/**
 * 把元宵自定义工具定义适配成 Pi SDK 的 `ToolDefinition`。
 *
 * 这是整个接线中唯一的类型窄化边界：元宵工具用 JSON Schema 字面量描述
 * 参数、并采用简化的两参数 `execute`，与 SDK 要求的 TypeBox schema 和
 * 五参数签名在类型上不同构，但运行时兼容（SDK 不校验 parameters，多余的
 * 形参由 JS 调用约定忽略）。把断言收敛在这一处，接线代码本身保持类型安全，
 * 从而不会再掩盖 `excludeTools` 这类配置名写错的问题。
 *
 * @param tools - 元宵自定义工具定义列表。
 * @returns 可直接传给 `createAgentSession` 的 customTools。
 *
 * 接受 `unknown[]` 以同时处理 YuanxiaoToolDefinition、profile tools 和
 * 内联工具定义——它们运行时形状一致。
 */
export function toSdkCustomTools(tools: unknown[]): ToolDefinition[] {
  return tools as unknown as ToolDefinition[]
}

/**
 * 创建接管原生危险工具的全部受保护工具。
 *
 * @param context - 运行上下文。
 * @param createNativeReadToolDefinition - 原生 read 工具定义工厂。
 * @returns 受保护的读取、命令执行、写入和编辑工具。
 */
export function createProtectedTools(
  context: ProtectedToolContext,
  createNativeReadToolDefinition: (cwd: string) => ToolDefinition,
): ToolDefinition[] {
  return [
    createReadFileTool(context, createNativeReadToolDefinition),
    ...toSdkCustomTools([
      createRunCommandTool(context),
      createWriteFileTool(context),
      createEditFileTool(context),
    ]),
  ]
}
