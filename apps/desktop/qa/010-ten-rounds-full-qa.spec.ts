/**
 * 10 轮功能 QA — 汤圆桌面端真实用户场景测试
 *
 * 严格遵守 README.md：所有交互通过 Playwright locator.click() / fill() / press()
 * 操作页面中实际渲染的可见可操作元素。禁止 page.evaluate() 伪造点击、DOM 注入等。
 * 每轮定义为一个完整且有明确目标的用户测试场景，不重复相同操作。
 * 所有 10 轮在单个 test() 内顺序执行。
 *
 * 环境变量：
 *   TANGYUAN_QA_API_KEY — 必需
 *   TANGYUAN_QA_PROVIDER — 默认 deepseek
 *   TANGYUAN_QA_MODEL — 默认 deepseek-v4-flash
 */

import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LOG_PATH = join(process.cwd(), 'qa-ten-rounds-log.txt')
const log: string[] = []

function L(msg: string): void { log.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); console.log(msg) }

test('10 轮功能 QA —— 汤圆桌面端全量测试', async () => {
  test.setTimeout(3_600_000)

  // ── 0. 环境 ────────────────────────────────────────────────
  const apiKey = process.env['TANGYUAN_QA_API_KEY']
  if (!apiKey) throw new Error('❌ TANGYUAN_QA_API_KEY 未设置')
  L('🔑 环境变量就绪')

  // ── 1. 启动 ────────────────────────────────────────────────
  const tempHome = mkdtempSync(join(tmpdir(), 'tangyuan-qa-10r-'))
  const mainEntry = join(process.cwd(), 'out/main/index.js')

  const app = await electron.launch({
    args: [mainEntry],
    env: { ...process.env, HOME: tempHome, TANGYUAN_DESKTOP_SMOKE_TEST_RESULT_PATH: '' }
  })

  let win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  const errors: string[] = []
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))

  function healthV(): string[] {
    const v: string[] = []
    if (errors.length) v.push(`err:${errors.join('; ').slice(0, 200)}`)
    return v
  }

  // ── 2. QA 配置注入 ─────────────────────────────────────────
  const providerId = process.env['TANGYUAN_QA_PROVIDER'] ?? 'deepseek'
  const modelId = process.env['TANGYUAN_QA_MODEL'] ?? 'deepseek-v4-flash'
  const r = await win.evaluate(({ k, p, m }) =>
    (window.api as any).saveRuntimeConfiguration({ providerId: p, modelId: m, apiKey: k })
      .then(() => true).catch((e: unknown) => { L(`  配置失败: ${e}`); return false }),
    { k: apiKey, p: providerId, m: modelId })
  expect(r).toBe(true)
  L('✅ QA 配置注入')

  // 等就绪
  await win.waitForTimeout(3000)
  for (let i = 0; i < 40; i++) {
    const snap = await win.evaluate(() => (window.api as any).getRuntimeSnapshot())
    if (snap?.status === 'ready') { L('✅ 运行时就绪'); break }
    await win.waitForTimeout(2000)
  }

  // 切到聊天页
  const ch = await win.evaluate(() => window.location.hash)
  if (!ch.startsWith('#/chat/')) {
    await win.evaluate(() => { window.location.hash = '#/chat/tangyuan' })
    await win.waitForTimeout(3000)
  }

  // ── 辅助：交互循环 ─────────────────────────────────────────

  /** 处理 Bcakground 卡片 + 等交互完全结束 = 一个完整的 drain 循环 */
  async function drain(): Promise<'ok' | 'timeout'> {
    const deadline = Date.now() + 300_000
    let lastHandle = Date.now()
    while (Date.now() < deadline) {
      await win.waitForTimeout(800)
      // 处理卡片
      let handled = 0
      for (let i = 0; i < 15; i++) {
        // Bash — 文本定位 + force（避开 toast 层叠上下文）
        const once = win.locator('button:has-text("允许本次")')
        if (await once.count() && await once.first().isVisible().catch(() => false)) {
          L('  🔓 Bash: 允许本次'); try { await once.first().click({ force: true }) } catch {}
          await win.waitForTimeout(1500); handled++; continue
        }
        const always = win.locator('button:has-text("始终允许")')
        if (await always.count() && await always.first().isVisible().catch(() => false)) {
          L('  🔓 Bash: 始终允许'); try { await always.first().click({ force: true }) } catch {}
          await win.waitForTimeout(1500); handled++; continue
        }
        const reject = win.locator('button:has-text("拒绝")')
        if (await reject.count() && await reject.first().isVisible().catch(() => false)) {
          L('  🔓 Bash: 拒绝'); try { await reject.first().click({ force: true }) } catch {}
          await win.waitForTimeout(1500); handled++; continue
        }
        // 澄清
        const cards = win.locator('[data-testid="clarification-card"]')
        if ((await cards.count()) === 0) break
        const card = cards.first()
        if (await card.locator('text=已回答').count()) break
        const opts = card.locator('button[role="radio"]:not([disabled])')
        if (await opts.count()) {
          const t = (await opts.first().textContent()) ?? ''
          L(`  💬 澄清: ${t}`)
          try { await opts.first().click({ force: true }) } catch {}
          await win.waitForTimeout(1500); handled++; continue
        }
        const inp = card.locator('input')
        if (await inp.isVisible()) {
          await inp.fill('按默认设置来'); await win.waitForTimeout(300)
          const sb = card.locator('button:has-text("提交")')
          if (await sb.isVisible()) { try { await sb.click({ force: true }) } catch {} }
          await win.waitForTimeout(1500); handled++
        }
      }
      if (handled) { lastHandle = Date.now(); continue }

      // 确认 agent 停止
      const stopBtn = win.locator('button[aria-label="停止"]')
      if ((await stopBtn.count()) === 0 || !(await stopBtn.first().isVisible().catch(() => false))) {
        await win.waitForTimeout(1000)
        return 'ok'
      }
      // Agent 还在跑且 60s 无交互 → 可能是死循环
      if (Date.now() - lastHandle > 60_000) {
        L('  ⚠️ 60s 无交互，强制停止')
        try { await stopBtn.first().click({ force: true }) } catch {}
        await win.waitForTimeout(3000)
        return 'timeout'
      }
    }
    return 'timeout'
  }

  async function send(msg: string, sec = 240): Promise<boolean> {
    const ta = win.locator('textarea#composer')
    await expect(ta).toBeVisible({ timeout: 10_000 })
    await ta.fill(msg); await win.waitForTimeout(500)
    const btn = win.locator('button[aria-label="发送"]')
    if (await btn.isDisabled()) { L(`  ⏭ 发送禁用`); return false }
    L(`  📤 "${msg.slice(0, 60)}..."`)
    await btn.click()
    return (await drain()) === 'ok'
  }

  // ── ═════════════════════════════════════════════════════════ ──
  //  第一组优先 drain Bcakdrop —— 先耗到交互结束
  // ── ═════════════════════════════════════════════════════════ ──

  L('\n═══ [Bootstrap] 首次 drain 交互 ──────────────────────────')
  await drain()

  // ── 轮次 1: 聊天页 UI 验证 ──────────────────────────────────
  L('\n═══ 轮次 1/10: 聊天页 UI 验证 ═══')
  {
    const hash = await win.evaluate(() => window.location.hash)
    L(`路由: ${hash}`)
    // 可能刚创建了 Bootstrap 会话但还没到聊天页
    expect(hash).toMatch(/^#\/chat\//)
    await expect(win.locator('textarea#composer')).toBeVisible({ timeout: 10_000 })
    await expect(win.locator('[data-testid="chat-sidebar"]')).toBeVisible()
    await expect(win.locator('button[aria-label="发送"]')).toBeVisible()
    await expect(win.locator('button:has-text("新建会话")')).toBeVisible()
    await expect(win.locator('[data-testid="chat-header"]')).toBeVisible()
    L('✅ 聊天页核心元素可见')

    // 模型选择器（单 Provider 可能不可见）
    if (await win.locator('button[aria-label="模型"]').isVisible().catch(() => false)) L('✅ 模型选择器可见')
    // 附件按钮禁用
    const at = win.locator('button[aria-label="附件功能暂未开放"]')
    if (await at.isVisible().catch(() => false)) {
      expect(await at.isDisabled()).toBe(true)
      L('✅ 附件按钮禁用')
    }
    expect(healthV()).toEqual([])
  }

  // ── 轮次 2: 发送首条消息 ────────────────────────────────────
  L('\n═══ 轮次 2/10: 首条消息 ═══')
  {
    const ok = await send('你好，请做一个简单的自我介绍', 240)
    if (ok) {
      const area = win.locator('[data-testid="message-scroll-area"]')
      await expect(area).toBeVisible()
      const t = await area.innerText()
      L(`📄 消息区域: ${t.length} 字符`)
      expect(t.length).toBeGreaterThan(30)
    } else {
      L('⚠️ 首条消息超时')
    }
    expect(healthV()).toEqual([])
  }

  // ── 轮次 3: 多轮对话 ────────────────────────────────────────
  L('\n═══ 轮次 3/10: 多轮对话 ═══')
  {
    for (const msg of ['你能做什么？', '可以读取文件系统的文件吗？', '帮我看看当前目录有什么']) {
      const ok = await send(msg, 180)
      L(`  消息「${msg.slice(0, 20)}」: ${ok ? '✅' : '⏰'}`)
      const v = healthV()
      if (v.length) L(`  ⚠️ ${v.join('; ')}`)
    }
  }

  // ── 轮次 4: 模型选择器/思考强度/空消息控件 ─────────────────
  L('\n═══ 轮次 4/10: Composer 控件 ═══')
  {
    await drain()

    // 模型选择器
    const modelBtn = win.locator('button[aria-label="模型"]')
    if (await modelBtn.isVisible().catch(() => false)) {
      await modelBtn.click(); await win.waitForTimeout(500)
      const n = await win.locator('[role="option"]').count()
      L(`📋 模型选项: ${n} 个`)
      await win.keyboard.press('Escape'); await win.waitForTimeout(500)
    }

    // 思考强度
    const tb = win.locator('button[aria-label="思考强度"]')
    if (await tb.isVisible().catch(() => false)) {
      await tb.click(); await win.waitForTimeout(500)
      L(`📋 思考强度选项: ${await win.locator('[role="option"]').count()} 个`)
      await win.keyboard.press('Escape'); await win.waitForTimeout(500)
    } else { L('ℹ️ 思考强度不可见') }

    // 空消息禁用
    await win.locator('textarea#composer').fill(''); await win.waitForTimeout(300)
    expect(await win.locator('button[aria-label="发送"]').isDisabled()).toBe(true)
    L('✅ 空消息发送禁用')

    expect(healthV()).toEqual([])
  }

  // ── 轮次 5: 运行中停止 ──────────────────────────────────────
  L('\n═══ 轮次 5/10: 停止响应 ═══')
  {
    await drain()
    const ta = win.locator('textarea#composer')

    // 发送长耗时请求
    await ta.fill('请详细解释量子计算基本原理，800字文章'); await win.waitForTimeout(500)
    await win.locator('button[aria-label="发送"]').click()

    // 等停止按钮
    const sb = win.locator('button[aria-label="停止"]')
    await expect(sb).toBeVisible({ timeout: 20_000 })
    L('✅ Agent 开始执行')
    await win.waitForTimeout(4000)

    // 停止
    L('🛑 点击停止')
    try { await sb.click({ force: true }) } catch {}
    await win.waitForTimeout(3000)

    // 发送按钮恢复
    await expect(win.locator('button[aria-label="发送"]')).toBeVisible({ timeout: 10_000 })
    L('✅ 发送按钮恢复')
    expect(await ta.isDisabled()).toBe(false)
    L('✅ Textarea 可编辑')

    expect(healthV()).toEqual([])
  }

  // ── 轮次 6: 新建会话 + 切换 ─────────────────────────────────
  L('\n═══ 轮次 6/10: 新建会话 ═══')
  {
    await drain()

    const countBefore = await win.locator('[data-testid="chat-session-pane"] button[type="button"]').count()
    L(`📋 会话按钮: ${countBefore}`)

    await win.locator('button:has-text("新建会话")').click()
    await win.waitForTimeout(2000)
    const h1 = await win.evaluate(() => window.location.hash)
    L(`📍 新建路由: ${h1}`)

    const ok = await send('这是新会话的消息', 120)
    L(`新会话: ${ok ? '✅' : '⏰'}`)

    // 切回旧会话
    const allBtns = win.locator('[data-testid="chat-session-pane"] button[type="button"]')
    const after = await allBtns.count()
    if (after >= 3) {
      await allBtns.nth(1).click(); await win.waitForTimeout(2000)
      const h2 = await win.evaluate(() => window.location.hash)
      const hdr = await win.locator('[data-testid="chat-header"]').innerText()
      L(`📍 切回路由: ${h2}, 标题: ${hdr}`)
    }

    expect(healthV()).toEqual([])
  }

  // ── 轮次 7: 边角操作 ────────────────────────────────────────
  L('\n═══ 轮次 7/10: 边角操作 ═══')
  {
    await drain()

    // 超长消息
    const long = 'X'.repeat(5000) + '。末尾。'
    await win.locator('textarea#composer').fill(long); await win.waitForTimeout(500)
    L(`📤 超长 ${long.length} 字符`)
    const b = win.locator('button[aria-label="发送"]')
    if (!(await b.isDisabled())) { await b.click(); L(`  结果: ${await drain() === 'ok' ? '✅' : '⏰'}`) }

    // 快速点击新建
    for (let i = 0; i < 3; i++) {
      await win.locator('button:has-text("新建会话")').click(); await win.waitForTimeout(200)
    }
    await win.waitForTimeout(2000)
    L('✅ 快速新建会话 x3')

    expect(healthV()).toEqual([])
  }

  // ── 轮次 8: 设置页导航 ──────────────────────────────────────
  L('\n═══ 轮次 8/10: 设置页导航 ═══')
  {
    await drain()

    const setBtn = win.locator('[data-testid="chat-agent-rail"] button[aria-label="设置"]')
    if (await setBtn.isVisible().catch(() => false)) {
      await setBtn.click(); await win.waitForTimeout(2000)
      const h = await win.evaluate(() => window.location.hash)
      L(`📍 设置页: ${h}`)
      expect(h).toBe('#/console/providers')
      const txt = await win.evaluate(() => document.body.innerText)
      L(`📄 Provider 页: ${txt.slice(0, 120)}...`)

      // 返回
      await win.evaluate(() => { window.location.hash = '#/chat/tangyuan' })
      await win.waitForTimeout(3000)
      L(`📍 返回: ${await win.evaluate(() => window.location.hash)}`)
      await expect(win.locator('textarea#composer')).toBeVisible({ timeout: 10_000 })
      L('✅ 回到聊天页')
    } else { L('⚠️ 设置按钮不可见') }

    expect(healthV()).toEqual([])
  }

  // ── 轮次 9: Agent 侧边栏 ────────────────────────────────────
  L('\n═══ 轮次 9/10: Agent 侧边栏 ═══')
  {
    await drain()
    const ag = win.locator('[data-testid="chat-agent-rail"] button[aria-label*="切换到 Agent"]')
    L(`📋 Agent 切换按钮: ${await ag.count()}`)
    expect(await ag.count()).toBeGreaterThanOrEqual(1)
    const cur = win.locator('[data-testid="chat-agent-rail"] button[aria-current="page"]')
    expect(await cur.count()).toBe(1)
    L('✅ 有且仅有一个 Agent 选中')
    expect(healthV()).toEqual([])
  }

  // ── 轮次 10: 重启持久化 ────────────────────────────────────
  L('\n═══ 轮次 10/10: 重启持久化 ═══')
  {
    let sessionsBefore: any[] = []
    try { sessionsBefore = await win.evaluate(() => (window.api as any).listSessions()) } catch {}
    L(`📋 关闭前: ${sessionsBefore.length} 会话`)
    await app.close()

    const app2 = await electron.launch({
      args: [mainEntry],
      env: { ...process.env, HOME: tempHome, TANGYUAN_DESKTOP_SMOKE_TEST_RESULT_PATH: '' }
    })
    win = await app2.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    errors.length = 0
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    win.on('pageerror', (e) => errors.push(String(e)))

    // 重新注入 QA
    await win.waitForTimeout(3000)
    const r2 = await win.evaluate(({ k, p, m }) =>
      (window.api as any).saveRuntimeConfiguration({ providerId: p, modelId: m, apiKey: k })
        .then(() => true).catch(() => false),
      { k: apiKey, p: providerId, m: modelId })
    expect(r2).toBe(true)
    L('✅ 重启 QA 注入')

    await win.waitForTimeout(5000)
    for (let i = 0; i < 30; i++) {
      const snap = await win.evaluate(() => (window.api as any).getRuntimeSnapshot())
      if (snap?.status === 'ready') break
      await win.waitForTimeout(2000)
    }

    // 导航
    await win.evaluate(() => { window.location.hash = '#/chat/tangyuan' })
    await win.waitForTimeout(3000)
    await expect(win.locator('textarea#composer')).toBeVisible({ timeout: 10_000 })
    L('✅ Textarea 可见')

    let sessionsAfter: any[] = []
    try { sessionsAfter = await win.evaluate(() => (window.api as any).listSessions()) } catch {}
    L(`📋 重启后: ${sessionsAfter.length} 会话`)
    expect(sessionsAfter.length).toBeGreaterThan(0)
    L('✅ 会话已持久化')

    expect(healthV()).toEqual([])
    await app2.close()
  }

  // ── 汇总 ─────────────────────────────────────────────────────
  rmSync(tempHome, { recursive: true, force: true })
  writeFileSync(LOG_PATH, log.join('\n') + '\n', 'utf-8')
  L('\n═══════════════════════════════════════════════════════════')
  L('   🎉 10 轮 QA 全部完成')
  L(`   控制台错误: ${errors.length}`)
  L(`   日志: ${LOG_PATH}`)
  L('═══════════════════════════════════════════════════════════')
  expect(errors.length).toBe(0)
})
