/**
 * 调试脚本：查看 UI 结构
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

  await sleep(3000)

  // 截图
  await window.screenshot({ path: '/tmp/tangyuan-qa-initial.png', fullPage: true })
  console.log('📸 截图已保存: /tmp/tangyuan-qa-initial.png')

  // 获取页面 HTML 结构（简化版）
  const pageInfo = await window.evaluate(() => {
    const body = document.body
    const allElements = body.querySelectorAll('*')
    const interactiveElements: string[] = []

    for (const el of allElements) {
      const tag = el.tagName.toLowerCase()
      const role = el.getAttribute('role')
      const ariaLabel = el.getAttribute('aria-label')
      const placeholder = el.getAttribute('placeholder')
      const className = el.className?.toString?.() || ''

      if (
        tag === 'textarea' ||
        tag === 'input' ||
        tag === 'button' ||
        role === 'textbox' ||
        role === 'button' ||
        placeholder ||
        ariaLabel
      ) {
        const info = [
          tag,
          role ? `role=${role}` : '',
          ariaLabel ? `aria="${ariaLabel}"` : '',
          placeholder ? `placeholder="${placeholder}"` : '',
          className ? `class="${className.substring(0, 80)}"` : ''
        ].filter(Boolean).join(' | ')
        interactiveElements.push(info)
      }
    }

    return {
      title: document.title,
      bodyText: body.innerText?.substring(0, 500),
      interactiveElements: interactiveElements.slice(0, 50)
    }
  })

  console.log('\n📄 页面信息:')
  console.log('标题:', pageInfo.title)
  console.log('\n正文预览:')
  console.log(pageInfo.bodyText)
  console.log('\n🎛️  交互元素:')
  for (const el of pageInfo.interactiveElements) {
    console.log('  -', el)
  }

  // 查找所有按钮
  const buttons = await window.$$('button')
  console.log(`\n🔘 共找到 ${buttons.length} 个按钮`)
  for (let i = 0; i < Math.min(buttons.length, 20); i++) {
    const text = await buttons[i].innerText()
    const ariaLabel = await buttons[i].getAttribute('aria-label')
    console.log(`  按钮 ${i}: text="${text}" aria-label="${ariaLabel}"`)
  }

  await harness.close()
}

main().catch(console.error)
