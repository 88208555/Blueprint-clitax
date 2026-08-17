# 运维心跳 / 回收 / 接替协议（ops-heartbeat）

固定运维智能体（ops）监控所有子智能体，实现"卡住/死亡 → 自主收回 → 派遣接替 → 继承任务续跑"的自治循环。

## 心跳协议

- 每个 worker 定期上报心跳（默认间隔 30s）
- ops 记录 `lastHeartbeatAt`，维护 `heartbeatMisses`
- 判定规则：
  - `heartbeatMisses = 0` → green
  - `heartbeatMisses = 1-2` → yellow（风险，提醒）
  - `heartbeatMisses >= 3` → red（死亡）

## 回收流程（reclaim）

1. ops 检测到 worker 心跳停止（red）
2. ops 标记该 worker 死亡，`status = dead`
3. ops 收回其名下所有 `claimed/running` 任务：
   - 任务状态 → `backlog`（清空 owner）
   - 保留 `report` 历史与 `progressPercent`（供接替者继承）
4. 写入 `ops-audit.json`：`{ action: 'reclaim', workerId, reason: 'heartbeat-stop', at }`

## 接替流程（replace + inherit）

1. ops 从可用 worker 池派遣一个新 worker（`replace`）
2. 新 worker 继承被回收任务的：
   - 任务列表（`tasks.json` 中其名下任务）
   - 已回传的 `report` 历史
   - `dependsOn` 依赖
3. 任务状态从 `backlog` → `assigned` → 新 worker `claim` → `running` 继续执行
4. `inheritedFrom` 记录前任 workerId，形成完整接替链
5. 写入 `ops-audit.json`：`{ action: 'replace', from: oldWorker, to: newWorker, inheritedTasks: [...] }`

## 不中断原则

- 回收/接替只影响死亡 worker 名下任务
- 其他 worker 不受影响，继续执行
- 整个蜂群不需要重启，任务续跑

## 状态查询

`swarm-status` 返回：
- 所有 worker 的心跳状态（green/yellow/red/dead）
- 所有任务的红绿灯
- ops 接管历史（回收/接替/继承）
