/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const appRoot = resolve(scriptDir, '..')
const repoRoot = resolve(appRoot, '../..')

/**
 * 运行桌面端 macOS 打包冒烟测试。
 *
 * @returns 无返回值。
 * @throws 当当前平台不是 macOS、打包失败、应用启动失败或页面未通过自检时抛出错误。
 */
async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('packaged smoke test 当前只支持 macOS，因为 issue #10 要验证 .app 包。')
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'tangyuan-packaged-smoke-'))
  const resultPath = join(tempRoot, 'result.json')
  const homePath = join(tempRoot, 'home')

  try {
    await runCommand('pnpm', ['build:mac:dir'], appRoot)

    const appBundlePath = findPackagedAppBundle()
    const executablePath = resolveMacExecutablePath(appBundlePath)

    await runPackagedApp(executablePath, resultPath, {
      ...process.env,
      HOME: homePath,
      TANGYUAN_DESKTOP_SMOKE_TEST_RESULT_PATH: resultPath
    })

    const result = JSON.parse(await readFile(resultPath, 'utf8'))
    const agentHomePath = join(homePath, '.tangyuan', 'agents', 'tangyuan')

    if (!result.ok) {
      throw new Error(`打包应用自检失败：${JSON.stringify(result)}`)
    }

    if (!existsSync(agentHomePath)) {
      throw new Error(`打包应用没有创建默认 Agent Home：${agentHomePath}`)
    }

    console.log(
      [
        'Packaged smoke test passed.',
        `App bundle: ${appBundlePath}`,
        `Page: ${result.pageKind}`,
        `Runtime: ${result.runtimeStatus}`,
        `Agent Home: ${agentHomePath}`
      ].join('\n')
    )
  } finally {
    if (process.env['TANGYUAN_KEEP_SMOKE_TEST_TEMP'] !== '1') {
      await rm(tempRoot, { recursive: true, force: true })
    }
  }
}

/**
 * 执行一个子进程命令并等待其退出。
 *
 * @param command - 需要执行的命令名。
 * @param args - 传给命令的参数列表。
 * @param cwd - 子进程工作目录。
 * @returns 无返回值。
 * @throws 当命令退出码不是 0 或被信号中断时抛出错误。
 */
async function runCommand(command, args, cwd) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env
    })

    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      rejectPromise(
        new Error(`${command} ${args.join(' ')} failed with ${signal ?? `exit code ${code}`}`)
      )
    })
  })
}

/**
 * 查找 electron-builder 产出的 macOS `.app` 包。
 *
 * @returns `.app` 包的绝对路径。
 * @throws 当没有找到可用 `.app` 包时抛出错误。
 */
function findPackagedAppBundle() {
  const candidates = [
    join(appRoot, 'dist', 'mac-arm64', 'apps-desktop.app'),
    join(appRoot, 'dist', 'mac', 'apps-desktop.app'),
    join(appRoot, 'dist', 'mac-universal', 'apps-desktop.app')
  ]
  const appBundlePath = candidates.find((candidate) => existsSync(candidate))

  if (!appBundlePath) {
    throw new Error(`没有找到打包后的 .app。已检查：${candidates.join(', ')}`)
  }

  return appBundlePath
}

/**
 * 解析 macOS `.app` 包内部的可执行文件路径。
 *
 * @param appBundlePath - electron-builder 产出的 `.app` 包路径。
 * @returns 可直接启动的应用二进制文件路径。
 * @throws 当可执行文件不存在时抛出错误。
 */
function resolveMacExecutablePath(appBundlePath) {
  const executableName = basename(appBundlePath, '.app')
  const executablePath = join(appBundlePath, 'Contents', 'MacOS', executableName)

  if (!existsSync(executablePath)) {
    throw new Error(`没有找到 .app 内部可执行文件：${executablePath}`)
  }

  return executablePath
}

/**
 * 启动打包后的应用并等待 Main 进程 smoke-test hook 退出。
 *
 * @param executablePath - `.app` 内部的可执行文件路径。
 * @param resultPath - Main 进程 smoke-test hook 写入的结果文件路径。
 * @param env - 传给应用进程的环境变量。
 * @returns 无返回值。
 * @throws 当应用进程非 0 退出或长时间不退出时抛出错误。
 */
async function runPackagedApp(executablePath, resultPath, env) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executablePath, [], {
      cwd: repoRoot,
      stdio: 'inherit',
      env
    })
    const timeout = setTimeout(async () => {
      child.kill('SIGTERM')
      const progress = await readSmokeTestProgress(resultPath)
      rejectPromise(new Error(`打包应用启动后 30 秒内没有完成自检。当前阶段：${progress}`))
    }, 30_000)

    child.on('error', (error) => {
      clearTimeout(timeout)
      rejectPromise(error)
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timeout)

      if (code === 0) {
        resolvePromise()
        return
      }

      rejectPromise(new Error(`打包应用自检进程失败：${signal ?? `exit code ${code}`}`))
    })
  })
}

/**
 * 读取 smoke-test hook 已写入的阶段信息。
 *
 * @param resultPath - Main 进程 smoke-test hook 写入的结果文件路径。
 * @returns 当前阶段文本；文件不存在或无法解析时返回 fallback 文本。
 * @throws 此方法不会主动抛出错误。
 */
async function readSmokeTestProgress(resultPath) {
  try {
    const result = JSON.parse(await readFile(resultPath, 'utf8'))

    return result.phase ?? JSON.stringify(result)
  } catch {
    return '未写入结果文件'
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
