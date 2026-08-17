---
name: "blueprint"
description: "Blueprint 是一个跨工具的工程规划 CLI，把明确目标编译为可执行、可追溯、可验收的全站工程蓝图，并通过确定性规则检查每个节点、分支、合同、任务与验收闭环。默认由当前 IDE 的多智能体协同推演，也可连接用户自行安装的本地 Hermes；平台不托管模型密钥。"
---

# blueprint

Use this Skill only when the user's request matches the capability described below.

## Capability

- Source type: Skill
- Version: v0.4.0
- Status at generation: published
- Address: `https://cli.tax/wvz6zmRWmX`
- Method: `POST`
- Content type: `application/json`

Blueprint 是一个跨工具的工程规划 CLI，把明确目标编译为可执行、可追溯、可验收的全站工程蓝图，并通过确定性规则检查每个节点、分支、合同、任务与验收闭环。默认由当前 IDE 的多智能体协同推演，也可连接用户自行安装的本地 Hermes；平台不托管模型密钥。

## Invocation

Send JSON to the exact CLI address and put capability arguments inside `input`:

```json
{
  "input": {}
}
```

Do not rewrite the CLI address, invent parameters, or include API keys, tokens, cookies, passwords, or private keys. Ask for missing non-secret inputs. Runtime invocation is available only after the CLI is published and the owner has an active subscription.

## Errors

- `402`: subscription or quota unavailable
- `404`: CLI is unavailable or not published
- `422`: invalid input or contract
- `429`: rate or concurrency limit reached
- `5xx`: execution or upstream failure
