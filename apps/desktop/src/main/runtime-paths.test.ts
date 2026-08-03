import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createQaRuntimePaths } from './runtime-paths'

describe('createQaRuntimePaths', () => {
  it('将 QA Agent Home 相对 fsRoot 展开一次，不重复 .yuanxiao-qa-root', () => {
    const homePath = '/Users/tester'
    const paths = createQaRuntimePaths(homePath)

    expect(paths).toEqual({
      fsRoot: join(homePath, '.yuanxiao-qa-root'),
      userDataPath: join(homePath, '.yuanxiao-qa-root', '.yuanxiao'),
      agentHomePath: '~/.yuanxiao/agents/yuanxiao',
    })
  })
})
