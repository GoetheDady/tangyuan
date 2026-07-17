/**
 * 构建桌面页面使用的 Content Security Policy（内容安全策略）。
 *
 * 开发模式需要允许 Vite 注入 React Refresh 内联脚本，并连接开发服务器的
 * HTTP 与 WebSocket 地址；生产模式继续禁止内联脚本和远程连接。
 *
 * @param rendererUrl - Vite Renderer 开发服务器地址；生产模式传入 undefined。
 * @returns 可写入 Content-Security-Policy 响应头的策略字符串。
 * @throws rendererUrl 不是合法 URL 时会抛出 TypeError。
 */
export function buildContentSecurityPolicy(rendererUrl?: string): string {
  const isDevServer = Boolean(rendererUrl)
  const scriptSrc = isDevServer ? `'self' 'unsafe-inline'` : `'self'`
  const connectSrc = rendererUrl
    ? `'self' ${new URL(rendererUrl).origin} ws://localhost:*`
    : `'self'`

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ')
}
