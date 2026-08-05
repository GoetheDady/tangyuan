import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  AgentEvent,
  ApproveBashRequest,
  BashApprovalRequest,
} from '@yuanxiao/contracts'

interface PersistedCommandPermission {
  agentId: string
  cwd: string
  command: string
  createdAt: string
}

interface PersistedCommandPermissions {
  schemaVersion: 1
  permissions: PersistedCommandPermission[]
}

interface PendingCommandApproval {
  request: BashApprovalRequest
  resolve: (result: { approved: boolean }) => void
}

export interface CommandPermissionModuleDependencies {
  emit(event: AgentEvent): void
  now(): string
  /** 生产环境持久化路径；未提供时使用进程内存，供 Runtime seam 测试。 */
  filePath?: string
}

/**
 * Agent 命令许可 module：统一持有待审批状态、长期许可匹配与持久化。
 * 长期许可严格按 Agent、cwd 与完整命令匹配；高风险命令始终逐次审批。
 */
export class CommandPermissionModule {
  private readonly emit: (event: AgentEvent) => void
  private readonly now: () => string
  private readonly filePath: string | undefined
  private readonly pending = new Map<string, PendingCommandApproval>()
  private permissions: PersistedCommandPermission[] | null = null
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(dependencies: CommandPermissionModuleDependencies) {
    this.emit = dependencies.emit
    this.now = dependencies.now
    this.filePath = dependencies.filePath
  }

  /** 请求执行命令；命中长期许可时直接批准，否则登记待审批请求。 */
  async request(
    request: BashApprovalRequest,
  ): Promise<{ approved: boolean }> {
    if (request.riskLevel === 'normal') {
      return { approved: true }
    }

    if (await this.isAllowed(request)) {
      return { approved: true }
    }

    return new Promise<{ approved: boolean }>((resolve) => {
      this.pending.set(request.approvalId, { request, resolve })
      this.emit({
        type: 'approval-required',
        agentId: request.agentId,
        sessionId: request.sessionId,
        approval: request,
        occurredAt: this.now(),
      })
    })
  }

  /** 批准一次命令；remember 仅对非高风险命令写入长期许可。 */
  async approve(request: ApproveBashRequest): Promise<void> {
    const pending = this.requirePending(request.approvalId)
    if (request.remember && pending.request.riskLevel !== 'high') {
      await this.grant(pending.request)
    }
    this.resolve(request.approvalId, 'approved')
  }

  reject(approvalId: string): void {
    this.resolve(approvalId, 'rejected')
  }

  list(): BashApprovalRequest[] {
    return [...this.pending.values()].map((entry) => entry.request)
  }

  rejectSession(sessionId: string): void {
    for (const [approvalId, entry] of this.pending) {
      if (entry.request.sessionId === sessionId) {
        this.resolve(approvalId, 'rejected')
      }
    }
  }

  rejectAll(): void {
    for (const approvalId of [...this.pending.keys()]) {
      this.resolve(approvalId, 'rejected')
    }
  }

  private async isAllowed(request: BashApprovalRequest): Promise<boolean> {
    if (request.riskLevel === 'high') return false
    const permissions = await this.loadPermissions()
    return permissions.some(
      (permission) =>
        permission.agentId === request.agentId &&
        permission.cwd === request.cwd &&
        permission.command === request.command,
    )
  }

  private async grant(request: BashApprovalRequest): Promise<void> {
    const pending = this.mutationTail.then(async () => {
      const permissions = await this.loadPermissions()
      const exists = permissions.some(
        (permission) =>
          permission.agentId === request.agentId &&
          permission.cwd === request.cwd &&
          permission.command === request.command,
      )
      if (exists) return

      const next = [
        ...permissions,
        {
          agentId: request.agentId,
          cwd: request.cwd,
          command: request.command,
          createdAt: this.now(),
        },
      ]
      await this.writePermissions(next)
      this.permissions = next
    })
    this.mutationTail = pending.catch(() => undefined)
    await pending
  }

  private async loadPermissions(): Promise<PersistedCommandPermission[]> {
    if (this.permissions) return this.permissions
    if (!this.filePath) {
      this.permissions = []
      return this.permissions
    }

    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as {
        schemaVersion?: unknown
        permissions?: unknown
      }
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.permissions)) {
        this.permissions = []
        return this.permissions
      }
      this.permissions = parsed.permissions.filter(
        (item): item is PersistedCommandPermission =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as PersistedCommandPermission).agentId === 'string' &&
          typeof (item as PersistedCommandPermission).cwd === 'string' &&
          typeof (item as PersistedCommandPermission).command === 'string' &&
          typeof (item as PersistedCommandPermission).createdAt === 'string',
      )
      return this.permissions
    } catch {
      this.permissions = []
      return this.permissions
    }
  }

  private async writePermissions(
    permissions: PersistedCommandPermission[],
  ): Promise<void> {
    if (!this.filePath) return
    const payload: PersistedCommandPermissions = {
      schemaVersion: 1,
      permissions,
    }
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.${process.pid}-${Date.now()}.tmp`
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.filePath)
  }

  private requirePending(approvalId: string): PendingCommandApproval {
    const pending = this.pending.get(approvalId)
    if (!pending) {
      throw new Error(`找不到审批请求 ${approvalId}，可能已过期或已被处理。`)
    }
    return pending
  }

  private resolve(
    approvalId: string,
    status: 'approved' | 'rejected',
  ): void {
    const pending = this.requirePending(approvalId)
    this.pending.delete(approvalId)
    this.emit({
      type: 'approval-resolved',
      agentId: pending.request.agentId,
      sessionId: pending.request.sessionId,
      approvalId,
      status,
      occurredAt: this.now(),
    })
    pending.resolve({ approved: status === 'approved' })
  }
}
