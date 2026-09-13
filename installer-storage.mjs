import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { assertAccountAncestors, currentAccountHome } from './broker-account-storage.mjs'

const runFile = promisify(execFile)
const INSTALL_META = 'install-meta.json'
const MAX_SKILL_FILES = 256
const GIT_TIMEOUT_MS = 8000

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object')
  return value
}

export function readInstallMeta(target) {
  const path = join(target, INSTALL_META)
  if (!existsSync(path)) return null
  return object(JSON.parse(readFileSync(path, 'utf8')), INSTALL_META)
}

export function installTarget(skillName, explicit, environment = process.env, workingDirectory = process.cwd()) {
  if (explicit !== undefined) {
    if (typeof explicit !== 'string' || !explicit.trim()) throw new Error('Install directory must be non-empty')
    return resolve(explicit)
  }
  if (environment.CODEX_HOME !== undefined) {
    if (typeof environment.CODEX_HOME !== 'string' || !isAbsolute(environment.CODEX_HOME)) throw new Error('CODEX_HOME must be absolute')
    return join(environment.CODEX_HOME, 'skills', skillName)
  }
  return join(workingDirectory, '.codex', 'skills', skillName)
}

function contained(root, path) {
  const inside = relative(root, path)
  return inside === '' || (!inside.startsWith('..' + '/') && inside !== '..' && !isAbsolute(inside)
    && !inside.startsWith('..' + '\\'))
}

function sameIdentity(meta, context) {
  return meta.source === context.runtimeCode && meta.slug === context.skillName && meta.endpoint === context.endpoint
    && typeof meta.version === 'string' && /^v?\d+\.\d+\.\d+$/.test(meta.version)
    && typeof meta.packageVersion === 'string' && /^\d+\.\d+\.\d+$/.test(meta.packageVersion)
}

function newerVersion(installed, selected) {
  const parts = version => {
    if (typeof version !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(version)) {
      throw new Error('Managed skill comparison requires a semantic release version')
    }
    return version.replace(/^v/, '').split('.').map(value => BigInt(value))
  }
  const left = parts(installed), right = parts(selected)
  const index = left.findIndex((part, position) => part !== right[position])
  return index !== -1 && left[index] > right[index]
}

function assertNoManagedDowngrade(previous, context) {
  if (previous !== null && (newerVersion(previous.version, context.skillVersion)
    || newerVersion(previous.packageVersion, context.packageVersion))) {
    throw new Error('The managed skill is newer than the selected release; refusing to downgrade its installation')
  }
}

async function targetExists(path) {
  try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

async function trackedSource(target) {
  let current = dirname(target)
  for (;;) {
    if (await targetExists(join(current, '.git')) !== null) {
      try {
        const result = await runFile('git', ['-C', current, 'ls-files', '--', relative(current, target)],
          { timeout: GIT_TIMEOUT_MS, maxBuffer: 1_048_576 })
        return result.stdout.trim().length > 0
      } catch { throw new Error('Cannot verify whether the install target contains repository source files') }
    }
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}

async function managedTarget(context, target, allowCreate) {
  const path = resolve(target)
  await assertAccountAncestors(dirname(path))
  if (contained(resolve(context.packageRoot), path) || contained(path, resolve(context.packageRoot))) {
    return { path, status: 'skipped', reason: 'package-source' }
  }
  const status = await targetExists(path)
  if (status === null) return allowCreate ? { path, status: 'new', meta: null }
    : { path, status: 'skipped', reason: 'not-installed' }
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('Installed skill target must be a regular directory')
  if (await trackedSource(path)) return { path, status: 'skipped', reason: 'repository-source' }
  const metaStatus = await targetExists(join(path, INSTALL_META))
  if (metaStatus === null) return { path, status: 'skipped', reason: 'unmanaged' }
  if (!metaStatus.isFile() || metaStatus.isSymbolicLink()) throw new Error('Install metadata must be a regular file')
  if (process.platform !== 'win32' && (status.uid !== process.getuid() || metaStatus.uid !== process.getuid())) throw new Error('Managed skill installation must belong to the current account')
  const meta = readInstallMeta(path)
  if (!sameIdentity(meta, context)) return { path, status: 'skipped', reason: 'identity-mismatch' }
  return { path, status: 'managed', meta }
}

async function verifySkillSource(directory, context) {
  let files = 0
  async function visit(path) {
    const status = await lstat(path)
    if (status.isSymbolicLink()) throw new Error('Skill package cannot contain symbolic links')
    if (status.isDirectory()) {
      for (const entry of await readdir(path)) await visit(join(path, entry))
      return
    }
    if (!status.isFile() || ++files > MAX_SKILL_FILES) throw new Error('Skill package contains an unsupported or excessive file set')
  }
  await assertAccountAncestors(directory)
  await visit(directory)
  const skill = object(JSON.parse(readFileSync(join(directory, 'skill.json'), 'utf8')), 'skill.json')
  if (skill.name !== context.skillName || skill.endpoint !== context.endpoint || skill.version !== context.skillVersion) {
    throw new Error('Skill package documentation identity does not match the selected version')
  }
  const markdown = await lstat(join(directory, 'SKILL.md'))
  if (!markdown.isFile() || markdown.size === 0) throw new Error('Skill package must contain its actual SKILL.md')
}

async function restoreInstallation(target, backup, placed, renamePath) {
  if (placed) await rm(target, { recursive: true })
  if (backup !== null) await renamePath(backup, target)
}

async function replaceInstallation(context, target, previous, dependencies) {
  const renamePath = dependencies.rename === undefined ? rename : dependencies.rename
  const suffix = randomUUID()
  const stage = join(dirname(target), '.' + context.skillName + '.stage-' + suffix)
  const backup = previous === null ? null : join(dirname(target), '.' + context.skillName + '.backup-' + suffix)
  let moved = false, placed = false
  await mkdir(stage, { mode: 0o700 })
  try {
    await verifySkillSource(context.skillDir, context)
    for (const entry of await readdir(context.skillDir)) {
      await cp(join(context.skillDir, entry), join(stage, entry), { recursive: true, force: false, errorOnExist: true })
    }
    await writeFile(join(stage, INSTALL_META), JSON.stringify({ source: context.runtimeCode, slug: context.skillName,
      version: context.skillVersion, packageVersion: context.packageVersion, endpoint: context.endpoint,
      installedAt: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 })
    await verifySkillSource(stage, context)
    if (backup !== null) { await renamePath(target, backup); moved = true }
    await renamePath(stage, target)
    placed = true
    return { path: target, status: previous === null ? 'installed' : 'updated',
      previousVersion: previous === null ? null : previous.version, version: context.skillVersion,
      documentationPath: join(target, 'SKILL.md'), backupPath: backup }
  } catch (error) {
    if (moved || placed) await restoreInstallation(target, moved ? backup : null, placed, renamePath)
    throw error
  } finally {
    const remaining = await targetExists(stage)
    if (remaining !== null) await rm(stage, { recursive: true })
  }
}

export async function writeManagedSkill(context, target, options = {}) {
  const allowCreate = options.allowCreate === true
  const candidate = await managedTarget(context, target, allowCreate)
  if (candidate.status === 'skipped') return candidate
  assertNoManagedDowngrade(candidate.meta, context)
  if (candidate.meta !== null && candidate.meta.version === context.skillVersion
    && candidate.meta.packageVersion === context.packageVersion) {
    await verifySkillSource(candidate.path, context)
    return { path: candidate.path, status: 'current', version: context.skillVersion,
      documentationPath: join(candidate.path, 'SKILL.md') }
  }
  await mkdir(dirname(candidate.path), { recursive: true })
  await assertAccountAncestors(dirname(candidate.path))
  const lock = join(dirname(candidate.path), '.' + context.skillName + '.install-lock')
  try { await mkdir(lock, { mode: 0o700 }) } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Skill installation is already locked; inspect its pending update before retrying')
    throw error
  }
  try {
    const checked = await managedTarget(context, candidate.path, allowCreate)
    if (checked.status === 'skipped') throw new Error('Skill installation ownership changed before update')
    assertNoManagedDowngrade(checked.meta, context)
    return await replaceInstallation(context, checked.path, checked.meta, options)
  } finally { await rm(lock, { recursive: true }) }
}

export async function refreshManagedSkillCopies(context, dependencies = {}) {
  const environment = dependencies.environment === undefined ? process.env : dependencies.environment
  const home = dependencies.homeDirectory === undefined ? currentAccountHome() : dependencies.homeDirectory
  const workingDirectory = dependencies.workingDirectory === undefined ? process.cwd() : dependencies.workingDirectory
  if (!isAbsolute(home) || !isAbsolute(workingDirectory)) throw new Error('Account and project directories must be absolute')
  const accountCodex = environment.CODEX_HOME === undefined ? join(home, '.codex') : environment.CODEX_HOME
  if (typeof accountCodex !== 'string' || !isAbsolute(accountCodex) || !contained(home, accountCodex)) {
    throw new Error('Automatic skill refresh requires CODEX_HOME inside the current account home')
  }
  const targets = [...new Set([join(workingDirectory, '.codex', 'skills', context.skillName),
    join(accountCodex, 'skills', context.skillName)])]
  const results = []
  for (const target of targets) results.push(await writeManagedSkill(context, target, dependencies))
  return results
}
