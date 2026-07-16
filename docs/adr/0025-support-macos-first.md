# MVP 只正式支持 macOS

汤圆 MVP 只对 macOS 承诺正式支持和发布验收。API Key 加密依赖 macOS Keychain 支持的 Electron `safeStorage`，每次发布必须通过 macOS 安装、启动、配置、聊天、重启恢复和打包 smoke test。

Windows 与 Linux 的构建脚本可以保留，但在建立对应平台的凭据保护、文件权限、窗口行为、打包和端到端测试前，不作为 MVP 支持范围，也不承诺可用性。
