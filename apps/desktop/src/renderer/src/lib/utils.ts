import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * 项目在 main.css 的 @theme 中定义的语义字号 token。
 *
 * tailwind-merge 默认只识别原厂字号类（text-xs/sm/base…），会把这些自定义
 * token 误判为文字颜色类，从而在合并时删掉同元素上真正的颜色类。将它们注册到
 * font-size 组后，冲突判定恢复正确。
 */
const semanticFontSizes = ['page-title', 'section-heading', 'body', 'label', 'caption', 'mono']

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': semanticFontSizes.map((size) => `text-${size}`)
    }
  }
})

/**
 * 合并条件 className，并解决 Tailwind class 冲突。
 *
 * @param inputs - clsx 支持的 className 输入列表。
 * @returns 合并后的 className 字符串。
 * @throws 此方法不会主动抛出错误。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
