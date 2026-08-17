---
name: blueprint
description: 把一个目标编译为可执行、可验证、可追溯的工程蓝图（确定性检查节点/依赖/验收标准/合同）。Compile one goal into an executable, verifiable, traceable engineering blueprint with deterministic checks. Превращает цель в исполняемый, проверяемый инженерный план с узлами, зависимостями, критериями приёмки и валидацией.
---

# Blueprint Skill

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
3. Do not compile a Blueprint until all required questions are answered.
4. Build a Blueprint conforming to `blueprint.ir/1.0`, then call `validate`.
5. Fix every validation finding until the report is green, then call `compile-inline` and save the artifacts.

## Safety rules

- Never send credentials, model keys, provider endpoints, or personal secrets inside the request envelope or `input`.
- The response `status` must be `succeeded`; a `failed` response is an error, not a result.
- Public responses never prove that code was developed, tested, or deployed.
