import { execFileSync } from 'node:child_process'
import type { InvariantViolation } from './invariants'

/**
 * 在 GitHub 上按不变量 code 搜索是否已有同类 open issue。
 *
 * 去重键为 `[QA:<code>]` 标记，写在 issue 标题里，保证同类问题只提一次。
 *
 * @param code - 不变量 code。
 * @returns 已存在的 issue 编号；不存在返回 null。
 */
export function findExistingIssue(code: string): number | null {
  const marker = `[QA:${code}]`
  try {
    const out = execFileSync(
      'gh',
      ['issue', 'list', '--state', 'open', '--search', marker, '--json', 'number,title'],
      { encoding: 'utf8' }
    )
    const list = JSON.parse(out) as Array<{ number: number; title: string }>
    const hit = list.find((i) => i.title.includes(marker))
    return hit ? hit.number : null
  } catch {
    return null
  }
}

/**
 * 为一条技术不变量违反创建 GitHub issue（若无同类 open issue）。
 *
 * @param violation - 违反详情。
 * @param context - 复现上下文（Hermes 选择的场景描述、发送内容等）。
 * @returns 新建的 issue URL；若已存在同类 issue 则返回该编号说明。
 */
export function fileIssueForViolation(
  violation: InvariantViolation,
  context: { scenario: string; sentContent?: string }
): string {
  const existing = findExistingIssue(violation.code)
  if (existing !== null) {
    return `已存在同类 open issue #${existing}（QA:${violation.code}），跳过。`
  }

  const title = `[QA:${violation.code}] ${violation.message}`
  const body = [
    '## 现象',
    '',
    violation.message,
    '',
    '## 测试场景',
    '',
    `- 场景：${context.scenario}`,
    context.sentContent ? `- 发送内容：${context.sentContent}` : '',
    '',
    '## 证据',
    '',
    '```',
    violation.detail ?? '(无附加证据)',
    '```',
    '',
    '## 说明',
    '',
    '本 issue 由自动化 QA（真实 Electron + 真实模型对话）在检测到技术不变量违反时创建。',
    '判据仅在技术层面（崩溃/报错/无回复/超时/非法状态），不涉及模型回复内容质量。',
    `去重键：\`[QA:${violation.code}]\`（同类问题只提一次）。`
  ]
    .filter((l) => l !== '')
    .join('\n')

  const url = execFileSync(
    'gh',
    ['issue', 'create', '--title', title, '--label', '待评估', '--label', 'bug', '--body', body],
    { encoding: 'utf8' }
  ).trim()

  return url
}
