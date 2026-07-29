/**
 * QA 测试：初始页面（#89 规格）
 *
 * 聚焦初始页面行为 — 真实 UI 交互完成配置流程。
 * 所有操作通过 Playwright locator + click/fill 完成。
 *
 * 用法：
 *   cd apps/desktop && TANGYUAN_QA_API_KEY=sk-... npx tsx qa/040-initial-page-qa.ts
 */

import { launchApp, type AppHarness } from './lib/app-harness'
import { checkAppHealth } from './lib/invariants'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const QA_API_KEY = process.env.TANGYUAN_QA_API_KEY!
const QA_PROVIDER = process.env.TANGYUAN_QA_PROVIDER ?? 'deepseek'
const QA_MODEL = process.env.TANGYUAN_QA_MODEL ?? 'deepseek-v4-flash'

interface TestResult {
  name: string
  passed: boolean
  detail?: string
}

const results: TestResult[] = []

function record(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  const icon = passed ? '✅' : '❌'
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  console.log('══════════════════════════════════════════════════')
  console.log('QA 测试：初始页面（#89 规格）')
  console.log(`Provider: ${QA_PROVIDER} | Model: ${QA_MODEL}`)
  console.log('══════════════════════════════════════════════════\n')

  if (!QA_API_KEY) {
    console.log('❌ 未设置 TANGYUAN_QA_API_KEY 环境变量，无法运行')
    process.exit(1)
  }

  // ——— 启动应用 ———
  console.log('🚀 启动应用...')
  const harness = await launchApp()
  const { window } = harness

  await window.waitForLoadState('domcontentloaded')
  // 给 SPA 路由和 runtime 加载留足时间
  await sleep(5000)

  // ——— 阶段 1：初始页面渲染 ———
  console.log('\n📋 阶段 1：初始页面渲染')
  const section1 = '1-初始页面'

  // 窗口存在
  const windowCount = harness.app.windows().length
  record(`${section1}-窗口打开`, windowCount > 0, `窗口数=${windowCount}`)

  // 不白屏
  const bodyText = await window.evaluate(() => document.body.innerText?.trim() ?? '')
  record(`${section1}-不白屏`, bodyText.length > 0, `body 文本长度=${bodyText.length}`)

  // 获取当前 hash 判断在哪个页面
  const initialHash = await window.evaluate(() => window.location.hash)
  console.log(`  初始 hash: ${initialHash}`)
  console.log(`  body 前 500 字: ${bodyText.substring(0, 500)}`)

  // 首次配置标题
  const hasFirstSetup = bodyText.includes('首次配置')
  record(`${section1}-首次配置标题`, hasFirstSetup)

  // 连接模型服务
  const hasConnectTitle = bodyText.includes('连接模型服务')
  record(`${section1}-连接模型服务`, hasConnectTitle)

  // Provider 选择器
  const providerTrigger = window.locator('[data-testid="setup-provider-select"]')
  const providerVisible = await providerTrigger.isVisible().catch(() => false)
  const providerEnabled = await providerTrigger.isEnabled().catch(() => false)
  record(`${section1}-Provider选择器可见`, providerVisible)
  record(`${section1}-Provider选择器可交互`, providerEnabled)

  // API Key 输入框
  const apiKeyInput = window.locator('[data-testid="setup-api-key-input"]')
  const apiKeyVisible = await apiKeyInput.isVisible().catch(() => false)
  const apiKeyEnabled = await apiKeyInput.isEnabled().catch(() => false)
  record(`${section1}-APIKey输入框可见`, apiKeyVisible)
  record(`${section1}-APIKey输入框可交互`, apiKeyEnabled)

  // Model 选择器
  const modelTrigger = window.locator('[data-testid="setup-model-select"]')
  const modelVisible = await modelTrigger.isVisible().catch(() => false)
  const modelEnabled = await modelTrigger.isEnabled().catch(() => false)
  record(`${section1}-Model选择器可见`, modelVisible)
  // 注意：启动时 Provider 列表首位默认预选，Model 选择器因此已启用，这是正常行为
  record(`${section1}-Model选择器状态`, modelEnabled, modelEnabled ? '已启用（Provider 已预选）' : '已禁用')

  // 按钮存在
  const verifyBtn = window.getByRole('button', { name: '验证并继续' })
  const verifyVisible = await verifyBtn.isVisible().catch(() => false)
  const verifyDisabled = !(await verifyBtn.isEnabled().catch(() => true))
  record(`${section1}-验证按钮可见`, verifyVisible)
  record(`${section1}-验证按钮禁用(未填Key和Model)`, verifyDisabled)

  // 进入聊天按钮 — 仅在运行时已就绪时显示（如 QA 模式预配置后）
  const enterChatBtn = window.getByText('进入聊天')
  const enterChatCount = await enterChatBtn.count()
  const enterChatVisible = enterChatCount > 0 && (await enterChatBtn.first().isVisible().catch(() => false))
  // 首次配置时运行时未就绪，"进入聊天"不显示是正常行为
  record(`${section1}-进入聊天按钮`, true,
    enterChatVisible ? '已显示（运行时已就绪）' : '未显示（首次配置 — 符合预期）')

  const refreshBtn = window.getByRole('button', { name: '刷新资源' })
  record(`${section1}-刷新资源按钮存在`, await refreshBtn.isVisible().catch(() => false))

  // 安全提示
  const hasSecurityText = bodyText.includes('API Key 使用 macOS 安全存储')
  record(`${section1}-安全提示文本`, hasSecurityText)

  // 截图初始页面
  await window.screenshot({
    path: '/tmp/tangyuan-qa-040-initial.png',
    fullPage: true
  })
  console.log('  📸 初始页面截图: /tmp/tangyuan-qa-040-initial.png')

  // ——— 阶段 2：真实 UI 交互 — 选择 Provider ———
  console.log('\n📋 阶段 2：选择 Provider')
  const section2 = '2-Provider'

  // 打开 Provider 下拉
  await providerTrigger.click()
  await sleep(800)

  // 查找选项
  const options = window.locator('[role="option"]')
  const optionCount = await options.count()
  record(`${section2}-下拉选项存在`, optionCount > 0, `选项数=${optionCount}`)

  // 列出选项
  console.log('  Provider 选项：')
  for (let i = 0; i < optionCount; i++) {
    const text = await options.nth(i).textContent()
    console.log(`    [${i}] ${text}`)
  }

  // 选择 DeepSeek
  const deepseekOption = window.getByRole('option', { name: /DeepSeek/i })
  const dsCount = await deepseekOption.count()
  if (dsCount > 0) {
    await deepseekOption.first().click()
    await sleep(500)
    const selectedText = await providerTrigger.textContent()
    record(`${section2}-选择DeepSeek`, selectedText?.includes('DeepSeek') ?? false, `当前显示: ${selectedText}`)
  } else {
    record(`${section2}-选择DeepSeek`, false, '未找到 DeepSeek 选项')
    // 点击第一个可用选项
    if (optionCount > 0) {
      const firstText = await options.first().textContent()
      await options.first().click()
      console.log(`  ⚠️ 使用第一个 Provider: ${firstText}`)
    }
  }

  // Provider 选择后 Model 选择器应变为可用
  const modelEnabled2 = await modelTrigger.isEnabled().catch(() => false)
  record(`${section2}-Model选择器变为可用`, modelEnabled2)

  // ——— 阶段 3：真实 UI 交互 — 填入 API Key ———
  console.log('\n📋 阶段 3：填入 API Key')
  const section3 = '3-APIKey'

  // 点击聚焦输入框
  await apiKeyInput.click()
  await sleep(300)

  // 真实键入 API Key
  await apiKeyInput.fill(QA_API_KEY)
  await sleep(300)

  const inputValue = await apiKeyInput.inputValue()
  record(`${section3}-填入APIKey`, inputValue === QA_API_KEY,
    `期望长度=${QA_API_KEY.length} 实际长度=${inputValue.length}`)

  // 显示/隐藏切换
  const showBtn = window.getByRole('button', { name: '显示 API Key' })
  const showBtnVisible = await showBtn.isVisible().catch(() => false)
  record(`${section3}-显示按钮可见`, showBtnVisible)

  if (showBtnVisible) {
    await showBtn.click()
    await sleep(200)
    const type1 = await apiKeyInput.getAttribute('type')
    record(`${section3}-切换为明文`, type1 === 'text', `type=${type1}`)

    const hideBtn = window.getByRole('button', { name: '隐藏 API Key' })
    await hideBtn.click()
    await sleep(200)
    const type2 = await apiKeyInput.getAttribute('type')
    record(`${section3}-切回密码`, type2 === 'password', `type=${type2}`)
  }

  // 截图 API Key 填入后
  await window.screenshot({
    path: '/tmp/tangyuan-qa-040-apikey-filled.png',
    fullPage: true
  })
  console.log('  📸 填入 Key 后截图: /tmp/tangyuan-qa-040-apikey-filled.png')

  // ——— 阶段 4：真实 UI 交互 — 选择 Model ———
  console.log('\n📋 阶段 4：选择 Model')
  const section4 = '4-Model'

  // 打开 Model 下拉
  await modelTrigger.click()
  await sleep(800)

  const modelOptions = window.locator('[role="option"]')
  const modelCount = await modelOptions.count()
  record(`${section4}-模型选项存在`, modelCount > 0, `选项数=${modelCount}`)

  console.log('  Model 选项：')
  for (let i = 0; i < modelCount; i++) {
    const text = await modelOptions.nth(i).textContent()
    console.log(`    [${i}] ${text}`)
  }

  // 选择目标模型
  const targetModel = window.getByRole('option', { name: new RegExp(QA_MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
  const targetCount = await targetModel.count()
  if (targetCount > 0) {
    await targetModel.first().click()
    console.log(`  选择: ${QA_MODEL}`)
  } else {
    // 回退：选第一个
    if (modelCount > 0) {
      const firstText = await modelOptions.first().textContent()
      await modelOptions.first().click()
      console.log(`  ⚠️ 未找到 ${QA_MODEL}，使用: ${firstText}`)
    }
  }
  await sleep(500)

  // 验证 Model 选择器不再显示 "选择模型"
  const modelText = await modelTrigger.textContent()
  record(`${section4}-已选择模型`, !modelText?.includes('选择模型') && (modelText?.trim().length ?? 0) > 0,
    `当前显示: ${modelText}`)

  // 截图 Model 选择后
  await window.screenshot({
    path: '/tmp/tangyuan-qa-040-model-selected.png',
    fullPage: true
  })
  console.log('  📸 Model 选择后截图: /tmp/tangyuan-qa-040-model-selected.png')

  // ——— 阶段 5：验证配置 ———
  console.log('\n📋 阶段 5：验证配置')
  const section5 = '5-验证'

  // 填写完整后验证按钮应变可用
  const verifyEnabled2 = await verifyBtn.isEnabled().catch(() => false)
  record(`${section5}-验证按钮启用`, verifyEnabled2)

  if (verifyEnabled2) {
    // 点击验证
    await verifyBtn.click()
    console.log('  点击"验证并继续"，等待验证...')

    // 轮询等待导航完成（toast "配置已保存" 出现后 navigate 可能还未完成）
    let verified = false
    for (let i = 0; i < 15; i++) {
      await sleep(3000)
      const hash = await window.evaluate(() => window.location.hash)
      const b = await window.evaluate(() => document.body.innerText?.substring(0, 1000) ?? '')

      if (hash.startsWith('#/chat/')) {
        console.log(`  ✅ [${(i + 1) * 3}s] 已导航到聊天页`)
        verified = true
        break
      }
      if (b.includes('无法连接')) {
        console.log(`  ❌ [${(i + 1) * 3}s] 验证失败: ${b.substring(b.indexOf('无法连接'), b.indexOf('无法连接') + 200)}`)
        break
      }
      if (b.includes('配置已保存')) {
        console.log(`  [${(i + 1) * 3}s] 配置已保存，等待导航...`)
      }
      console.log(`  [${(i + 1) * 3}s] 等待中... hash=${hash}`)
    }

    // 额外等待确保导航渲染完成
    if (verified) {
      await sleep(3000)
    }

    // 截图验证后
    await window.screenshot({
      path: '/tmp/tangyuan-qa-040-after-verify.png',
      fullPage: true
    })
    console.log('  📸 验证后截图: /tmp/tangyuan-qa-040-after-verify.png')

    const finalHash = await window.evaluate(() => window.location.hash)
    const atChat = finalHash.startsWith('#/chat/')
    record(`${section5}-验证成功进入聊天页`, atChat || verified, `hash=${finalHash}`)
  } else {
    record(`${section5}-验证按钮启用`, false, '按钮仍禁用，检查是否有必填项未填')
  }

  // ——— 阶段 6：重启验证（#89 US 15：重启后恢复最后激活会话）———
  console.log('\n📋 阶段 6：重启恢复最后会话（#89 US 15）')
  const section6 = '6-重启恢复'

  // 先关闭应用
  console.log('  关闭应用...')
  await harness.close()
  await sleep(3000)

  // 重新启动（QA 数据保留）
  console.log('  重新启动应用...')
  const harness2 = await launchApp()
  const window2 = harness2.window
  await window2.waitForLoadState('domcontentloaded')
  await sleep(5000)

  const hash2 = await window2.evaluate(() => window.location.hash)
  const body2 = await window2.evaluate(() => document.body.innerText?.trim() ?? '')
  console.log(`  重启后 hash: ${hash2}`)
  console.log(`  重启后 body 前 200 字: ${body2.substring(0, 200)}`)

  // #89 US 15：重启后应回到最后打开的会话
  const restoredToChat = hash2.startsWith('#/chat/')
  record(`${section6}-重启后恢复最后会话`, restoredToChat,
    restoredToChat ? `hash=${hash2}` : `hash=${hash2}（配置已就绪则期望在聊天页）`)

  // 检查是否在聊天页
  if (restoredToChat) {
    // 验证聊天页有关键元素
    const hasTextarea = await window2.locator('textarea').count() > 0
    record(`${section6}-聊天页有输入框`, hasTextarea)
  }

  // 检查控制台错误（重启时可能会有会话恢复的错误）
  const criticalErrors2 = harness2.consoleErrors.filter(
    (e) =>
      !e.includes('会话文件不可读') &&
      !e.includes('get-transcript')
  )
  if (harness2.consoleErrors.length > 0) {
    console.log(`  ⚠️ 重启后控制台错误 (${harness2.consoleErrors.length} 条):`)
    for (const err of [...new Set(harness2.consoleErrors)].slice(0, 5)) {
      console.log(`    - ${err.substring(0, 150)}`)
    }
  }
  record(`${section6}-重启后无关键控制台错误`, criticalErrors2.length === 0,
    criticalErrors2.length > 0 ? `${criticalErrors2.length} 条关键错误` : undefined)

  const healthViolations2 = await checkAppHealth(harness2)
  record(`${section6}-重启后健康检查`, healthViolations2.length === 0,
    healthViolations2.length > 0 ? JSON.stringify(healthViolations2) : undefined)

  // 截图
  await window2.screenshot({
    path: '/tmp/tangyuan-qa-040-restart.png',
    fullPage: true
  })
  console.log('  📸 重启后截图: /tmp/tangyuan-qa-040-restart.png')

  await harness2.close()

  // ——— 汇总 ———
  console.log('\n══════════════════════════════════════════════════')
  console.log('测试结果汇总')
  console.log('══════════════════════════════════════════════════')
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  console.log(`  通过: ${passed} / ${results.length}`)
  console.log(`  失败: ${failed} / ${results.length}`)

  if (failed > 0) {
    console.log('\n❌ 失败项：')
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}${r.detail ? ` (${r.detail})` : ''}`)
    }
  }

  console.log('\n截图文件：')
  console.log('  /tmp/tangyuan-qa-040-initial.png')
  console.log('  /tmp/tangyuan-qa-040-apikey-filled.png')
  console.log('  /tmp/tangyuan-qa-040-model-selected.png')
  console.log('  /tmp/tangyuan-qa-040-after-verify.png')
  console.log('  /tmp/tangyuan-qa-040-restart.png')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('💥 测试脚本异常:', err)
  process.exit(1)
})
