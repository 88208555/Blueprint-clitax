---
name: blueprint
description: '把一个目标编译为可执行、可验证、可追溯的工程蓝图（确定性检查节点/依赖/验收标准/合同）。Compile one goal into an executable, verifiable, traceable engineering blueprint with deterministic checks. Превращает цель в исполняемый, проверяемый инженерный план с узлами, зависимостями, критериями приёмки и валидацией.'
---

# Blueprint Skill

Package version: v7.0.41

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
- `compile-inline`: validate and compile a Blueprint, returning artifacts and a deterministic Swarm machine task package inline.
- `acceptance-report`: recompile the referenced Blueprint and reconcile every acceptance criterion with supplied TestEvidence.

## Required flow

1. Call `capabilities` first and read the returned `nextStep`.
2. Call `intake` and ask the user the returned questions one at a time, waiting for each answer.
   For a new code project, require the ArchGuard contract digest created before planning. For an existing project, preserve an existing `arch.contract.yaml` digest in the Blueprint inputs; if no contract exists, record a non-blocking recommendation instead of inventing one.
3. Do not compile a Blueprint until all required questions are answered.
4. Build a Blueprint conforming to `blueprint.ir/1.0`, then call `validate`.
5. Fix every validation finding until the report is green, then call `compile-inline` and save the artifacts.
6. Bind `response.machineTasks` to Swarm `validate-json.input.project`; bind `response.machineTasks.tasks` to the first `dispatch.input.tasks`. Pass each real Swarm response's complete tasks array to the next mutation. There is no separate Swarm import operation.
7. After actual execution, call `acceptance-report` with the same Blueprint, its original `machineTasks.blueprintSha256`, and one evidence result for every criterion. A reported pass checks structure and coverage; execution provenance remains the caller's responsibility.

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
| B4 | 验收回传、开放问题闭环、Validator 桥接 | 部分实现 | `acceptance-report` 已逐项核对共享 TestEvidence；`answer-questions` 与自动调用 Validator 仍未实现。 |

只调用 `capabilities` 返回的六个操作。不要根据规划中条目构造请求，也不要把 npm 包版本 `v7.0.41` 与远端 Hermes 编译器版本 `0.4.0` 混为一谈。

## 机器任务与验收回传

`capabilities.operationSchemas[].inputSchema` 与 `help.operationSchemas[].inputSchema` 是可执行的 JSON Schema；公开操作拒绝未知输入字段。IR 内的扩展字段交给 Hermes 的既有语义校验，结构 Schema 不替代节点、边、追溯与环规则。

成功的 `compile-inline` 同时返回 `machineTasks` 和同内容的 `IMPLEMENTATION-TASKS.json`。后者也登记于 `ARTIFACT-MANIFEST.json`。机器包格式为 `swarm.project/1.0`，含 `blueprintId`、`revision`、`blueprintSha256`、`entryTaskId`、`tasks` 与 `acceptanceCriteria`。

- `blueprintSha256` 是原 `PROJECT-BLUEPRINT.json` 工件的 `sha256:<64hex>`，调用方必须原样传递。
- `tasks` 包含 `taskId/title/status/owner/dependsOn/nodeRefs/acceptanceRefs/internalEdgeRefs`；初始状态为 `backlog`，`owner` 为 `null`。
- 任务依赖采用所有 IR 连线的保守顺序。显式有界循环的强连通节点合并为一个实现任务，组内边保存在 `internalEdgeRefs` 并可追溯原 IR；跨组边成为 `dependsOn`，不会生成 Swarm 依赖环。
- 任务 ID 为 `bp-` 加排序后的 `nodeRefs` JSON 的 SHA-256 前 40 位，节点顺序改变不会重编号。验收项 `criterionId` 原样保留 IR 的 `acceptanceCriteria.id`；`taskRefs` 指向对应机器任务。
- 该包表达实现计划，不证明代码已执行。具体执行步骤由调用方显式定义，不根据文案 `nextStep` 猜测执行。

`acceptance-report.input`：

```json
{
  "blueprint": "<原 blueprint.ir/1.0 对象>",
  "blueprintSha256": "<原 PROJECT-BLUEPRINT.json 的 sha256:...>",
  "results": [
    {
      "criterionId": "<原验收项 id>",
      "evidence": [
        {
          "schemaVersion": "cli.tax.test-evidence/1.0",
          "evidenceId": "<实际执行证据 id>",
          "kind": "test",
          "runner": "local",
          "command": "<实际执行命令>",
          "exitCode": 0,
          "durationMs": 12,
          "summary": "<实际执行摘要>",
          "artifactSha256": "<可选，小写 64 位裸 SHA>"
        }
      ]
    }
  ]
}
```

以上占位文字仅为字段说明，不能作为执行证据提交。每个验收项必须恰好一条结果，证据数组非空且全部退出码为 0。未知或重复验收项、缺失或重复证据、错误格式、非零退出码以及蓝图哈希不一致，均返回 `blocked`。返回 `ACCEPTANCE-REPORT.json` 与逐项 `acceptanceReport.criteria`，并明确 `verificationMode=caller-supplied-test-evidence`、`executionVerified=false`；本地 CLI、受信执行器的日志与产物才是实际执行来源。

## 受限调用与自动评价闭环

- IDE / 智能体必须通过本包 `invoke` 或 JSON-stdin `broker` 调用，不得直接拼装技能 HTTP 请求，也不得读取 BrainClient token。
- broker 默认读取账号共享凭据文件；显式 `CLITAX_BRAIN_CLIENT_TOKEN_FILE` 使用绝对路径覆盖；macOS/Linux 文件必须为当前 broker 账户所有且权限 `0600`，Windows 文件必须位于受限 `%LOCALAPPDATA%\CLI.Tax\broker` 目录。
- broker 只需要 Brain Client HTTPS、受限身份文件和调用方显式传入的路径，本身不需要完整磁盘访问。若要保证 IDE 无法读取身份文件，必须把 broker 放进独立低权限系统账户或沙箱服务，并只暴露受限 IPC；broker 与 IDE 同账户运行时，`0600` 不能隔离二者，禁止声称令牌已隔离。
- broker 只用 `Authorization: BrainClient …` 发起一次 runtime 请求。HTTP 成功后必须保留响应顶层原始 `feedbackReceiptId`、`feedbackInvocationId` 和 `feedbackEvaluation.digest`，不得生成、猜测、复用或跨调用转移。
- Brain Client 服务端必须严格绑定请求/响应的 `requestId` 和 `schemaVersion`，再根据真实状态、验证结果、服务端耗时与 findings 生成并持久化权威评分、评语和摘要。broker 不得生成分数或评语。
- 同一次 runtime 请求在服务端事务内生成并持久化评价，再返回 `feedbackReceiptId`、`feedbackInvocationId` 和权威摘要；broker 只验证已提交回执，不发起第二次评价写入。`not-reported`、验证不完整、P0/P1 findings、`blocked` 或 `failed` 都不得生成好评。
- 缺少凭证或 ID、身份不匹配、摘要不匹配、响应非法以及任何 HTTP 失败都必须显式失败，不得静默、不重试成重复评价。
- 本地 CLI 不提供手工评分或评语提交命令，人类不得选择技能分数或填写技能评价；日常聊天不属于评价协议。

调用示例：`npx cli-blueprint@latest invoke <operation> '<JSON对象>'`。IDE 集成可向 `npx cli-blueprint@latest broker` 的 stdin 发送 `{"operation":"capabilities","input":{}}`。

## 网络中断与原回执恢复

仅在 TLS 握手前确定尚未发送 HTTP 请求时，broker 才允许最多 3 次连接尝试，并受总超时约束。请求发出后发生断线或响应中断，只用 GET 查询原 requestId 的服务端回执，禁止重发 POST；未取得有效回执时保留不确定状态，不得假定成功或继续依赖步骤。

`npx cli-blueprint@latest recover <operation> <requestId>` 可重新查询原调用，不会重做操作或重复计费。链恢复不会跳过人工确认，也不会自动重跑结果不确定的本地命令。代理连接需 Node.js 22.21+ 或 24.5+；不支持的运行时会明确报错。

## 执行完整性共同规则

1. 工程目标、已接受范围和验收项必须持久化；新增需求先路由与合并，不能覆盖原目标。子任务有明确服务目标的理由，执行仅用本链已匹配技能。每次恢复读取 task-resume，核对剩余项、pending请求和continuationNotifications。
2. 默认由主代理完成工作，禁止为了省事创建子代理、把简单查找/改名/少量修改/单条命令/例行检查/汇总交接给多智能体，禁止为达到门槛拆分或夸大任务。启用Aimlock或Swarm模式不是创建授权，管理/运维/安全/协调是主代理职责，不额外创建常驻智能体。只有业务确需独立且实质性的交付、主代理同时有可推进的独立工作、预期收益严格高于上下文传递/协调/验收成本时才派单；复用已有合适负责人，用户禁止委派时不得创建。每次创建前记录业务理由、交付物、验收项、主代理工作、成本收益、精确路径和原负责人；只创建当前需要的最少数量，不预建空闲角色，不递归扩编或重复扫描。规模门槛200行/3文件/跨模块仅为必要条件，不能单独证明值得委派。主代理负责整合和完整验收，不把半成品当完成；预算抱怨不是停止指令。
3. 自报、回复送达和动作完成不等于工程交付验证。reported始终待验收；Swarm接受工程任务时复用Validator校验签名、有效期、计划/产物/任务绑定。无证据、伪造runner或失败检查不得成为绿色完成。
4. 原任务交接前保存检查点并释放旧锁；回程只发持久通知，宿主消费后重新核验基线、快照与写入权限。历史恢复结果不是新授权。技能不能自行唤醒未接入的IDE。
5. 心跳停止仅允许自动回收尚未开工的assigned任务；claimed/running进入执行结果待核对状态，禁止盲目重复执行。已回传、已验收、失败和取消任务不会被自动重派。服务器停滞回收同时保存会员通知，对话界面定期读取展示。
6. 读取预算、截止和续时确认仅在云端沙箱已开启且本任务实际使用 sandbox 时生效。纯本地或权威响应确认的非沙箱执行，在已授权目标和范围内自动持续，不因旧预算过期、文件数或token额度暂停，也不生成扩展或续时确认；宿主可保留budget-read审计。远端状态未知时只读查询原调用，不推定关闭，不要求扩预算；纯本地无需查询云端。仅实际沙箱内预计长任务在预算初始化后、深读前提出一次精确自动续时策略，真实授权后才自动续时；时间、文件数、token和写入权限分别计量，额度/次数耗尽、撤销和完成保留明确停止规则。读取预算不是付费充值，续时由宿主在读取时触发。
7. 云端沙箱开关按调用会员读取；关闭时仅允许当前受审官方源码摘要在受控worker中直接执行，并记录executionIsolation。预算上下文取同一任务成功runtime响应顶层executionContext，包含cloudSandboxEnabled与executionIsolation；仅true且sandbox启用预算，不用模型自报、调用方参数或旧截图代替真实执行状态。纯本地显式使用{executionIsolation:"local"}；已有预算通过budget-context绑定或更新实际环境，保留原用量、期限和授权。未知或修改过的源码明确要求sandbox，不伪造隔离结果；worker直接执行不是OS沙箱。
8. 使用技能前检查官方发布版本并自动升级可管理的安装副本与客户端；配置失败或升级失败停止并报告。通过configure的JSON标准输入导入一次账号凭据，后续项目/分支/任务共享；密钥不进入源码、URL或命令参数。显式环境覆盖必须是绝对路径。网页复制在点击时获取当前凭据，页面仅展示无密钥地址；已撤销密钥没有权限自动获取新密钥，需已认证网页重新同步一次。

English: keep simple work with the main agent. Delegate only substantial independent business deliverables when benefits exceed coordination costs; use the fewest needed agents, never create idle management agents. Enabling Aimlock does not authorize delegation. Finish all authorized work; a cost complaint is not a stop request. Preserve the original goal; verify execution evidence; resume from durable checkpoints; never replay uncertain side effects. Read budgets and bounded renewal approvals apply only when cloud sandboxing is enabled and actually used for this task. Local or confirmed non-sandbox work continues within its authorized scope without budget prompts; unknown remote state requires a read-only query, never an assumed opt-out or an extension request. Reuse account credentials and check managed skill updates before use; revoked credentials require an authenticated refresh.

Русский: сохраняйте исходную цель, проверяйте доказательства выполнения и возобновляйте работу из сохранённой точки. Не повторяйте операции с неизвестным результатом. Бюджет чтения и ограниченное разрешение на продление действуют только при включённой облачной песочнице, фактически используемой этой задачей. Локальная работа и подтверждённое выполнение без песочницы продолжаются в разрешённых пределах без запросов бюджета; неизвестное удалённое состояние требует запроса только для чтения, а не предположения об отключении или запроса расширения. Ключи учётной записи используются повторно, обновления навыков проверяются перед вызовом.

## 账号共享凭据与自动更新

在已登录的能力市场复制安装入口，将内容粘贴给 IDE。页面只展示原地址，剪贴板会携带当前账号凭据。IDE 将四字段凭据 JSON 经标准输入交给 `npx cli-aimlock@latest configure`；不要放到命令参数、项目文件或日志中。一次配置供同一操作系统账号的所有项目、分支和任务使用，八个技能共享同一文件。

默认位置：macOS 为 `~/Library/Application Support/CLI.Tax/broker/credential.json`，Linux 为 `~/.local/share/CLI.Tax/broker/credential.json`，Windows 为 `%LOCALAPPDATA%\CLI.Tax\broker\credential.json`。显式 `CLITAX_BRAIN_CLIENT_TOKEN_FILE` 仍按绝对路径覆盖默认位置；迁移旧 IDE 配置时移除其过时覆盖，再使用账号共享文件。macOS/Linux 校验当前账号所有权和0600权限；Windows校验仅当前账号与SYSTEM可访问的ACL。

每次新技能调用先查询官方发布版本，精确版本下载并校验身份后自动使用；更新已托管的当前项目与账号技能目录，失败恢复旧目录，禁止覆盖 Git 跟踪源码或未托管内容。升级返回 `upgrade.reloadRequired` 和说明路径时，IDE 应读取更新后的 SKILL.md、核对本任务合同再继续。install/check同样自动更新，不需要每次人工发升级指令。查询不确定调用的原回执不升级、不重发操作。

升级不会清除账号凭据；各调用重新读取共享文件，因此重新同步一次密钥后所有任务使用新值。已撤销或失效的密钥不能为自己取得新权限，必须从已认证网页重新同步一次。两个不同操作系统账号不共享私密文件。

English: configure once using JSON stdin; all tasks under the same OS account reuse the credential. Each new invocation checks and updates the official package and managed documentation. Reload updated instructions when indicated. Revoked keys require a fresh authenticated copy.

Русский: настройте ключ один раз через JSON stdin для всех задач пользователя ОС. Перед новым вызовом пакет и управляемые инструкции обновляются автоматически. Отозванный ключ требует повторной синхронизации с авторизованной страницы.
