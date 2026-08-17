#!/usr/bin/env node
/**
 * dsh-skillpack — 多 IDE 通用 skill 插件包安装器
 *
 * 从本包 `skills/` 目录同步一组 skill 到全世界各 IDE/编码 agent 的 skills 根目录。
 * 每个子目录（含 SKILL.md + skill.json）即一个 skill；新增/删除子目录后重跑即可扩展。
 *
 * 设计原则：
 *   - 内置「全世界已知 IDE 的 skills 安装位置表」（IDES，官方文档核实）；
 *   - 默认安装到每个 IDE 的专属用户级根 → 每个 IDE 内部唯一、IDE 之间互不重复；
 *   - 跨工具互操作标准 ~/.agents/skills（agentskills.io）默认跳过——它会被多个工具
 *     同时扫描（Codex 新约定/Gemini/Zed/OpenCode/Cursor/Antigravity），装进去会被重复发现；
 *     需要时用 --agents 显式开启（会打印警告）；
 *   - --ide / --skip / --only-installed 精确控制；新增 IDE 只需在 IDES 表加一行。
 *
 * 用法:
 *   node install.mjs install                # 安装到所有已知 IDE 的用户级根
 *   node install.mjs install --only-installed   # 只装本机已检测到安装目录的 IDE
 *   node install.mjs install --ide codex    # 仅安装到指定 IDE（可重复: --ide codex --ide dsh）
 *   node install.mjs install --skip cursor  # 安装全部但跳过指定 IDE（可重复）
 *   node install.mjs install --project      # 额外安装到当前项目的项目级根（每个选中 IDE 一个）
 *   node install.mjs install --agents       # 额外安装到共享 ~/.agents/skills（警告）
 *   node install.mjs install --target /abs/path    # 仅自定义目录
 *   node install.mjs update                 # 同 install（幂等覆盖）
 *   node install.mjs uninstall              # 从相同目标移除本包安装的 skills
 *   node install.mjs list                   # 列出本包包含的 skills
 *   node install.mjs ides                   # 列出已知 IDE 及本机检测结果
 *
 * 作为 npm 包发布后:  npx dsh-skillpack@latest install
 */
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const SKILLS_SRC = join(__dirname, 'skills')

const HOME = homedir()
const CWD = process.cwd()

/**
 * 全世界已知 IDE/编码 agent 的 skills 安装位置表（官方文档核实，2026-08）。
 *   key:     命令行标识
 *   label:   显示名
 *   detect:  检测目录（存在即视为本机已装该 IDE）
 *   user:    用户级 skills 根（默认安装目标，每个 IDE 一份）
 *   project: 项目级 skills 根（--project 时使用）
 *   doc:     官方文档 URL
 * 新增 IDE 只需在此加一行，其余逻辑自动生效。
 */
const IDES = [
  // OpenAI / Anthropic / Google 系
  { key: 'codex', label: 'Codex CLI', detect: join(HOME, '.codex'), user: join(HOME, '.codex', 'skills'), project: join(CWD, '.codex', 'skills'), doc: 'https://developers.openai.com/codex/skills', note: '新官方约定 ~/.agents/skills；此处用旧约定 ~/.codex/skills（skill-installer 仍默认写入），避免共享根重复' },
  { key: 'dsh', label: 'DSH', detect: join(HOME, '.dsh'), user: join(HOME, '.dsh', 'skills'), project: join(CWD, '.dsh', 'skills'), doc: 'https://github.com/deepseek-ai/Harness', note: 'skill-filesystem 扫描 ~/.dsh/skills + ~/.agents/skills' },
  { key: 'claude', label: 'Claude Code', detect: join(HOME, '.claude'), user: join(HOME, '.claude', 'skills'), project: join(CWD, '.claude', 'skills'), doc: 'https://code.claude.com/docs/en/skills', note: '含父目录向上扫描至 repo root；monorepo 子目录生效' },
  { key: 'gemini', label: 'Gemini CLI', detect: join(HOME, '.gemini'), user: join(HOME, '.gemini', 'skills'), project: join(CWD, '.gemini', 'skills'), doc: 'https://geminicli.com/docs/cli/skills/', note: '别名 .agents/skills 优先级更高（此处用专属根避免共享冲突）' },
  { key: 'antigravity', label: 'Google Antigravity', detect: join(HOME, '.gemini', 'antigravity'), user: join(HOME, '.gemini', 'antigravity', 'skills'), project: join(CWD, '.agents', 'skills'), doc: 'https://antigravity.google/docs/ide/skills', note: 'workspace 级固定用 .agents/skills（需 --agents 才装项目级）' },

  // 编辑器 / VS Code 生态
  { key: 'cursor', label: 'Cursor', detect: join(HOME, '.cursor'), user: join(HOME, '.cursor', 'skills'), project: join(CWD, '.cursor', 'skills'), doc: 'https://cursor.com/help/customization/skills.md', note: '兼容加载 .claude/.codex/.agents/skills' },
  { key: 'cline', label: 'Cline', detect: join(HOME, '.cline'), user: join(HOME, '.cline', 'skills'), project: join(CWD, '.cline', 'skills'), doc: 'https://cline.bot/blog/cline-3-48-0-skills-and-websearch-make-cline-smarter', note: '全局优先于项目' },
  { key: 'roo', label: 'Roo Code', detect: join(HOME, '.roo'), user: join(HOME, '.roo', 'skills'), project: join(CWD, '.roo', 'skills'), doc: 'https://docs.roocode.com/features/skills', note: '项目覆盖全局，模式级覆盖通用' },
  { key: 'kilo', label: 'Kilo Code', detect: join(HOME, '.kilo'), user: join(HOME, '.kilo', 'skills'), project: join(CWD, '.kilo', 'skills'), doc: 'https://kilo.ai/docs/customize/skills', note: 'kilo.jsonc 可配 skills.paths/urls；另默认加载 .agents/skills' },
  { key: 'windsurf', label: 'Windsurf', detect: join(HOME, '.codeium', 'windsurf'), user: join(HOME, '.codeium', 'windsurf', 'skills'), project: join(CWD, '.windsurf', 'skills'), doc: 'https://docs.windsurf.com/windsurf/cascade/skills', note: '全局 ~/.codeium/windsurf/skills，workspace .windsurf/skills' },
  { key: 'copilot', label: 'VS Code / Copilot', detect: join(HOME, '.vscode'), user: join(HOME, '.copilot', 'skills'), project: join(CWD, '.github', 'skills'), doc: 'https://code.visualstudio.com/docs/agent-customization/agent-skills', note: 'workspace .github/skills + .claude/skills；user ~/.copilot/skills + ~/.claude/skills' },
  { key: 'trae', label: 'Trae', detect: join(HOME, '.trae-cn'), user: join(HOME, '.trae-cn', 'skills'), project: join(CWD, '.trae', 'skills'), doc: 'https://docs.trae.cn/work_skills', note: '国内版 ~/.trae-cn/skills；国际版用户级未确认；另有 .trae/rules' },

  // CLI agent
  { key: 'qwen', label: 'Qwen Code', detect: join(HOME, '.qwen'), user: join(HOME, '.qwen', 'skills'), project: join(CWD, '.qwen', 'skills'), doc: 'https://qwenlm.github.io/qwen-code-docs/users/features/skills/', note: '模型自动调用；/learn 生成到项目 .qwen/skills' },
  { key: 'opencode', label: 'OpenCode', detect: join(HOME, '.config', 'opencode'), user: join(HOME, '.config', 'opencode', 'skills'), project: join(CWD, '.opencode', 'skills'), doc: 'https://github.com/anomalyco/opencode/blob/main/packages/web/src/content/docs/skills.mdx', note: '兼容 .claude/skills 与 .agents/skills' },
  { key: 'zed', label: 'Zed', detect: join(HOME, '.config', 'zed'), user: join(HOME, '.agents', 'skills'), project: join(CWD, '.agents', 'skills'), doc: 'https://zed.dev/docs/ai/skills', note: '官方即用 .agents/skills 标准根，仅 --agents 时安装（避免默认触碰共享根）', agentsOnly: true },
  // Amazon Q Developer：官方确认无 SKILL.md skills 机制（能力目录为 ~/.aws/amazonq/cli-agents/），故不入表
]

// 跨工具互操作标准根（默认跳过；--agents 显式开启）
const AGENTS = { label: '共享 agents 级 (.agents/skills 标准)', path: join(HOME, '.agents', 'skills') }

function print(line = '') { process.stdout.write(`${line}\n`) }

async function listSkills() {
  if (!existsSync(SKILLS_SRC)) return []
  const entries = await readdir(SKILLS_SRC, { withFileTypes: true })
  const skills = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const skillDir = join(SKILLS_SRC, e.name)
    if (existsSync(join(skillDir, 'SKILL.md'))) skills.push(e.name)
  }
  return skills.sort()
}

async function syncOne(name, targetRoot, { remove = false } = {}) {
  const dest = join(targetRoot, name)
  if (remove) {
    if (existsSync(dest)) { await rm(dest, { recursive: true, force: true }); print(`  ✓ 已移除 ${name} ← ${targetRoot}`) }
    return
  }
  await mkdir(dest, { recursive: true })
  await cp(join(SKILLS_SRC, name), dest, { recursive: true, force: true })
  print(`  ✓ 已安装 ${name} → ${dest}`)
}

async function syncAll(targetRoot, { remove = false } = {}) {
  const skills = await listSkills()
  if (!remove) await mkdir(targetRoot, { recursive: true })
  for (const s of skills) await syncOne(s, targetRoot, { remove })
}

/** 解析目标列表：--target / --ide / --skip / 默认（全部已知 IDE） */
function parseTargets(args) {
  const flags = args.filter((a) => a.startsWith('--'))

  const targetFlag = args.indexOf('--target')
  if (targetFlag !== -1) {
    const p = args[targetFlag + 1]
    if (!p) { print('--target 需要一个绝对路径'); process.exit(1) }
    return [{ label: '自定义', path: resolve(p) }]
  }

  const selected = []
  const withProject = flags.includes('--project')

  // 显式 --ide（可重复）
  const ideKeys = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ide') {
      const k = args[i + 1]
      if (!k) { print('--ide 需要一个 IDE key（如 codex）'); process.exit(1) }
      ideKeys.push(k)
      i++
    }
  }
  if (ideKeys.length) {
    for (const k of ideKeys) {
      const ide = IDES.find((x) => x.key === k)
      if (!ide) { print(`未知 IDE: ${k}（可用: ${IDES.map((x) => x.key).join(', ')}）`); process.exit(1) }
      selected.push({ label: `${ide.label} 用户级`, path: ide.user })
      if (withProject) selected.push({ label: `${ide.label} 项目级`, path: ide.project })
    }
    return selected
  }

  // --skip（排除某些 IDE）
  const skipped = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip') {
      const k = args[i + 1]
      if (!k) { print('--skip 需要一个 IDE key（如 cursor）'); process.exit(1) }
      skipped.push(k)
      i++
    }
  }

  // 默认：全部已知 IDE（世界通用安装位置）。--only-installed 则只装本机已检测到的。
  const wantAgents = flags.includes('--agents')
  for (const ide of IDES) {
    if (skipped.includes(ide.key)) continue
    // agentsOnly（如 Zed）：仅 --agents 时安装，默认不触碰共享根
    if (ide.agentsOnly && !wantAgents) continue
    if (flags.includes('--only-installed') && !existsSync(ide.detect)) continue
    selected.push({ label: `${ide.label} 用户级`, path: ide.user })
    if (withProject) selected.push({ label: `${ide.label} 项目级`, path: ide.project })
  }
  if (!selected.length) {
    print('没有可安装的目标（全部被 --skip 排除？）。')
    process.exit(1)
  }
  return selected
}

const [cmd, ...rest] = process.argv.slice(2)

if (cmd === 'list') {
  const skills = await listSkills()
  print(`本包包含 ${skills.length} 个 skills:`)
  for (const s of skills) print(`  - ${s}`)
} else if (cmd === 'ides') {
  print(`已知 IDE 及本机检测结果（共 ${IDES.length} 个）:`)
  for (const ide of IDES) {
    const installed = existsSync(ide.detect)
    print(`  ${installed ? '✓' : '·'} ${ide.key.padEnd(11)} ${ide.label.padEnd(20)} ${ide.user}`)
  }
  print(`  · agents     共享 agents 级  ${AGENTS.path}（默认跳过，--agents 开启）`)
} else if (cmd === 'install' || cmd === 'update') {
  const targets = parseTargets(rest)
  const skills = await listSkills()
  if (!skills.length) { print('skills/ 目录为空，无法安装'); process.exit(1) }
  if (rest.includes('--agents') && !targets.some((t) => t.path === AGENTS.path)) targets.push(AGENTS)
  print(`将安装 ${skills.length} 个 skills → ${targets.length} 个目标`)
  for (const t of targets) {
    print(`[${t.label}] ${t.path}`)
    await syncAll(t.path)
  }
  if (rest.includes('--agents')) {
    print('⚠ 已安装到共享 ~/.agents/skills：该目录会被 Codex/Gemini/Zed/OpenCode/Cursor 等同时扫描，同一 skill 可能被重复发现。')
  }
  print('完成。各 IDE 会自动发现各自用户级根中的新目录（可立即在新会话中调用）。')
} else if (cmd === 'uninstall') {
  const targets = parseTargets(rest)
  if (rest.includes('--agents') && !targets.some((t) => t.path === AGENTS.path)) targets.push(AGENTS)
  for (const t of targets) {
    print(`[${t.label}] ${t.path}`)
    await syncAll(t.path, { remove: true })
  }
  print('完成。')
} else {
  print(`用法:
  node install.mjs install [--only-installed|--ide <key>|--skip <key>|--project|--agents|--target <dir>]
  node install.mjs update
  node install.mjs uninstall
  node install.mjs list
  node install.mjs ides`)
  process.exit(1)
}
