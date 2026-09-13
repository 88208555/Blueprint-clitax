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

## 网络中断与原回执恢复

仅在 TLS 握手前确定尚未发送 HTTP 请求时，broker 才允许最多 3 次连接尝试，并受总超时约束。请求发出后发生断线或响应中断，只用 GET 查询原 requestId 的服务端回执，禁止重发 POST；未取得有效回执时保留不确定状态，不得假定成功或继续依赖步骤。

`npx cli-blueprint@latest recover <operation> <requestId>` 可重新查询原调用，不会重做操作或重复计费。链恢复不会跳过人工确认，也不会自动重跑结果不确定的本地命令。代理连接需 Node.js 22.21+ 或 24.5+；不支持的运行时会明确报错。

## 账号共享凭据与自动更新

在已登录的能力市场复制安装入口，将内容粘贴给 IDE。页面只展示原地址，剪贴板会携带当前账号凭据。IDE 将四字段凭据 JSON 经标准输入交给 `npx cli-aimlock@latest configure`；不要放到命令参数、项目文件或日志中。一次配置供同一操作系统账号的所有项目、分支和任务使用，八个技能共享同一文件。

默认位置：macOS 为 `~/Library/Application Support/CLI.Tax/broker/credential.json`，Linux 为 `~/.local/share/CLI.Tax/broker/credential.json`，Windows 为 `%LOCALAPPDATA%\CLI.Tax\broker\credential.json`。显式 `CLITAX_BRAIN_CLIENT_TOKEN_FILE` 仍按绝对路径覆盖默认位置；迁移旧 IDE 配置时移除其过时覆盖，再使用账号共享文件。macOS/Linux 校验当前账号所有权和0600权限；Windows校验仅当前账号与SYSTEM可访问的ACL。

每次新技能调用先查询官方发布版本，精确版本下载并校验身份后自动使用；更新已托管的当前项目与账号技能目录，失败恢复旧目录，禁止覆盖 Git 跟踪源码或未托管内容。升级返回 `upgrade.reloadRequired` 和说明路径时，IDE 应读取更新后的 SKILL.md、核对本任务合同再继续。install/check同样自动更新，不需要每次人工发升级指令。查询不确定调用的原回执不升级、不重发操作。

升级不会清除账号凭据；各调用重新读取共享文件，因此重新同步一次密钥后所有任务使用新值。已撤销或失效的密钥不能为自己取得新权限，必须从已认证网页重新同步一次。两个不同操作系统账号不共享私密文件。

English: configure once using JSON stdin; all tasks under the same OS account reuse the credential. Each new invocation checks and updates the official package and managed documentation. Reload updated instructions when indicated. Revoked keys require a fresh authenticated copy.

Русский: настройте ключ один раз через JSON stdin для всех задач пользователя ОС. Перед новым вызовом пакет и управляемые инструкции обновляются автоматически. Отозванный ключ требует повторной синхронизации с авторизованной страницы.
