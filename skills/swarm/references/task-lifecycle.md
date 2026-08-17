# 任务生命周期（task-lifecycle）

围绕项目 JSON 的任务全生命周期：派单 → 认领 → 执行 → 回传 → 验收，以及运维接替时的继承。

## 状态机

```
          dispatch          claim           execute          report          accept
  backlog ────────► assigned ───────► claimed ───────► running ───────► reported ───────► accepted
     │                │                │                │
     │                │                │                ├──► failed（可重试/转派）
     │                │                │                └──► blocked（红绿灯红）
     │                │                └──► stuck（心跳停止 → ops 收回 → 转派接替）
     └──► cancelled（决策层中止）
```

## 任务包字段（tasks.json）

```json
{
  "taskId": "task-0001",
  "title": "迁移模块 A",
  "owner": null,
  "status": "backlog",
  "priority": "high",
  "dependsOn": ["task-0000"],
  "assignedBy": null,
  "claimedAt": null,
  "reportedAt": null,
  "report": null,
  "inheritedFrom": null
}
```

## 动作

| 动作 | 调用方 | 前置条件 | 效果 |
|---|---|---|---|
| `dispatch` | dispatcher | 任务在 backlog | 状态 → assigned，记录 assignedBy |
| `claim` | worker | 任务在 assigned | 状态 → claimed，绑定 owner，记录 claimedAt |
| `report` | worker | 任务在 claimed/running | 写入 report，状态 → reported |
| `accept` | board | 任务在 reported | 状态 → accepted |
| `reject` | board | 任务在 reported | 状态 → failed（可重派） |
| `reclaim` | ops | 心跳停止/卡死 | 清空 owner，状态 → backlog（可再派） |
| `cancel` | board | 任意非终态 | 状态 → cancelled |

## 继承（继承原任务列表继续执行）

运维接替时，新 worker 继承：
- 原任务的 `report` 历史（已回传部分不丢失）
- 原任务的 `dependsOn` 依赖
- 原任务状态从 `claimed/running` 恢复，`inheritedFrom` 记录前任
- 新 worker 可查看前任回传继续执行，不重复已完成部分
