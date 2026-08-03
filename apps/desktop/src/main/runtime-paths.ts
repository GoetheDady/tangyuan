import { join } from 'node:path'

export interface QaRuntimePaths {
  fsRoot: string
  userDataPath: string
  agentHomePath: string
}

/**
 * 计算 QA 模式的隔离目录。agentHomePath 以 fsRoot 为 `~` 展开基准，
 * 因此不能再次包含 `.yuanxiao-qa-root`。
 */
export function createQaRuntimePaths(homePath: string): QaRuntimePaths {
  const fsRoot = join(homePath, '.yuanxiao-qa-root')
  return {
    fsRoot,
    userDataPath: join(fsRoot, '.yuanxiao'),
    agentHomePath: '~/.yuanxiao/agents/yuanxiao',
  }
}
