import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer process boundary', () => {
  it('does not import Electron, Node.js, Pi SDK, or agent-runtime modules directly', () => {
    const rendererFiles = collectTypeScriptFiles(join(process.cwd(), 'src/renderer/src'))
    const bannedImports = [
      'electron',
      'node:',
      '@tangyuan/agent-runtime',
      '@earendil-works/pi-coding-agent',
      '@pi/agent-sdk',
      'pi-agent-sdk'
    ]

    for (const filePath of rendererFiles) {
      const source = readFileSync(filePath, 'utf8')

      for (const bannedImport of bannedImports) {
        expect(source, `${filePath} imports ${bannedImport}`).not.toContain(`from '${bannedImport}`)
        expect(source, `${filePath} imports ${bannedImport}`).not.toContain(`from "${bannedImport}`)
      }
    }
  })
})

/**
 * 递归收集目录里的 TypeScript 源文件。
 *
 * @param directory - 需要扫描的目录。
 * @returns 所有 `.ts` 和 `.tsx` 文件的绝对路径。
 * @throws 当目录不存在或无法读取时，透传 Node.js 文件系统错误。
 */
function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      return collectTypeScriptFiles(entryPath)
    }

    return (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.includes('.test.')
      ? [entryPath]
      : []
  })
}
