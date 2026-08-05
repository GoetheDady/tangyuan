/**
 * 命令风险判定：免审白名单、硬性拦截与三档风险等级。
 *
 * 与 ADR-0039 对应：只读命令默认免审（normal），其余非危险命令默认审批
 * （medium），破坏性命令永远逐次审批（high），硬性拦截命令直接拒绝。
 */
/**
 * 免审白名单中的只读命令；git 白名单仅含只读子命令。
 */
const READONLY_COMMANDS = new Set([
  'cat',
  'cd',
  'cut',
  'date',
  'diff',
  'echo',
  'expr',
  'false',
  'grep',
  'head',
  'id',
  'ls',
  'nl',
  'paste',
  'pwd',
  'rev',
  'seq',
  'stat',
  'tail',
  'tr',
  'true',
  'uname',
  'uniq',
  'wc',
  'which',
  'whoami',
])

const READONLY_GIT_SUBCOMMANDS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'remote',
  'ls-files',
  'tag',
])

const UNSAFE_GIT_FLAGS = new Set([
  '-d',
  '-D',
  '-m',
  '-M',
  '-a',
  '-f',
  '-F',
  '-u',
  '-t',
  '-x',
  '-X',
  '--delete',
  '--remove',
  '--add',
  '--rename',
  '--move',
  '--set-url',
  '--force',
  '--hard',
  '--mixed',
  '--soft',
  '--reset',
  '--clean',
  '--prune',
])

/**
 * 判断命令是否为免审白名单内的只读命令。
 *
 * 含重定向、管道、后台、命令替换或逻辑连接符的命令一律不算只读；
 * git 只读子命令带强制/硬重置参数时也不算。
 */
function isReadonlyCommand(command: string): boolean {
  if (/(>>?|\||&|;|\$\(|`|\n|\r)/.test(command)) return false
  const words = command.trim().split(/\s+/)
  const first = words[0]?.split('/').pop()
  if (!first) return false

  if (READONLY_COMMANDS.has(first)) return true

  if (first === 'git' && words[1]) {
    if (!READONLY_GIT_SUBCOMMANDS.has(words[1])) return false
    if (words.some((word) => UNSAFE_GIT_FLAGS.has(word))) return false
    if (words[1] === 'remote' && words[2] && !words[2].startsWith('-')) {
      return false
    }
    return true
  }

  return false
}

/**
 * 不可绕过的硬性拦截模式：命中即拒绝执行，不进审批流程。
 */
const HARD_BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\brm\b[^|&;]*\s(-rf|-fr|--recursive|--force)[^|&;]*\s\/(\.\/?)?(\s|$|;|&&|\|\|)/,
    reason: '删除根目录',
  },
  { pattern: /\brm\b[^|&;]*--no-preserve-root/, reason: '删除根目录' },
  { pattern: /:\(\s*\)\s*\{\s*:/, reason: 'fork bomb' },
  { pattern: /\bmkfs(\.[a-z0-9]+)?\b/, reason: '格式化文件系统' },
  { pattern: /\bdd\b[^|&;]*\bof=\/dev\/(sd|disk|rdisk)/, reason: '写入块设备' },
  { pattern: /(^|[|&;\s])[^|&;]*>\s*\/dev\/(sd|disk|rdisk)/, reason: '写入块设备' },
  {
    pattern: /(^|[|&;\s])[^|&;]*(>>?)\s*(\/etc\/|~\/\.ssh\/|\$HOME\/\.ssh\/)/,
    reason: '覆盖系统或凭据关键路径',
  },
]

/**
 * 分析 bash 命令的风险等级并生成中文风险说明。
 *
 * 判定顺序：硬性拦截 → 高风险模式 → 中风险模式或不在免审白名单 → 白名单只读。
 *
 * @param command - 待执行的 bash 命令。
 * @returns 面向用户的中文风险说明；`blocked` 存在时命令被硬性拦截，不得执行。
 * @throws 此方法不会主动抛出错误。
 */
export function assessBashRisk(command: string): {
  level: import('@yuanxiao/contracts').BashRiskLevel
  description: string
  blocked?: string
} {
  for (const hard of HARD_BLOCKED_PATTERNS) {
    if (hard.pattern.test(command)) {
      return {
        level: 'high',
        blocked: hard.reason,
        description: `命令被安全策略拦截：${hard.reason}。该操作不可逆且影响系统，Agent 不会执行。`,
      }
    }
  }

  const highRiskPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\brm\s+-rf\b/, label: '递归强制删除' },
    { pattern: /\bsudo\b/, label: '提权操作' },
    { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/, label: '远程脚本直接执行' },
    { pattern: /\bwget\b.*\|\s*(ba)?sh\b/, label: '远程脚本直接执行' },
    { pattern: /\bdd\s+if=/, label: '磁盘直接写入' },
    { pattern: /\bmkfs\b/, label: '格式化文件系统' },
    { pattern: />\s*\/dev\//, label: '设备文件写入' },
    { pattern: /\bchmod\s+777/, label: '危险权限修改' },
    { pattern: /\bpasswd\b/, label: '密码修改' },
    { pattern: /\bgit\s+push\b.*(-f|--force)\b/, label: '强制推送' },
  ]

  const mediumRiskPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\brm\b/, label: '删除文件' },
    { pattern: /\bmv\b/, label: '移动/重命名文件' },
    { pattern: /\bchmod\b/, label: '修改权限' },
    { pattern: /\bchown\b/, label: '修改所有者' },
    { pattern: /\bkill\b/, label: '终止进程' },
    { pattern: /\bpkill\b/, label: '终止进程' },
    { pattern: /\bnpm\s+(install|uninstall)\b/, label: '包管理' },
    { pattern: /\bpip\s+install\b/, label: 'Python 包安装' },
    { pattern: /\bgit\s+push\b/, label: '推送远端' },
  ]

  const highHits = highRiskPatterns
    .filter((p) => p.pattern.test(command))
    .map((p) => p.label)

  const mediumHits = mediumRiskPatterns
    .filter((p) => p.pattern.test(command))
    .map((p) => p.label)

  if (highHits.length > 0) {
    return {
      level: 'high',
      description: `高风险命令：${highHits.join('、')}。命令将以当前 macOS 用户权限执行，可能造成不可逆的系统影响。`,
    }
  }

  if (mediumHits.length > 0 || !isReadonlyCommand(command)) {
    const mediumLabels =
      mediumHits.length > 0
        ? `中风险命令：${mediumHits.join('、')}。`
        : '该命令不在免审白名单内。'
    return {
      level: 'medium',
      description: `${mediumLabels}命令将以当前 macOS 用户权限执行，请确认操作意图。`,
    }
  }

  return {
    level: 'normal',
    description: '只读命令，默认免审执行。',
  }
}

export function describeBashRisk(command: string): string {
  return assessBashRisk(command).description
}