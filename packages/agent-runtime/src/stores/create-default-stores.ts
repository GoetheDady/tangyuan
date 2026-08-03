import { homedir } from 'node:os'
import { join } from 'node:path'
import { RealPiSdkGateway } from '../runtime/gateway'
import { DefaultProfileModule } from '../runtime/default-profile-module'
import { DefaultRuntimeConfiguration } from '../runtime/runtime-configuration'
import { ConfigStore, DirectoryLayout } from '../core'
import { AgentRegistry } from '../agent'
import { SkillStore } from '../skill'
import { ProfileStore } from '../profile'
import { SessionIndexStore } from '../session/session-index-store'
import { MessageStore } from '../session/message-store'
import type { ConfigEncryptionAdapter } from '@yuanxiao/contracts'
import type { PiSdkGateway } from '../driver/pi-sdk-driver-contracts'
import { EventBus } from './event-bus'

/** 创建默认 Store 的选项。 */
export interface CreateStoresOptions {
  agentHomePath?: string
  fsRoot?: string
  userDataPath?: string
  now?: () => string
  gateway?: PiSdkGateway
  encryptionAdapter?: ConfigEncryptionAdapter | null
}

/** 默认 Store 集合。 */
export interface DefaultStores {
  now: () => string
  fsRoot: string
  agentHomePath: string
  userDataPath: string
  layout: DirectoryLayout
  eventBus: EventBus
  gateway: PiSdkGateway
  encryptionAdapter: ConfigEncryptionAdapter | null
  configStore: ConfigStore
  agentRegistry: AgentRegistry
  skillStore: SkillStore
  profileStore: ProfileStore
  sessionIndexStore: SessionIndexStore
  messageStore: MessageStore
  configurationModule: DefaultRuntimeConfiguration
  profileModule: DefaultProfileModule
}

/**
 * 创建默认 Runtime 所需的全部本地存储模块。
 *
 * 提取自 PiSdkDriverState 的构造函数，使 Store 创建与 Driver 解耦。
 * 所有模块通过 EventBus 共享事件通道。
 */
export function createDefaultStores(
  options: CreateStoresOptions = {},
): DefaultStores {
  const now = options.now ?? (() => new Date().toISOString())
  const fsRoot = options.fsRoot ?? homedir()
  const agentHomePath = options.agentHomePath ?? '~/.yuanxiao/agents/yuanxiao'
  const userDataPath = options.userDataPath ?? join(fsRoot, '.yuanxiao')
  const gateway = options.gateway ?? new RealPiSdkGateway()
  const encryptionAdapter = options.encryptionAdapter ?? null
  const eventBus = new EventBus()

  const layout = new DirectoryLayout({ agentHomePath, fsRoot, userDataPath })

  const configStore = new ConfigStore({ layout, encryptionAdapter, now })

  const agentRegistry = new AgentRegistry({
    layout,
    configStore,
    now,
    emit: (event) => eventBus.emit(event),
    agentHomePath,
  })

  const skillStore = new SkillStore({ layout, now })

  const profileStore = new ProfileStore({ layout, configStore, now })

  const sessionIndexStore = new SessionIndexStore({
    layout,
    configStore,
    gateway,
  })

  const messageStore = new MessageStore({ now })

  const configurationModule = new DefaultRuntimeConfiguration({
    agentHomePath,
    agentRegistry,
    configStore,
    gateway,
    now,
    profileStore,
  })

  const profileModule = new DefaultProfileModule({
    emit: (event) => eventBus.emit(event),
    layout,
    now,
    profileStore,
    // 会话上下文刷新回调由 Driver 在注入 Store 后通过
    // setRefreshContextHandlers 绑定，此处先保持无操作。
    refreshAgentContext: async () => undefined,
    refreshAllContexts: async () => undefined,
  })

  return {
    now,
    fsRoot,
    agentHomePath,
    userDataPath,
    layout,
    eventBus,
    gateway,
    encryptionAdapter,
    configStore,
    agentRegistry,
    skillStore,
    profileStore,
    sessionIndexStore,
    messageStore,
    configurationModule,
    profileModule,
  }
}
