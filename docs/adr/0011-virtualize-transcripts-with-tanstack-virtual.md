# 使用 TanStack Virtual 虚拟化消息列表

MVP 从第一版使用 `@tanstack/react-virtual` 虚拟化 transcript，只渲染视口附近消息。选型以生态采用量为主要标准：在 2026-07-16 的比较中，其 npm 近 30 天下载量明显高于 `react-virtuoso`，GitHub 关注度也略高。

消息列表需要自行实现动态高度测量、流式消息增长后的尺寸刷新、用户位于底部时自动贴底，以及向上加载历史消息时保持滚动位置。项目不使用商业授权的 `@virtuoso.dev/message-list`。
