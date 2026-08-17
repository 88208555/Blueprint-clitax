# 红绿灯状态机与事件流（traffic-light）

每个任务与每个智能体都有实时红/黄/绿状态，进度与错误持续上报。

## 状态定义

| 灯 | 含义 | 适用 |
|---|---|---|
| 🟢 green | 健康 / 完成 | 任务 accepted / 智能体心跳正常且进度正常 |
| 🟡 yellow | 风险 / 延迟 | 任务 running 但超过预计时长 / 依赖未就绪 / 重试中 |
| 🔴 red | 阻塞 / 失败 / 死亡 | 任务 failed/blocked / 智能体心跳停止 |

## 智能体健康（由 ops 维护）

```json
{
  "agentId": "worker-0001",
  "role": "worker",
  "status": "green",
  "lastHeartbeatAt": "2026-08-17T12:00:00Z",
  "heartbeatMisses": 0,
  "currentTaskId": "task-0001",
  "progressPercent": 45
}
```

- 心跳间隔：默认 30s
- 连续缺失 > 3 次 → status = red（死亡），触发 ops 回收
- 单次缺失 → yellow（风险）

## 事件流

每个状态变化产生事件：

```json
{
  "eventId": "evt-0001",
  "type": "traffic-light-changed",
  "subject": "task-0001",
  "from": "yellow",
  "to": "red",
  "reason": "heartbeat-stop",
  "at": "2026-08-17T12:03:00Z"
}
```

可查询：`swarm-status` 返回全部任务与智能体的红绿灯快照。

## 汇报

- 进度：`progressPercent` + `progressNote`（执行中持续上报）
- 错误：`report` 失败时带错误码 + 消息，灯转红/黄，可重试或转派
