---
name: blueprint
description: '把一个目标编译为可执行、可验证、可追溯的工程蓝图（确定性检查节点/依赖/验收标准/合同）。Compile one goal into an executable, verifiable, traceable engineering blueprint with deterministic checks. Превращает цель в исполняемый, проверяемый инженерный план с узлами, зависимостями, критериями приёмки и валидацией.'
---

# Blueprint Skill

Package version: v7.0.28

远端 Hermes 编译器版本：0.4.0（独立于 npm 包版本）

Endpoint: https://cli.tax/wvz6zmRWmX
Request schema: blueprint.skill.request/1.0
Response schema: blueprint.skill.response/1.0

## Request envelope

POST JSON to the endpoint with an `input` wrapper:

```json
{
  "input": {
    "schemaVersion": "blueprint.skill.request/1.0",
    "requestId": "<unique-id>",
    "operation": "<operation>",
    "input": {}
  }
}
```

## Operations

- `capabilities`: discover the operation list, per-operation inputs, and the recommended next step.
- `help`: return the usage guide, operation catalog, and request examples.
- `intake`: return the questions the IDE must ask the user before building the Blueprint.
- `validate`: deterministically validate a Blueprint object conforming to `blueprint.ir/1.0`.
- `compile-inline`: validate and compile a Blueprint, returning the generated artifacts inline.

## Required flow

1. Call `capabilities` first and read the returned `nextStep`.
2. Call `intake` and ask the user the returned questions one at a time, waiting for each answer.
   For a new code project, require the ArchGuard contract digest created before planning. For an existing project, preserve an existing `arch.contract.yaml` digest in the Blueprint inputs; if no contract exists, record a non-blocking recommendation instead of inventing one.
3. Do not compile a Blueprint until all required questions are answered.
4. Build a Blueprint conforming to `blueprint.ir/1.0`, then call `validate`.
5. Fix every validation finding until the report is green, then call `compile-inline` and save the artifacts.

## Official catalog hops

After `capabilities`, read `officialCatalog`. Default allowlist is official skills. Call another skill only when its capability matches this demand. User-named extras enter only when the user names them; then confirm that skill's capabilities before invoke. Do not call chain-unrelated or self-extended skills.

## Safety rules

- Never send credentials, model keys, provider endpoints, or personal secrets inside the request envelope or `input`.
- The response `status` must be `succeeded`; a `failed` response is an error, not a result.
- Public responses never prove that code was developed, tested, or deployed.

## IR Schema 完整文档（blueprint.ir/1.0）

### 顶层结构

```json
{
  "schemaVersion": "blueprint.ir/1.0",  // 必填，必须是这个值
  "blueprintId": "string",               // 必填，kebab-case
  "title": "string",                     // 必填
  "revision": 0,                         // 必填，非负整数（0, 1, 2...）
  "entryNodeId": "string",              // 必填，指向 nodes 中 entry:true 的节点
  "baseline": {
    "summary": "string",                // 必填
    "facts": [                           // 必填，对象数组
      {
        "id": "string",                  // 每个 fact 必须有 id
        "statement": "string",           // 必填
        "status": "confirmed"            // 必填枚举，见下方
      }
    ]
  },
  "domains": [                           // 必填
    {
      "id": "string",
      "name": "string",
      "summary": "string"                // 可选
    }
  ],
  "modules": [                           // 必填
    {
      "id": "string",                    // 必填
      "domainId": "string",              // 必填，引用 domains.id
      "name": "string"
    }
  ],
  "nodes": [                             // 必填，非空
    {
      "id": "string",                    // 注意：是 id 不是 nodeId
      "entry": true,                     // true 标记入口节点（且仅一个）
      "moduleId": "string",              // 引用 modules.id
      "title": "string",                 // 必填
      "inputs": [                        // 必须是命名对象数组，字符串数组被拒
        { "name": "string" }
      ],
      "outputs": [                       // 同上
        { "name": "string", "exposed": true }
      ],
      "requirementRefs": ["string"]      // 引用 baseline.facts.id
    }
  ],
  "edges": [                             // 必填
    {
      "id": "string",
      "fromNodeId": "string",            // 引用 nodes.id
      "toNodeId": "string",              // 引用 nodes.id
      "type": "data",                    // 必填枚举，见下方
      "fromOutput": "string",            // 数据边必须精确到端口名
      "toInput": "string",               // 数据边必须精确到端口名
      "allowCycle": true,                // 环边必须 true
      "loopGuard": "string",             // 环边必须有文字说明
      "loopLimit": {                     // 环边必须有迭代上限
        "maxIterations": 10
      }
    }
  ],
  "acceptanceCriteria": [                // 必填
    {
      "id": "string",
      "statement": "string",
      "nodeRefs": ["string"]             // 引用 nodes.id，无 nodeRefs 视为未链接（P1）
    }
  ]
}
```

### 字段枚举值

**fact.status**：`"confirmed"` | `"inferred"` | `"defaulted"` | `"unknown"` | `"conflicted"` | `"rejected"`

**edge.type**：`"data"` | `"control"` | `"success"` | `"error"` | `"trace"` | `"event"` | `"approval"` | `"recovery"` | `"audit"` | `"optional"` | `"compensation"`

> ⚠️ `"depends-on"` 不被接受，必须使用上述合法枚举值。

### 校验规则

- **节点覆盖**：每个节点必须被至少一条 acceptanceCriteria 覆盖（通过 `nodeRefs`）
- **事实追溯**：每个 fact 必须追溯到节点（通过 `nodes.requirementRefs`）
- **入口节点**：仅一个节点 `entry: true`，且必须是 `entryNodeId` 指向的节点
- **数据边**：必须 `fromOutput` / `toInput` 精确匹配端口名
- **控制边**：不需要端口级连线
- **环边**：`type` 必须是 `"control"` 或 `"optional"`，必须同时包含 `allowCycle: true` + `loopGuard`（文字说明）+ `loopLimit`（含 `maxIterations` 数字）

### 最小合法示例

```json
{
  "schemaVersion": "blueprint.ir/1.0",
  "blueprintId": "demo-pipeline",
  "title": "Demo Pipeline",
  "revision": 0,
  "entryNodeId": "step-a",
  "baseline": {
    "summary": "A minimal 2-node linear pipeline",
    "facts": [
      {
        "id": "f-input",
        "statement": "System must accept user input",
        "status": "confirmed"
      }
    ]
  },
  "domains": [
    {
      "id": "d-core",
      "name": "Core"
    }
  ],
  "modules": [
    {
      "id": "m-impl",
      "domainId": "d-core",
      "name": "Implementation"
    }
  ],
  "nodes": [
    {
      "id": "step-a",
      "entry": true,
      "moduleId": "m-impl",
      "title": "Step A – Receive Input",
      "inputs": [],
      "outputs": [
        { "name": "data" }
      ],
      "requirementRefs": ["f-input"]
    },
    {
      "id": "step-b",
      "moduleId": "m-impl",
      "title": "Step B – Process",
      "inputs": [
        { "name": "data" }
      ],
      "outputs": []
    }
  ],
  "edges": [
    {
      "id": "e-a-to-b",
      "fromNodeId": "step-a",
      "toNodeId": "step-b",
      "type": "data",
      "fromOutput": "data",
      "toInput": "data"
    }
  ],
  "acceptanceCriteria": [
    {
      "id": "ac-step-a",
      "statement": "Input is received and forwarded",
      "nodeRefs": ["step-a"]
    },
    {
      "id": "ac-step-b",
      "statement": "Processing completes successfully",
      "nodeRefs": ["step-b"]
    }
  ]
}
```

## Finding 修复循环

`validate` 与 `compile-inline` 的确定性报告位于 `validation.findings`。每条 Finding 包含 `ruleId`、`severity`、`entityRef`、`message`、`evidence` 与 `recommendedAction`。调用方必须按 `recommendedAction` 修复对应实体并重新 `validate`，不得把 `blocked` 当成编译结果。

```json
{
  "ruleId": "IR_REQUIRED_FIELD",
  "severity": "P0",
  "entityRef": "blueprint.title",
  "message": "title is required.",
  "evidence": {},
  "recommendedAction": "Add a human-readable title."
}
```

## 实现状态

| ID | 能力 | 状态 | 边界 |
|---|---|---|---|
| B1 | 结构校验与可修复 Finding | 已实现 | `evidence` 与 `recommendedAction` 已由远端 Hermes 0.4.0 返回。 |
| B2 | 增量规划/修订 | 部分实现 | IR 支持调用方维护 `revision`；服务端不保存蓝图，也没有增量更新操作。 |
| B3 | 业务模板库与粗粒度模式 | 规划中 | 当前没有模板操作，`template` 与 `coarseMode` 均不是受支持输入。 |
| B4 | 验收回传、开放问题闭环、Validator 桥接 | 规划中 | 当前没有 `acceptance-report`、`answer-questions` 或 Validator 桥接操作。 |

只调用 `capabilities` 返回的五个操作。不要根据规划中条目构造请求，也不要把 npm 包版本 `v7.0.28` 与远端 Hermes 编译器版本 `0.4.0` 混为一谈。

## 受限调用与自动评价闭环

- IDE / 智能体必须通过本包 `invoke` 或 JSON-stdin `broker` 调用，不得直接拼装技能 HTTP 请求，也不得读取 BrainClient token。
- broker 从 `CLITAX_BRAIN_CLIENT_TOKEN_FILE` 读取身份；macOS/Linux 文件必须为当前 broker 账户所有且权限 `0600`，Windows 文件必须位于受限 `%LOCALAPPDATA%\CLI.Tax\broker` 目录。
- broker 只需要 Brain Client HTTPS、受限身份文件和调用方显式传入的路径，本身不需要完整磁盘访问。若要保证 IDE 无法读取身份文件，必须把 broker 放进独立低权限系统账户或沙箱服务，并只暴露受限 IPC；broker 与 IDE 同账户运行时，`0600` 不能隔离二者，禁止声称令牌已隔离。
- broker 只用 `Authorization: BrainClient …` 发起一次 runtime 请求。HTTP 成功后必须保留响应顶层原始 `feedbackReceiptId`、`feedbackInvocationId` 和 `feedbackEvaluation.digest`，不得生成、猜测、复用或跨调用转移。
- Brain Client 服务端必须严格绑定请求/响应的 `requestId` 和 `schemaVersion`，再根据真实状态、验证结果、服务端耗时与 findings 生成并持久化权威评分、评语和摘要。broker 不得生成分数或评语。
- 同一次 runtime 请求在服务端事务内生成并持久化评价，再返回 `feedbackReceiptId`、`feedbackInvocationId` 和权威摘要；broker 只验证已提交回执，不发起第二次评价写入。`not-reported`、验证不完整、P0/P1 findings、`blocked` 或 `failed` 都不得生成好评。
- 缺少凭证或 ID、身份不匹配、摘要不匹配、响应非法以及任何 HTTP 失败都必须显式失败，不得静默、不重试成重复评价。
- 本地 CLI 不提供手工评分或评语提交命令，人类不得选择技能分数或填写技能评价；日常聊天不属于评价协议。

调用示例：`npx cli-blueprint@latest invoke <operation> '<JSON对象>'`。IDE 集成可向 `npx cli-blueprint@latest broker` 的 stdin 发送 `{"operation":"capabilities","input":{}}`。
