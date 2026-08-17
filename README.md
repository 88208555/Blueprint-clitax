# dsh-skillpack

**DSH 专属插件包** —— 一键安装 / 更新 / 卸载一组 DSH skills，可无限扩展，可分发给任何人。

默认包含：`blueprint`（CLI.Tax 工程规划 skill，`https://cli.tax/wvz6zmRWmX`）。

## 这是什么机制？

clitaxio 的本质只是从 `https://cli.tax/api/public/skills/{code}` 下载两个文件
（`SKILL.md` + `skill.json`）并写入 IDE 的 skills 目录。本包把这个过程**固化成一个可版本化、
可分发、可扩展的本地插件包**：

- 每个 skill 是一个目录：`skills/<name>/SKILL.md`（+ 可选 `skill.json`、`references/`、`scripts/` 等）
- DSH 的 `skill-filesystem` 提供方会自动扫描 `~/.dsh/skills`（用户级）、
  `<项目>/.dsh/skills`（项目级）、`<项目>/.agents/skills`，无需改代码
- 安装器只负责把 `skills/` 目录同步到这些目标

## 安装 / 更新 / 卸载

```bash
# 本地运行（无需发布）
node install.mjs install            # 默认装到 用户级 + 项目级 + codex 三个目标
node install.mjs install --user     # 只装用户级 ~/.dsh/skills（推荐：全局可用）
node install.mjs install --project  # 只装当前项目 .dsh/skills
node install.mjs update             # 幂等覆盖，等同 install
node install.mjs list               # 列出包内 skills
node install.mjs uninstall          # 卸载本包安装的所有 skills
```

## 无限扩展（往包里加 skill）

1. 新建目录：`skills/my-new-skill/SKILL.md`
2. 按 DSH skill 格式写 frontmatter（`name` 必须 kebab-case，含 `description`）：
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
npx clitaxio@latest install <runtime-code> ~/.dsh/skills/<slug>
```
本包是更可控的本地化替代：离线可用、可审计、可 git 管理、可批量管理多个 skill。

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

- **装完当前会话没立刻出现？** DSH 的 skill 目录在会话初始化时注入，新会话即可发现；文件系统 watcher 也会自动感知变更。
- **想改 skill 内容？** 直接改 `skills/<name>/SKILL.md` 再 `update`，幂等覆盖。
- **命名要求？** 目录名即 skill 名，必须 kebab-case（如 `my-new-skill`）。
