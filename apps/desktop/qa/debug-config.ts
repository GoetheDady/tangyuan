/**
 * 调试配置页面
 */

import { launchApp, configureForQa, type AppHarness } from './lib/app-harness'

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('🚀 启动应用...')
  const harness = await launchApp()
  const { window } = harness

  // 配置 QA
  console.log('⚙️  配置 QA 模式...')
  const configResult = await configureForQa(harness)
  console.log('配置结果:', configResult)

  await sleep(2000)

  // 截图
  await window.screenshot({ path: 'qa/debug-config-1.png', fullPage: true })
  console.log('📸 截图 1 已保存')

  // 获取按钮状态
  const buttonStates = await window.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    return buttons.map(b => ({
      text: b.textContent?.trim(),
      disabled: b.disabled,
      ariaDisabled: b.getAttribute('aria-disabled'),
      className: b.className?.substring(0, 100)
    }))
  })
  console.log('按钮状态:', JSON.stringify(buttonStates, null, 2))

  // 查找输入框
  const inputStates = await window.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input, textarea'))
    return inputs.map(i => ({
      tag: i.tagName,
      type: i.type,
      placeholder: i.placeholder,
      value: i.value?.substring(0, 50),
      name: i.name
    }))
  })
  console.log('输入框状态:', JSON.stringify(inputStates, null, 2))

  // 尝试填写 API Key（可能需要手动填写）
  const apiKeyInput = await window.$('input[placeholder*="sk-ant"], input[type="password"], input[name*="key"], input[name*="apiKey"]')
  if (apiKeyInput) {
    console.log('找到 API Key 输入框，尝试填写...')
    await apiKeyInput.fill('sk-ce8218010ef74b93a3699797d7fba712')
    await sleep(1000)
    await window.screenshot({ path: 'qa/debug-config-2.png', fullPage: true })
    console.log('📸 截图 2 已保存')
  }

  // 再次检查按钮状态
  const buttonStates2 = await window.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    return buttons.map(b => ({
      text: b.textContent?.trim(),
      disabled: b.disabled,
      ariaDisabled: b.getAttribute('aria-disabled')
    }))
  })
  console.log('按钮状态（填写后）:', JSON.stringify(buttonStates2, null, 2))

  // 尝试选择模型
  const modelSelector = await window.$('button:has-text("选择模型"), button[role="combobox"]:has-text("模型")')
  if (modelSelector) {
    console.log('找到模型选择器，点击...')
    await modelSelector.click()
    await sleep(1000)
    await window.screenshot({ path: 'qa/debug-config-3.png', fullPage: true })
    console.log('📸 截图 3 已保存')

    // 查找模型选项
    const modelOptions = await window.evaluate(() => {
      const options = document.querySelectorAll('[role="option"], [role="menuitem"], li')
      return Array.from(options).map(o => o.textContent?.trim()).filter(Boolean).slice(0, 10)
    })
    console.log('模型选项:', modelOptions)
  }

  await harness.close()
}

main().catch(console.error)
