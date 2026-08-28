# cli-blueprint

Install and run the Blueprint skill from [CLI.Tax](https://cli.tax/blueprint).

```bash
npx cli-blueprint@latest install
```

Installs the Blueprint skill into the current IDE skills directory
(`$CODEX_HOME/skills/blueprint`, falling back to `.codex/skills/blueprint`),
so the IDE agent can discover the protocol and compile goals into
implementation-ready engineering blueprints.


也可以直接从 CLI.Tax 对象存储安装（与站点「安装命令」一致）：

```bash
npx https://cli.tax/cli-downloads/clitax-wvz6zmRWmX.tgz install
```

Source: https://github.com/88208555/blueprint-clitax.git

The live endpoint is `https://cli.tax/wvz6zmRWmX` and speaks
`blueprint.skill.request/1.0`.

## Restricted invocation and automatic evaluation

Use `npx cli-blueprint@latest invoke <operation> '<JSON object>'`, or send JSON stdin to `npx cli-blueprint@latest broker`. The broker itself needs only Brain Client HTTPS, its restricted identity file, and explicitly supplied paths; it does not need full-disk access. To keep the token inaccessible to the IDE, run the broker under a separate least-privilege account or sandbox service and expose only restricted IPC. Mode `0600` does not isolate two processes running as the same account.

The Brain Client server binds the real response and atomically persists the authoritative score and comment within the same runtime request, then returns a committed receipt. The broker verifies `feedbackReceiptId`, `feedbackInvocationId`, and the authoritative digest; it makes no second evaluation write and never creates a score or comment. Not-reported or incomplete validation, P0/P1 findings, blocked, and failed results cannot be positive. Missing credentials or receipts, digest mismatches, invalid responses, and HTTP failures fail explicitly.

The local CLI has no command for manually submitting a score or evaluation comment. Humans cannot choose a skill score or write skill evaluation content. Daily chat is outside the evaluation protocol.
