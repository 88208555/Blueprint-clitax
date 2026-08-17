#!/usr/bin/env node
/**
 * dsh-skillpack — DSH 专属插件包安装器
 *
 * 从本包 `skills/` 目录同步一组 skill 到目标 skills 根目录。
 * 每个子目录（含 SKILL.md + skill.json）即一个 skill；新增/删除子目录后重跑即可扩展。
 *
 * 用法:
 *   node install.mjs install                # 安装到所有默认目标（用户级 ~/.dsh/skills + 项目 .dsh/skills + 项目 .codex/skills）
 *   node install.mjs install --user         # 仅用户级 ~/.dsh/skills
 *   node install.mjs install --project      # 仅当前项目 .dsh/skills
 *   node install.mjs install --codex        # 仅当前项目 .codex/skills（供 Codex CLI 等 IDE 使用）
 *   node install.mjs install --target /abs/path
 *   node install.mjs update                 # 同 install（幂等覆盖）
 *   node install.mjs uninstall              # 从所有默认目标移除本包安装的 skills
 *   node install.mjs list                   # 列出本包包含的 skills
 *
 * 作为 npm 包发布后:  npx dsh-skillpack@latest install
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const SKILLS_SRC = join(__dirname, 'skills')

const HOME = homedir()
const DSH_USER = join(HOME, '.dsh', 'skills')          // DSH 用户级（全局）
const DSH_PROJECT = join(process.cwd(), '.dsh', 'skills') // DSH 项目级
const CODEX_PROJECT = join(process.cwd(), '.codex', 'skills') // Codex 兼容

const TARGETS = {
  user: { label: 'DSH 用户级', path: DSH_USER },
  project: { label: 'DSH 项目级', path: DSH_PROJECT },
  codex: { label: 'Codex 兼容', path: CODEX_PROJECT },
}

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

function parseTargets(args) {
  const explicit = args.filter((a) => a.startsWith('--'))
  const only = explicit.filter((a) => TARGETS[a.slice(2)]).map((a) => a.slice(2))
  const targetFlag = args.find((a) => a === '--target')
  if (targetFlag) {
    const i = args.indexOf(targetFlag)
    const p = args[i + 1]
    if (!p) { print('--target 需要一个绝对路径'); process.exit(1) }
    return [{ label: '自定义', path: resolve(p) }]
  }
  if (only.length) return only.map((k) => TARGETS[k])
  return Object.values(TARGETS) // 默认全部
}

const [cmd, ...rest] = process.argv.slice(2)

if (cmd === 'list') {
  const skills = await listSkills()
  print(`本包包含 ${skills.length} 个 skills:`)
  for (const s of skills) print(`  - ${s}`)
} else if (cmd === 'install' || cmd === 'update') {
  const targets = parseTargets(rest)
  const skills = await listSkills()
  if (!skills.length) { print('skills/ 目录为空，无法安装'); process.exit(1) }
  print(`将安装 ${skills.length} 个 skills → ${targets.length} 个目标`)
  for (const t of targets) {
    print(`[${t.label}] ${t.path}`)
    await syncAll(t.path)
  }
  print('完成。DSH 会通过 skill-filesystem 自动发现新目录（可立即在新会话中调用）。')
} else if (cmd === 'uninstall') {
  const targets = parseTargets(rest)
  for (const t of targets) {
    print(`[${t.label}] ${t.path}`)
    await syncAll(t.path, { remove: true })
  }
  print('完成。')
} else {
  print(`用法:
  node install.mjs install [--user|--project|--codex|--target <dir>]
  node install.mjs update
  node install.mjs uninstall
  node install.mjs list`)
  process.exit(1)
}
