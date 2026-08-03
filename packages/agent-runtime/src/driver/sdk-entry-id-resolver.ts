import type { MessageStore } from '../session/message-store'
import type { PiSdkGateway } from './pi-sdk-driver-contracts'

/**
 * 解析分叉源消息标识所需的依赖。
 */
export interface SdkEntryIdResolverDependencies {
  gateway: Pick<PiSdkGateway, 'readMessages'>
  messageStore: Pick<MessageStore, 'getMessages'>
}

/**
 * 把调用方提供的分叉源消息标识解析为 Pi SDK 文件中的真实 entry id。
 *
 * 公开 transcript 快照中的 messageId 由 messageStore 生成（`sessionId-message-N`），
 * 而 Pi JSONL 文件中的 entry id 由 SDK 生成（uuid）。调用方经 Runtime 深接口拿到的
 * messageId 无法直接用于 SDK 文件查找，这里按序号桥接：
 * messageStore 只含本次运行期追加的消息，而文件还含分叉继承的历史，因此两者
 * 按尾部对齐——文件目标 = 文件用户消息数 - messageStore 用户消息数 + 消息序号。
 * 调用方若已传 SDK 原生 entry id（与文件一致）则原样返回。
 *
 * @param dependencies - 读取 SDK 文件与运行期消息所需的依赖。
 * @param input - 会话定位信息与调用方提供的分叉源消息标识。
 * @returns SDK 文件中的真实 entry id；无法桥接时返回原标识，由 gateway 对真实文件给出准确错误。
 * @throws 此函数不会主动抛出错误。
 */
export async function resolveSdkEntryId(
  dependencies: SdkEntryIdResolverDependencies,
  input: {
    sessionId: string
    driverMessageId: string
    sdkSessionFile: string
  },
): Promise<string> {
  const { sessionId, driverMessageId, sdkSessionFile } = input
  const snapshot = await dependencies.gateway.readMessages({
    sessionId,
    sdkSessionFile,
  })

  if (
    snapshot.entries.some(
      (entry) =>
        entry.kind !== 'compaction' && entry.messageId === driverMessageId,
    )
  ) {
    return driverMessageId
  }

  const driverUserMessages = dependencies.messageStore
    .getMessages(sessionId)
    .filter((message) => message.role === 'user')
  const userMessageIndex = driverUserMessages.findIndex(
    (message) => message.messageId === driverMessageId,
  )
  const fileUserMessages = snapshot.entries.flatMap((entry) =>
    entry.kind === 'user-message' ? [entry] : [],
  )
  // 调用方标识不在 messageStore、文件为空（SDK 尚未落盘或测试替身不持久化）、
  // 文件尚未追平运行期消息（SDK 缓冲未落盘）时无法桥接，统一回退原标识。
  const inheritedOffset = fileUserMessages.length - driverUserMessages.length
  if (userMessageIndex < 0 || inheritedOffset < 0) {
    return driverMessageId
  }
  const target = fileUserMessages[userMessageIndex + inheritedOffset]

  return target?.messageId ?? driverMessageId
}
