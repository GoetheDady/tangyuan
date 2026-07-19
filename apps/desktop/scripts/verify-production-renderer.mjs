/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const rendererOutput = join(appRoot, 'out', 'renderer')
const forbiddenValues = [
  '/__fixtures__/base-components',
  'base-components-fixture-v1',
  '基础组件验收夹具'
]
const forbiddenAssetName = 'BaseComponentsFixturePage'

/**
 * 验证普通生产 Renderer 构建没有包含组件验收夹具模块。
 */
async function main() {
  const assetFiles = await collectTextAssets(rendererOutput)

  for (const assetFile of assetFiles) {
    const relativeAssetPath = relative(appRoot, assetFile)

    if (relativeAssetPath.includes(forbiddenAssetName)) {
      throw new Error(`生产 Renderer 构建包含组件验收夹具资产：${relativeAssetPath}`)
    }

    const content = await readFile(assetFile, 'utf8')
    const forbiddenValue = forbiddenValues.find((value) => content.includes(value))

    if (forbiddenValue) {
      throw new Error(
        `生产 Renderer 构建包含组件验收夹具标记 ${JSON.stringify(forbiddenValue)}：${relativeAssetPath}`
      )
    }
  }

  console.log(`Production renderer fixture exclusion passed (${assetFiles.length} assets checked).`)
}

/**
 * 递归收集适合文本扫描的 Renderer 构建资产。
 *
 * @param {string} directory - 当前扫描目录。
 * @returns {Promise<string[]>} 文本资产路径。
 */
async function collectTextAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name)

      if (entry.isDirectory()) {
        return collectTextAssets(entryPath)
      }

      return ['.html', '.js', '.css'].includes(extname(entry.name)) ? [entryPath] : []
    })
  )

  return files.flat()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
