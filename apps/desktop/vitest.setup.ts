import { vi } from 'vitest'

/**
 * 全局 ResizeObserver mock，供 TanStack Virtual 等依赖 ResizeObserver 的库
 * 在 jsdom 环境中使用。
 */
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
}

/**
 * jsdom 不实现 CSS layout，所有元素尺寸（offsetHeight、clientHeight、
 * scrollHeight、getBoundingClientRect）始终为 0。TanStack Virtual 依赖
 * 这些 API 来决定渲染哪些虚拟项目，因此必须 mock 为非零值。
 *
 * 这里 mock 为合理默认值；需要精确尺寸验证的测试可在 beforeEach 中
 * 调用 vi.mocked(...).mockReturnValue(...) 覆盖。
 */
function createDomRect(width = 1024, height = 768): DOMRect {
  return {
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({})
  }
}

vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
  // 对滚动容器返回更大的高度，确保虚拟列表视口足够
  if (this instanceof HTMLElement) {
    const cls = this.getAttribute('class') ?? ''
    if (cls.includes('overflow-y-auto') || cls.includes('overflow-y-scroll')) {
      return createDomRect(1024, 600)
    }
  }
  return createDomRect()
})

// mock 只读尺寸属性为可写 getter
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: {
    configurable: true,
    get() {
      const cls = (this as HTMLElement).getAttribute('class') ?? ''
      if (cls.includes('overflow-y-auto') || cls.includes('overflow-y-scroll')) {
        return 600
      }
      return 120
    }
  },
  clientHeight: {
    configurable: true,
    get() {
      const cls = (this as HTMLElement).getAttribute('class') ?? ''
      if (cls.includes('overflow-y-auto') || cls.includes('overflow-y-scroll')) {
        return 600
      }
      return 120
    }
  },
  scrollHeight: {
    configurable: true,
    get() {
      const cls = (this as HTMLElement).getAttribute('class') ?? ''
      if (cls.includes('overflow-y-auto') || cls.includes('overflow-y-scroll')) {
        return 1200
      }
      return 240
    }
  }
})
