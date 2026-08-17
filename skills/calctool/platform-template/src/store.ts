// calctool 存储层：数据持久化
// 默认 localStorage（零依赖，任何环境可用）；Node 全功能模式可换 better-sqlite3
export type ToolRecord = {
  id: string
  engineId: string
  inputs: Record<string, string | number>
  results: Record<string, string>
  createdAt: string
  updatedAt: string
}

const KEY_PREFIX = 'calctool:record:'

export class ToolStore {
  constructor(private readonly engineId: string) {}

  list(): ToolRecord[] {
    if (typeof localStorage === 'undefined') return []
    const records: ToolRecord[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(`${KEY_PREFIX}${this.engineId}:`)) {
        try {
          records.push(JSON.parse(localStorage.getItem(key) ?? 'null'))
        } catch { /* 跳过损坏记录 */ }
      }
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  save(inputs: Record<string, string | number>, results: Record<string, string>): ToolRecord {
    const now = new Date().toISOString()
    const record: ToolRecord = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      engineId: this.engineId,
      inputs, results, createdAt: now, updatedAt: now,
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${KEY_PREFIX}${this.engineId}:${record.id}`, JSON.stringify(record))
    }
    return record
  }

  clear(): void {
    if (typeof localStorage === 'undefined') return
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(`${KEY_PREFIX}${this.engineId}:`)) keys.push(key)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  }
}
