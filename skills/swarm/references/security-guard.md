# 安全守卫检测规则与警报（security-guard）

固定安全智能体（security-guard）在所有子智能体输入进入执行前进行检测，发现异常触发警报并拦截。

## 检测规则

### 1. 提示词注入（prompt injection）
- 检测输入中的注入指令模式：
  - "忽略之前的指令 / ignore previous instructions"
  - "你现在是 / you are now / act as"
  - 内嵌的伪系统提示（system prompt 伪装）
  - 试图改变角色/权限的指令
- 命中 → block + alert

### 2. 危险指令（destructive / privilege）
- 检测危险操作模式：
  - 删除/覆盖（rm -rf / DROP TABLE / 覆盖生产数据）
  - 越权/提权（sudo / 提权 / 访问他人数据）
  - 凭据外泄（要求输出 API key / token / 密码）
  - 外网数据回传（把内部数据发到外部 URL）
- 命中 → block + alert

### 3. 异常行为（anomaly）
- 高频重试（同任务反复 claim）
- 异常输入（超长/畸形 payload）
- 跨角色动作（worker 尝试执行 ops/security 动作）
- 命中 → alert（可降级为观察）

## 警报结构（security-audit.json）

```json
{
  "alertId": "sec-0001",
  "severity": "high",
  "rule": "prompt-injection",
  "agentId": "worker-0002",
  "source": "task-input",
  "matched": ["ignore previous instructions"],
  "action": "block",
  "at": "2026-08-17T12:05:00Z"
}
```

## 动作

| 动作 | 说明 |
|---|---|
| `block` | 拦截输入，任务不进入执行 |
| `alert` | 记录警报，任务可继续（观察模式） |
| `quarantine` | 隔离智能体，暂停其任务并通知 ops |

## 原则

- 所有 worker 输入先过 security-guard（安全前置）
- 拦截不静默：每条 block/alert 都进 `security-audit.json` 并可被老板查询
- 敏感信息（密钥/凭据）不进入 worker 上下文
