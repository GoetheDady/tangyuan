/**
 * QA 测试：分叉会话功能（issue #89）
 *
 * 测试重点：
 * 1. 从历史用户消息创建分叉会话
 * 2. 分叉后进入新会话，Composer 预填草稿
 * 3. 侧边栏显示分叉会话的父子关系
 * 4. 来源提示显示
 * 5. 归档/删除级联操作
 */

import { launchApp, configureForQa, type AppHarness } from './lib/app-harness'
import { checkAppHealth, checkRuntimeReady, type InvariantViolation } from './lib/invariants'

interface TestResult {
  name: string
  passed: boolean
  violations: InvariantViolation[]
  notes?: string
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runForkSessionTests(): Promise<TestResult[]> {
  const results: TestResult[] = []
  let harness: AppHarness | null = null

  try {
    // 1. 启动应用
    console.log('🚀 启动应用...')
    harness = await launchApp()
    const { window } = harness

    // 2. 配置 QA 模式
    console.log('⚙️  配置 QA 模式...')
    const configResult = await configureForQa(harness)
    if (!configResult.ok) {
      results.push({
        name: 'QA 配置',
        passed: false,
        violations: [],
        notes: `配置失败: ${configResult.reason}`
      })
      return results
    }
    console.log('✅ QA 配置成功')

    // 等待配置生效
    await sleep(2000)

    // 3. 点击"验证并继续"或"进入聊天"
    console.log('🔘 尝试进入聊天界面...')
    const verifyButton = await window.$('button:has-text("验证并继续")')
    const enterChatButton = await window.$('button:has-text("进入聊天")')

    if (verifyButton) {
      console.log('点击"验证并继续"...')
      await verifyButton.click()
      await sleep(5000) // 等待验证完成
    } else if (enterChatButton) {
      console.log('点击"进入聊天"...')
      await enterChatButton.click()
      await sleep(3000)
    }

    // 截图查看当前状态
    await window.screenshot({ path: '/tmp/tangyuan-qa-after-config.png', fullPage: true })

    // 4. 检查是否进入聊天界面
    const chatInput = await window.$('textarea[placeholder*="消息"], textarea[placeholder*="输入"], [contenteditable="true"][role="textbox"]')

    if (!chatInput) {
      // 可能还在配置页面，尝试再次点击
      const buttonNow = await window.$('button:has-text("验证并继续"), button:has-text("进入聊天")')
      if (buttonNow) {
        await buttonNow.click()
        await sleep(5000)
      }
    }

    // 再次检查
    const chatInput2 = await window.$('textarea, [contenteditable="true"]')
    if (!chatInput2) {
      // 获取页面信息用于调试
      const pageInfo = await window.evaluate(() => ({
        title: document.title,
        bodyText: document.body.innerText?.substring(0, 300),
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean)
      }))

      results.push({
        name: '进入聊天界面',
        passed: false,
        violations: [],
        notes: `无法找到聊天输入框。页面标题: ${pageInfo.title}, 按钮: ${pageInfo.buttons.join(', ')}`
      })
      return results
    }

    console.log('✅ 已进入聊天界面')

    // 5. 检查应用健康状态
    console.log('🏥 检查应用健康状态...')
    const healthViolations = await checkAppHealth(harness)
    const runtimeViolations = await checkRuntimeReady(harness)

    results.push({
      name: '应用健康检查',
      passed: healthViolations.length === 0 && runtimeViolations.length === 0,
      violations: [...healthViolations, ...runtimeViolations]
    })

    if (healthViolations.length > 0 || runtimeViolations.length > 0) {
      console.log('❌ 应用健康检查失败，停止测试')
      return results
    }

    // 6. 发送第一条消息
    console.log('💬 发送第一条消息...')
    await chatInput2.fill('你好，这是 QA 测试的第一条消息')
    await window.keyboard.press('Enter')
    console.log('等待回复...')
    await sleep(8000) // 等待模型回复

    // 7. 发送第二条消息
    console.log('💬 发送第二条消息...')
    await chatInput2.fill('今天天气怎么样？')
    await window.keyboard.press('Enter')
    await sleep(8000)

    // 截图查看对话状态
    await window.screenshot({ path: '/tmp/tangyuan-qa-conversation.png', fullPage: true })

    // 8. 测试分叉功能
    console.log('🔀 测试分叉功能...')

    // 查找用户消息 - 尝试多种选择器
    const userMessageSelectors = [
      '[data-role="user"]',
      '[data-message-role="user"]',
      '.message-user',
      '[class*="user-message"]',
      '[class*="UserMessage"]',
      '[data-testid*="user"]'
    ]

    let userMessages: any[] = []
    for (const selector of userMessageSelectors) {
      userMessages = await window.$$(selector)
      if (userMessages.length > 0) {
        console.log(`找到用户消息，选择器: ${selector}, 数量: ${userMessages.length}`)
        break
      }
    }

    if (userMessages.length === 0) {
      // 尝试查找所有消息元素
      const allMessages = await window.$$('[class*="message"], [class*="Message"], article, [role="article"]')
      console.log(`未找到明确的用户消息，共找到 ${allMessages.length} 个消息元素`)

      // 获取页面结构用于调试
      const debugInfo = await window.evaluate(() => {
        const msgs = document.querySelectorAll('[class*="message"], [class*="Message"], article')
        return Array.from(msgs).slice(0, 5).map(m => ({
          tag: m.tagName,
          class: m.className?.toString?.()?.substring(0, 100),
          text: m.textContent?.substring(0, 100)
        }))
      })
      console.log('消息元素调试信息:', JSON.stringify(debugInfo, null, 2))

      results.push({
        name: '查找用户消息',
        passed: false,
        violations: [],
        notes: `未找到用户消息元素，共 ${allMessages.length} 个消息元素`
      })

      // 继续测试其他功能
      await testSidebarAndArchive(window, results)
      return results
    }

    console.log(`✅ 找到 ${userMessages.length} 个用户消息`)

    // 9. 悬停第一个用户消息，查找分叉按钮
    console.log('🖱️  悬停第一个用户消息...')
    await userMessages[0].hover()
    await sleep(1000)

    // 截图查看悬停状态
    await window.screenshot({ path: '/tmp/tangyuan-qa-hover.png', fullPage: true })

    // 查找分叉按钮
    const forkButtonSelectors = [
      'button[aria-label*="fork"]',
      'button[aria-label*="分叉"]',
      'button[title*="fork"]',
      'button[title*="分叉"]',
      '[data-action="fork"]',
      'button:has-text("分叉")',
      'button:has-text("Fork")'
    ]

    let forkButton: any = null
    for (const selector of forkButtonSelectors) {
      forkButton = await window.$(selector)
      if (forkButton) {
        console.log(`找到分叉按钮，选择器: ${selector}`)
        break
      }
    }

    if (!forkButton) {
      // 查找悬停后出现的所有按钮
      const hoverButtons = await window.$$('button:visible')
      console.log(`悬停后可见按钮数: ${hoverButtons.length}`)

      const buttonInfo = await window.evaluate(() => {
        return Array.from(document.querySelectorAll('button')).map(b => ({
          text: b.textContent?.trim(),
          ariaLabel: b.getAttribute('aria-label'),
          title: b.getAttribute('title'),
          visible: b.offsetParent !== null
        })).filter(b => b.visible)
      })
      console.log('可见按钮:', JSON.stringify(buttonInfo, null, 2))

      results.push({
        name: '查找分叉按钮',
        passed: false,
        violations: [],
        notes: '悬停用户消息后未找到分叉按钮'
      })

      // 继续测试其他功能
      await testSidebarAndArchive(window, results)
      return results
    }

    // 10. 点击分叉按钮
    console.log('🖱️  点击分叉按钮...')
    await forkButton.click()
    await sleep(2000)

    // 截图查看分叉后的状态
    await window.screenshot({ path: '/tmp/tangyuan-qa-after-fork.png', fullPage: true })

    // 11. 检查是否创建了新会话
    const sidebarItems = await window.$$('[class*="session"], [class*="Session"], [class*="sidebar"] li, nav li')
    console.log(`侧边栏会话数: ${sidebarItems.length}`)

    results.push({
      name: '分叉会话创建',
      passed: sidebarItems.length > 1,
      violations: [],
      notes: `侧边栏会话数: ${sidebarItems.length}`
    })

    // 12. 检查来源提示
    const sourceIndicator = await window.$('[class*="source"], [class*="origin"], [class*="fork-from"], [class*="Source"], [data-testid*="source"]')
    results.push({
      name: '来源提示显示',
      passed: !!sourceIndicator,
      violations: [],
      notes: sourceIndicator ? '存在来源提示元素' : '未检测到来源提示'
    })

    // 13. 检查 Composer 是否预填草稿
    const composer = await window.$('textarea, [contenteditable="true"]')
    if (composer) {
      const value = await composer.inputValue?.() ?? await composer.textContent ?? ''
      results.push({
        name: 'Composer 预填草稿',
        passed: value.length > 0,
        violations: [],
        notes: value ? `预填内容: "${value.substring(0, 50)}..."` : '无预填内容'
      })
    }

    // 14. 测试归档功能
    await testSidebarAndArchive(window, results)

    // 15. 最终健康检查
    console.log('🏥 最终健康检查...')
    const finalHealth = await checkAppHealth(harness)
    results.push({
      name: '最终健康检查',
      passed: finalHealth.length === 0,
      violations: finalHealth
    })

  } catch (error) {
    console.error('测试异常:', error)
    results.push({
      name: '测试执行异常',
      passed: false,
      violations: [],
      notes: String(error)
    })
  } finally {
    if (harness) {
      await harness.close()
    }
  }

  return results
}

async function testSidebarAndArchive(window: AppHarness['window'], results: TestResult[]) {
  console.log('📦 测试侧边栏和归档功能...')

  // 查找会话项
  const sessionItem = await window.$('[class*="session"], [class*="Session"], [class*="sidebar"] li')

  if (sessionItem) {
    // 右键点击查看上下文菜单
    await sessionItem.click({ button: 'right' })
    await sleep(500)

    // 截图查看上下文菜单
    await window.screenshot({ path: '/tmp/tangyuan-qa-context-menu.png', fullPage: true })

    // 查找归档选项
    const archiveSelectors = [
      'button:has-text("归档")',
      '[data-action="archive"]',
      'menuitem:has-text("归档")',
      'li:has-text("归档")'
    ]

    let archiveButton: any = null
    for (const selector of archiveSelectors) {
      archiveButton = await window.$(selector)
      if (archiveButton) break
    }

    results.push({
      name: '归档功能存在',
      passed: !!archiveButton,
      violations: [],
      notes: archiveButton ? '找到归档选项' : '未找到归档选项'
    })

    // 关闭上下文菜单
    await window.keyboard.press('Escape')
  } else {
    results.push({
      name: '归档功能存在',
      passed: false,
      violations: [],
      notes: '未找到会话项'
    })
  }
}

// 执行测试
async function main() {
  console.log('='.repeat(60))
  console.log('汤圆 QA 测试：分叉会话功能 (issue #89)')
  console.log('='.repeat(60))
  console.log()

  const results = await runForkSessionTests()

  console.log()
  console.log('='.repeat(60))
  console.log('测试结果汇总')
  console.log('='.repeat(60))

  let passed = 0
  let failed = 0

  for (const result of results) {
    const status = result.passed ? '✅' : '❌'
    console.log(`${status} ${result.name}`)
    if (result.violations.length > 0) {
      for (const v of result.violations) {
        console.log(`   - [${v.code}] ${v.message}`)
        if (v.detail) console.log(`     ${v.detail}`)
      }
    }
    if (result.notes) {
      console.log(`   📝 ${result.notes}`)
    }
    if (result.passed) passed++
    else failed++
  }

  console.log()
  console.log(`总计: ${passed + failed} | 通过: ${passed} | 失败: ${failed}`)

  if (failed > 0) {
    console.log('\n⚠️  存在失败的测试，建议提 GitHub issue')
    process.exit(1)
  }
}

main().catch(console.error)
