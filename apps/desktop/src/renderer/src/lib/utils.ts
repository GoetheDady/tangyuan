import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

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
