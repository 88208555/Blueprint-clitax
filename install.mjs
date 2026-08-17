#!/usr/bin/env node
/**
 * dsh-skillpack — 多 IDE 通用 skill 插件包安装器
 *
 * 从本包 `skills/` 目录同步一组 skill 到各 IDE 的 skills 根目录。
 * 每个子目录（含 SKILL.md + skill.json）即一个 skill；新增/删除子目录后重跑即可扩展。
 *
 * 设计原则（每个 IDE 同一套逻辑）：
 *   - 每个 IDE 只装一份到它自己的用户级根 → 该 IDE 内部唯一、不重复；
 *   - IDE 之间互不扫描对方目录 → 互不干扰；
 *   - 共享兼容根 ~/.agents/skills 默认跳过（多个工具都会扫描它，是"重复出现"的根源），
 *     需要时用 --agents 显式开启（会打印警告）。
 *
 * 用法:
 *   node install.mjs install                # 自动检测本机已安装的 IDE，每个各装一份用户级根
 *   node install.mjs install --all          # 不检测，安装到所有已知 IDE（含未检测到的）
 *   node install.mjs install --ide codex    # 仅安装到指定 IDE（可重复: --ide codex --ide dsh）
 *   node install.mjs install --project      # 额外安装到当前项目的项目级根（每个选中 IDE 一个）
 *   node install.mjs install --agents       # 额外安装到共享 ~/.agents/skills（警告：可能被多工具重复发现）
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
 * 已知 IDE 适配表。
 * detect: 该 IDE 的用户级配置目录（存在即视为已安装）
 * user:   用户级 skills 根（默认安装目标，每个 IDE 一份）
 * project: 项目级 skills 根（--project 时使用）
 * 新增 IDE 只需在此加一行，其余逻辑自动生效。
 */
const IDES = [
  { key: 'codex', label: 'Codex', detect: join(HOME, '.codex'), user: join(HOME, '.codex', 'skills'), project: join(CWD, '.codex', 'skills') },
  { key: 'dsh', label: 'DSH', detect: join(HOME, '.dsh'), user: join(HOME, '.dsh', 'skills'), project: join(CWD, '.dsh', 'skills') },
  { key: 'claude', label: 'Claude Code', detect: join(HOME, '.claude'), user: join(HOME, '.claude', 'skills'), project: join(CWD, '.claude', 'skills') },
  { key: 'cursor', label: 'Cursor', detect: join(HOME, '.cursor'), user: join(HOME, '.cursor', 'skills'), project: join(CWD, '.cursor', 'skills') },
  { key: 'gemini', label: 'Gemini CLI', detect: join(HOME, '.gemini'), user: join(HOME, '.gemini', 'skills'), project: join(CWD, '.gemini', 'skills') },
]

// 共享兼容根（默认跳过；--agents 显式开启）
const AGENTS = { label: '共享 agents 级', path: join(HOME, '.agents', 'skills') }

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

/** 解析目标列表：--target / --ide / 默认（检测已装 IDE） */
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

  // 显式 --ide
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

  // 默认：自动检测已安装的 IDE（--all 忽略检测）
  for (const ide of IDES) {
    if (flags.includes('--all') || existsSync(ide.detect)) {
      selected.push({ label: `${ide.label} 用户级`, path: ide.user })
      if (withProject) selected.push({ label: `${ide.label} 项目级`, path: ide.project })
    }
  }
  if (!selected.length) {
    print('未检测到任何已知 IDE 目录；可用 --all 安装全部，或 --ide <key> 指定。')
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
  print('已知 IDE 及本机检测结果:')
  for (const ide of IDES) {
    const installed = existsSync(ide.detect)
    print(`  ${installed ? '✓' : '·'} ${ide.key.padEnd(8)} ${ide.label.padEnd(12)} ${ide.user}`)
  }
  print(`  · agents     共享兼容根    ${AGENTS.path}（默认跳过）`)
} else if (cmd === 'install' || cmd === 'update') {
  const targets = parseTargets(rest)
  const skills = await listSkills()
  if (!skills.length) { print('skills/ 目录为空，无法安装'); process.exit(1) }
  if (rest.includes('--agents')) targets.push(AGENTS)
  print(`将安装 ${skills.length} 个 skills → ${targets.length} 个目标`)
  for (const t of targets) {
    print(`[${t.label}] ${t.path}`)
    await syncAll(t.path)
  }
  if (rest.includes('--agents')) {
    print('⚠ 已安装到共享 ~/.agents/skills：该目录可能被多个工具扫描，同一 skill 可能被重复发现。')
  }
  print('完成。各 IDE 会自动发现各自用户级根中的新目录（可立即在新会话中调用）。')
} else if (cmd === 'uninstall') {
  const targets = parseTargets(rest)
  if (rest.includes('--agents')) targets.push(AGENTS)
  for (const t of targets) {
    print(`[${t.label}] ${t.path}`)
    await syncAll(t.path, { remove: true })
  }
  print('完成。')
} else {
  print(`用法:
  node install.mjs install [--all|--ide <key>|--project|--agents|--target <dir>]
  node install.mjs update
  node install.mjs uninstall
  node install.mjs list
  node install.mjs ides`)
  process.exit(1)
}
