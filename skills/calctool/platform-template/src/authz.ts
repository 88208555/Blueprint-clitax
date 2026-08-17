// calctool 授权管理：调用外部能力前的透明授权 + 一次授权持久化
// 原则：调用任何外部能力（blueprint / 网络搜索 / 模型 / 外部 API）前必须告知用户，
// 用户授权一次后记住（localStorage 持久化），后续不再重复提示。

export type CapabilityKind =
  | 'blueprint'      // Blueprint 开发流程编排
  | 'web-search'     // 情报蜂群网络搜索
  | 'model'          // AI 模型调用
  | 'external-api'   // 外部 API（数据源/报表导出等）
  | 'storage'        // 本地/远端数据存储
  | 'automation'     // 自动化（定时/触发器）

export type Authorization = {
  capability: CapabilityKind
  granted: boolean
  grantedAt: string
  note?: string
}

const AUTH_KEY = 'calctool:authz:v1'
const ONBOARDING_KEY = 'calctool:onboarding:v1'
const CAPABILITY_LABELS: Record<CapabilityKind, string> = {
  'blueprint': 'Blueprint 开发流程编排',
  'web-search': '互联网情报搜索',
  'model': 'AI 模型调用',
  'external-api': '外部 API 数据源',
  'storage': '数据存储',
  'automation': '自动化任务',
}

/** 首次使用总提示：告知工具可能调用其他技能/增加消耗，同意后持久化不再弹 */
export class OnboardingConsent {
  constructor(private readonly engineId: string) {}

  private key(): string { return `${ONBOARDING_KEY}:${this.engineId}` }

  /** 是否已同意首次使用提示 */
  accepted(): boolean {
    if (typeof localStorage === 'undefined') return true
    return localStorage.getItem(this.key()) === 'accepted'
  }

  /** 同意并持久化（一次同意，不再提示） */
  accept(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.key(), 'accepted')
    }
  }

  /** 首次使用提示文案（可自定义，默认含消耗提示） */
  notice(extra?: string): string {
    return extra ?? '本工具为整套计算工具，可能调用其他技能辅助使用（如 Blueprint 开发流程编排、互联网情报搜索、AI 模型），可能增加调用消耗。同意后不再提示，可随时在「授权管理」页查看与撤销。'
  }
}

export class AuthzManager {
  private store: Record<string, Authorization> = {}

  constructor() {
    if (typeof localStorage === 'undefined') return
    try {
      this.store = JSON.parse(localStorage.getItem(AUTH_KEY) ?? '{}')
    } catch { this.store = {} }
  }

  /** 是否已授权某能力 */
  isGranted(capability: CapabilityKind): boolean {
    return this.store[capability]?.granted === true
  }

  /** 需要授权时的提示文案 */
  promptFor(capability: CapabilityKind, purpose: string): string {
    return `调用「${CAPABILITY_LABELS[capability]}」：${purpose}。是否授权？授权一次后不再提示。`
  }

  /** 记录授权（一次授权，持久化） */
  grant(capability: CapabilityKind, note?: string): void {
    this.store[capability] = {
      capability, granted: true, grantedAt: new Date().toISOString(), note,
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUTH_KEY, JSON.stringify(this.store))
    }
  }

  /** 撤销授权 */
  revoke(capability: CapabilityKind): void {
    delete this.store[capability]
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUTH_KEY, JSON.stringify(this.store))
    }
  }

  list(): Authorization[] {
    return Object.values(this.store)
  }

  static label(capability: CapabilityKind): string {
    return CAPABILITY_LABELS[capability]
  }
}

export const authz = new AuthzManager()
