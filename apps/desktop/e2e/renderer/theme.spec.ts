import { expect, test } from '@playwright/test'
import {
  createPreloadApiInitScript,
  createReadyRuntimeSnapshot,
  createTestMessages,
  createTestSessions
} from '../fixtures/preload-mock'

const semanticTokenNames = [
  // 兼容现有 shadcn 语义 Token。
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'primary-hover',
  'primary-active',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'destructive-hover',
  'destructive-active',
  'success',
  'warning',
  'info',
  'border',
  'input',
  'input-hover',
  'ring',
  'radius',
  // 黑芝麻汤圆基础语义与交互状态。
  'info-soft',
  'info-border',
  'info-foreground',
  'success-soft',
  'success-border',
  'success-foreground',
  'warning-soft',
  'warning-border',
  'warning-foreground',
  'destructive-soft',
  'destructive-border',
  'destructive-soft-foreground',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
  'split',
  'disabled',
  'disabled-foreground',
  'hover',
  'hover-foreground',
  'active',
  'active-foreground',
  // 全局基础规范。
  'spacing-micro',
  'spacing-grid',
  'text-body',
  'text-body-line-height',
  'border-width',
  'focus-ring-width',
  'focus-ring-offset',
  'duration-instant',
  'duration-fast',
  'duration-base',
  'duration-slow',
  'shadow-level-0',
  'shadow-level-1',
  'shadow-level-2',
  'shadow-level-3'
] as const

test.describe('Renderer 全局主题', () => {
  test('暴露完整且向后兼容的黑芝麻汤圆语义 Token', async ({ page }) => {
    const initScript = createPreloadApiInitScript(
      createReadyRuntimeSnapshot(),
      createTestSessions(1),
      createTestMessages()
    )

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    const result = await page.evaluate((tokenNames) => {
      const rootStyle = getComputedStyle(document.documentElement)
      const bodyStyle = getComputedStyle(document.body)
      const tokens = Object.fromEntries(
        tokenNames.map((tokenName) => [
          tokenName,
          rootStyle.getPropertyValue(`--${tokenName}`).trim()
        ])
      )
      function readProbe(className: string, style = '') {
        const probe = document.createElement('div')
        probe.className = className
        probe.style.cssText = style
        document.body.append(probe)
        const probeStyle = getComputedStyle(probe)
        const result = {
          backgroundColor: probeStyle.backgroundColor,
          color: probeStyle.color,
          borderTopColor: probeStyle.borderTopColor,
          borderTopWidth: probeStyle.borderTopWidth,
          boxShadow: probeStyle.boxShadow,
          transitionDuration: probeStyle.transitionDuration,
          width: probeStyle.width,
          height: probeStyle.height
        }
        probe.remove()
        return result
      }

      return {
        tokens,
        body: {
          backgroundColor: bodyStyle.backgroundColor,
          color: bodyStyle.color,
          fontSize: bodyStyle.fontSize,
          lineHeight: bodyStyle.lineHeight
        },
        surfaces: {
          card: readProbe('bg-card'),
          sidebar: readProbe('bg-sidebar')
        },
        controls: {
          primaryHover: readProbe('bg-primary-hover'),
          primaryActive: readProbe('bg-primary-active'),
          destructiveHover: readProbe('bg-destructive-hover'),
          destructiveActive: readProbe('bg-destructive-active'),
          input: readProbe('border border-input'),
          inputHover: readProbe('border border-input-hover'),
          disabled: readProbe('bg-disabled text-disabled-foreground'),
          hover: readProbe('bg-hover text-hover-foreground'),
          active: readProbe('bg-active text-active-foreground')
        },
        statuses: {
          info: readProbe('border bg-info-soft border-info-border text-info-foreground'),
          success: readProbe(
            'border bg-success-soft border-success-border text-success-foreground'
          ),
          warning: readProbe(
            'border bg-warning-soft border-warning-border text-warning-foreground'
          ),
          destructive: readProbe(
            'border bg-destructive-soft border-destructive-border text-destructive-soft-foreground'
          )
        },
        spacing: readProbe('', 'width: var(--spacing-grid); height: var(--spacing-micro)'),
        focus: readProbe('', 'box-shadow: var(--focus-ring-shadow)'),
        motion: readProbe('', 'transition-duration: var(--duration-base)'),
        shadows: {
          level0: readProbe('shadow-level-0'),
          level1: readProbe('shadow-level-1'),
          level2: readProbe('shadow-level-2'),
          level3: readProbe('shadow-level-3')
        }
      }
    }, semanticTokenNames)

    expect(Object.entries(result.tokens).filter(([, value]) => value === '')).toEqual([])
    expect(result.body).toMatchObject({
      fontSize: '14px',
      lineHeight: '22px'
    })
    expect(result.body.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(result.body.color).not.toBe('rgba(0, 0, 0, 0)')
    expect(result.surfaces.sidebar.backgroundColor).not.toBe(result.surfaces.card.backgroundColor)
    expect(result.controls.primaryHover.backgroundColor).not.toBe(
      result.controls.primaryActive.backgroundColor
    )
    expect(result.controls.destructiveHover.backgroundColor).not.toBe(
      result.controls.destructiveActive.backgroundColor
    )
    expect(result.controls.inputHover.borderTopColor).not.toBe(result.controls.input.borderTopColor)
    expect(result.controls.disabled.color).not.toBe('rgba(0, 0, 0, 0)')
    expect(result.controls.hover.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(result.controls.active.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')

    for (const status of Object.values(result.statuses)) {
      expect(status.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      expect(status.color).not.toBe('rgba(0, 0, 0, 0)')
      expect(status.borderTopWidth).toBe('1px')
      expect(status.borderTopColor).not.toBe('rgba(0, 0, 0, 0)')
    }

    expect(result.spacing).toMatchObject({ width: '8px', height: '4px' })
    expect(result.focus.boxShadow).not.toBe('none')
    expect(result.motion.transitionDuration).toBe('0.16s')
    expect(result.shadows.level0.boxShadow).toBe('none')
    const raisedShadows = [
      result.shadows.level1.boxShadow,
      result.shadows.level2.boxShadow,
      result.shadows.level3.boxShadow
    ]
    expect(raisedShadows).not.toContain('none')
    expect(new Set(raisedShadows).size).toBe(3)
    await expect(page.locator('#composer')).toBeVisible()
  })
})
