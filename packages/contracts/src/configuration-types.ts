/** 描述配置完整性状态。 */
export type ConfigRecoveryState = 'ok' | 'corrupted' | 'migration-failed'

/** 描述配置恢复信息。 */
export interface ConfigRecoveryInfo {
  state: ConfigRecoveryState
  hasBackup: boolean
}

/** 描述单个 Provider 的认证状态（Renderer 可见）。 */
export interface ProviderAuthSnapshot {
  configured: boolean
  maskedValue: string | null
}

/** 描述配置存储加解密抽象，由 Electron Main 注入 safeStorage 实现。 */
export interface ConfigEncryptionAdapter {
  /** 加密明文 API Key，返回 base64 密文。 */
  encrypt(plaintext: string): Promise<string>
  /** 解密 base64 密文，返回明文 API Key。 */
  decrypt(ciphertext: string): Promise<string>
  /** 检查当前系统是否可用加密能力。 */
  isAvailable(): boolean
}
