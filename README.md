# cli-blueprint

**Blueprint skill 多 IDE 安装器** —— 一条命令从 cli.tax 拉取并分发到本机所有已装 IDE，可无限扩展。

```bash
npx cli-blueprint@latest install
```

默认包含：`blueprint`（CLI.Tax 工程规划 skill，`https://cli.tax/wvz6zmRWmX`）。

## 这是什么机制？

clitaxio 的本质只是从 `https://cli.tax/api/public/skills/{code}` 下载两个文件
（`SKILL.md` + `skill.json`）并写入 IDE 的 skills 目录。本包把这个过程**固化成一个可版本化、
可分发、可扩展的本地插件包**，并打通了 cli.tax 生态：

- **自动拉取**：`sources.json` 里配置 cli.tax skill 源（如 `wvz6zmRWmX`），
  `node install.mjs pull` 或 install 时自动从 cli.tax 拉取最新内容到 `skills/`（可提交进 git）
- **自动匹配分发**：每个 skill 是一个目录：`skills/<name>/SKILL.md`；安装器自动检测本机
  真实安装的 IDE，把 skill 分发到各 IDE 自己的用户级根（如 Codex 扫 `~/.codex/skills`、
  DSH 扫 `~/.dsh/skills`），各一份、互不干扰
- 共享兼容根 `~/.agents/skills` 默认跳过——它会被多个工具扫描，是"同一 skill 重复出现"的根源

**与 clitaxio 的区别**：clitaxio 只把 skill 装到**一个** IDE 目录；本包是"拉取 + 多 IDE 自动分发"，
装一次，本机所有已装 IDE 都能用。

## 安装 / 更新 / 卸载

```bash
# 本地运行（无需发布）
node install.mjs pull            # 从 cli.tax（sources.json）拉取最新 skill 到 skills/，可 git 提交
node install.mjs install         # 自动匹配：skills/ 为空时自动先 pull，再分发到本机已装 IDE
node install.mjs install --all   # 装到所有已知 IDE（不管是否安装）
node install.mjs install --ide codex --ide dsh   # 只装指定 IDE（可重复）
node install.mjs install --skip cursor       # 自动匹配但跳过指定 IDE（可重复）
node install.mjs install --pull  # 强制重新从 cli.tax 拉取后再安装
node install.mjs install --project  # 额外装到当前项目的项目级根
node install.mjs install --agents   # 额外装到共享 ~/.agents/skills（警告：可能被多工具重复发现）
node install.mjs install --target /abs/path      # 只装到自定义目录
node install.mjs update             # 幂等覆盖，等同 install
node install.mjs list               # 列出包内 skills
node install.mjs ides               # 查看已知 IDE 及本机检测结果（✓ = 本机已装）
node install.mjs uninstall          # 从相同目标卸载本包安装的 skills
```

**自动匹配说明**：默认安装会探测本机真实安装的 IDE（`which` 命令 / 应用路径 / 配置文件），
只装给已安装的 IDE，让每个 IDE 自己识别需要的 skill。用 `node install.mjs ides` 查看
本机检测结果（✓ = 已安装）。

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

## 分发给别人

### 方式 A：npm 一条命令（推荐，最简单）
已发布到 npm（`cli-blueprint@0.1.0`），使用者只需：
```bash
npx cli-blueprint@latest install
```
自动完成：从 cli.tax 拉取 blueprint → 检测本机已装 IDE → 分发到每个 IDE。
更新：同一命令（`@latest` 自动拉新版）。

### 方式 B：Git 仓库
```bash
git clone https://github.com/88208555/Blueprint-clitax.git
cd Blueprint-clitax
node install.mjs install
```
更新：`git pull && node install.mjs update`

### 方式 C：直接用 clitaxio（只装单个 IDE，作为对照）
```bash
npx clitaxio@latest install wvz6zmRWmX
```
> ⚠️ 注意：clitaxio **只把 skill 装到默认的 Codex 目录**（单一 IDE），不会自动检测/分发到
> 其他 IDE，也不处理 `~/.agents/skills` 共享根重复问题。需要多 IDE 分发请用方式 A/B。

## 目录结构

```
cli-blueprint/
├── install.mjs       # 安装器（Node ≥18，零依赖）：pull / install / uninstall / list / ides
├── sources.json      # ★ cli.tax skill 源清单（code → 自动拉取），扩展就加一行
├── package.json      # npm 包元数据（cli-blueprint）
├── README.md
└── skills/           # skill 内容（pull 生成，可提交 git 离线兜底）
    └── blueprint/
        ├── SKILL.md
        └── skill.json
```

## 无限扩展（加新 skill 两种方式）

**方式 A：从 cli.tax 拉取**（推荐）——`sources.json` 加一行：
```json
{ "cliTax": [
  { "code": "wvz6zmRWmX", "slug": "blueprint", "endpoint": "https://cli.tax/api/public/skills/{code}" },
  { "code": "你的新code", "slug": "新skill名", "endpoint": "https://cli.tax/api/public/skills/{code}" }
] }
```
然后 `node install.mjs pull` → 自动下载到 skills/。

**方式 B：本地手工写**——直接建 `skills/my-new-skill/SKILL.md`（frontmatter: `name` kebab-case + `description`）。

两种方式后都只需 `node install.mjs update` 同步到本机所有已装 IDE。

## 常见问题

- **装完当前会话没立刻出现？** skill 目录在会话初始化时注入，新会话即可发现；文件系统 watcher 也会自动感知变更。
- **Codex 里出现了 2 个同一个 skill？** 常见原因是同时存在 `~/.codex/skills/<name>` 和 `~/.agents/skills/<name>`（或 config.toml 注册条目）。本安装器默认不会装到 `~/.agents/skills`，避免此问题；如已发生，删除 `~/.agents/skills/<name>` 并清理 config.toml 中的 `[[skills.config]]` 条目即可。
- **想改 skill 内容？** 直接改 `skills/<name>/SKILL.md` 再 `update`，幂等覆盖。
- **命名要求？** 目录名即 skill 名，必须 kebab-case（如 `my-new-skill`）。
