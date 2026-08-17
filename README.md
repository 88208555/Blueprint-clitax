# dsh-skillpack

**多 IDE 通用 skill 插件包** —— 一键安装 / 更新 / 卸载一组 skills，自动适配你本机已安装的每个 IDE，可无限扩展，可分发给任何人。

默认包含：`blueprint`（CLI.Tax 工程规划 skill，`https://cli.tax/wvz6zmRWmX`）。

## 这是什么机制？

clitaxio 的本质只是从 `https://cli.tax/api/public/skills/{code}` 下载两个文件
（`SKILL.md` + `skill.json`）并写入 IDE 的 skills 目录。本包把这个过程**固化成一个可版本化、
可分发、可扩展的本地插件包**：

- 每个 skill 是一个目录：`skills/<name>/SKILL.md`（+ 可选 `skill.json`、`references/`、`scripts/` 等）
- 每个 IDE 都从**它自己的用户级根**发现 skill（如 Codex 扫 `~/.codex/skills`、DSH 扫 `~/.dsh/skills`），
  安装器按此约定把 skill 分发到每个已安装的 IDE，各一份、互不干扰
- 共享兼容根 `~/.agents/skills` 默认跳过——它会被多个工具扫描，是"同一 skill 重复出现"的根源

## 安装 / 更新 / 卸载

```bash
# 本地运行（无需发布）
node install.mjs install            # 默认装到所有已知 IDE 的用户级根（全球通用安装位置）
node install.mjs install --only-installed   # 只装本机已检测到的 IDE
node install.mjs install --ide codex --ide dsh   # 只装指定 IDE（可重复）
node install.mjs install --skip cursor       # 装全部但跳过指定 IDE（可重复）
node install.mjs install --project  # 额外装到当前项目的项目级根
node install.mjs install --agents   # 额外装到共享 ~/.agents/skills（警告：可能被多工具重复发现）
node install.mjs install --target /abs/path      # 只装到自定义目录
node install.mjs update             # 幂等覆盖，等同 install
node install.mjs list               # 列出包内 skills
node install.mjs ides               # 查看已知 IDE 及本机检测结果
node install.mjs uninstall          # 从相同目标卸载本包安装的 skills
```

## 支持的 IDE（全世界已知安装位置，官方文档核实）

| IDE | 用户级根 | 项目级根 | 说明 |
|---|---|---|---|
| Codex CLI | `~/.codex/skills` | `.codex/skills` | 新官方约定 `~/.agents/skills`；此处用专属根避免共享冲突 |
| DSH | `~/.dsh/skills` | `.dsh/skills` | skill-filesystem 自动扫描 |
| Claude Code | `~/.claude/skills` | `.claude/skills` | 父目录向上扫描至 repo root |
| Gemini CLI | `~/.gemini/skills` | `.gemini/skills` | 别名 `.agents/skills` 优先级更高 |
| Google Antigravity | `~/.gemini/antigravity/skills` | `.agents/skills`（随 --agents） | workspace 级固定用 agents 标准 |
| Cursor | `~/.cursor/skills` | `.cursor/skills` | 兼容加载 .claude/.codex/.agents/skills |
| Cline | `~/.cline/skills` | `.cline/skills` | 全局优先于项目 |
| Roo Code | `~/.roo/skills` | `.roo/skills` | 项目覆盖全局 |
| Kilo Code | `~/.kilo/skills` | `.kilo/skills` | kilo.jsonc 可配 |
| Windsurf | `~/.codeium/windsurf/skills` | `.windsurf/skills` | Cascade Skills |
| VS Code / Copilot | `~/.copilot/skills` | `.github/skills` | 另兼容 .claude/skills |
| Trae | `~/.trae-cn/skills`（国内版） | `.trae/skills` | 国际版用户级未确认 |
| Qwen Code | `~/.qwen/skills` | `.qwen/skills` | 模型自动调用 |
| OpenCode | `~/.config/opencode/skills` | `.opencode/skills` | 兼容 .claude/.agents |
| Zed | `~/.agents/skills`（仅 --agents） | `.agents/skills`（仅 --agents） | 官方即用 agents 标准根 |
| Amazon Q | 无 skills 机制 | 无 skills 机制 | 官方确认不支持 SKILL.md |

> 跨工具互操作标准根 `~/.agents/skills`（agentskills.io）：Codex 新约定、Gemini、Zed、
> OpenCode、Cursor、Antigravity、Kilo 等都支持，但会被**多个工具同时扫描**——同一 skill
> 装进去会在各工具中重复出现。本安装器默认跳过它（`--agents` 显式开启并警告）。
>
> 新增 IDE：在 `install.mjs` 的 `IDES` 数组加一行即可，其余逻辑自动生效。

## 无限扩展（往包里加 skill）

1. 新建目录：`skills/my-new-skill/SKILL.md`
2. 按 skill 格式写 frontmatter（`name` 必须 kebab-case，含 `description`）：
   ```markdown
   ---
   name: "my-new-skill"
   description: "做什么用的，何时使用。"
   ---
   # my-new-skill
   （正文：给 agent 的完整指令）
   ```
3. 重跑 `node install.mjs update` —— 新 skill 立即可用，旧的不受影响。

## 分发给别人

### 方式 A：Git 仓库（推荐，最简单）
把本目录推到一个 git 仓库，使用者：
```bash
git clone <repo-url> && cd dsh-skillpack && node install.mjs install
```
更新：`git pull && node install.mjs update`

### 方式 B：发布为 npm 包（一条命令装）
本包已配好 `bin`，发布后使用者只需：
```bash
npx dsh-skillpack@latest install
```
更新：同一命令（`@latest` 自动拉新版）。
> 注意 npm 官方源对包名唯一性有要求；内部使用可部署私有 registry（如 Verdaccio）。

### 方式 C：直接用 clitaxio（如果只想引第三方 skill）
```bash
npx clitaxio@latest install <runtime-code> ~/.codex/skills/<slug>
```
本包是更可控的本地化替代：离线可用、可审计、可 git 管理、可批量管理多个 skill、自动多 IDE 分发。

## 目录结构

```
dsh-skillpack/
├── install.mjs       # 安装器（Node ≥18，零依赖）
├── package.json      # npm 包元数据（可发布）
├── README.md
└── skills/           # ★ 所有 skill 的源目录，扩展就加子目录
    └── blueprint/
        ├── SKILL.md
        └── skill.json
```

## 常见问题

- **装完当前会话没立刻出现？** skill 目录在会话初始化时注入，新会话即可发现；文件系统 watcher 也会自动感知变更。
- **Codex 里出现了 2 个同一个 skill？** 常见原因是同时存在 `~/.codex/skills/<name>` 和 `~/.agents/skills/<name>`（或 config.toml 注册条目）。本安装器默认不会装到 `~/.agents/skills`，避免此问题；如已发生，删除 `~/.agents/skills/<name>` 并清理 config.toml 中的 `[[skills.config]]` 条目即可。
- **想改 skill 内容？** 直接改 `skills/<name>/SKILL.md` 再 `update`，幂等覆盖。
- **命名要求？** 目录名即 skill 名，必须 kebab-case（如 `my-new-skill`）。
