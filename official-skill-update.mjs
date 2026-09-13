import { refreshManagedSkillCopies } from './installer-storage.mjs'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { assertAccountAncestors, currentAccountHome, ensureAccountDirectory } from './broker-account-storage.mjs'
import { pathToFileURL } from 'node:url'
import { accountBrokerDirectory } from './broker-credentials.mjs'
import { createBrokerTransport } from './broker-transport.mjs'

const runFile = promisify(execFile)
export const LOOKUP_TIMEOUT_MS = 8000
const INSTALL_TIMEOUT_MS = 120_000
const RELEASE_PATTERN = /^(?:v)?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const OFFICIAL_IDENTITIES = Object.freeze({
  'cli-aimlock': 'R3mQ8kWpXn', 'cli-blueprint': 'wvz6zmRWmX', 'cli-calctool': 'KKyA6xljUX',
  'cli-swarm': 'zj7fTPVh4p', 'cli-validator': 'Xx9ZkQmW3p', 'cli-confirm-protocol': 'Cf8Pr7Tm2Q',
  'cli-archguard': 'Ag4Ch8Rd2K', 'cli-mergeguard': 'Mm7GnPqR2v',
})

function releaseVersion(value) {
  if (typeof value !== 'string' || !RELEASE_PATTERN.test(value)) throw new Error('Official release version must be X.Y.Z')
  return value.replace(/^v/, '')
}

export async function inspectOfficialRelease(context, dependencies = {}) {
  if (OFFICIAL_IDENTITIES[context.npmName] !== context.runtimeCode || typeof context.packageRoot !== 'string'
    || context.endpoint !== 'https://cli.tax/' + context.runtimeCode) {
    throw new Error('Official package identity is required for the update check')
  }
  const environment = dependencies.environment === undefined ? process.env : dependencies.environment
  const request = dependencies.request === undefined ? createBrokerTransport({ environment }) : dependencies.request
  const endpoint = 'https://cli.tax/api/public/skills/' + context.runtimeCode
  if (!/^[A-Za-z0-9]{10}$/.test(context.runtimeCode)) throw new Error('Official runtime code is invalid')
  const response = await request(endpoint, { redirect: 'error', signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
  if (!response.ok) throw new Error('Official release lookup failed: HTTP ' + response.status)
  const payload = await response.json()
  const version = releaseVersion(payload.version)
  const local = releaseVersion(context.packageVersion)
  const left = version.split('.').map(Number), right = local.split('.').map(Number)
  const differing = left.findIndex((value, index) => value !== right[index])
  if (differing !== -1 && left[differing] < right[differing]) {
    throw new Error('The local development package is newer than the published release; refusing to downgrade or overwrite workspace sources')
  }
  return { version, current: local === version }
}

async function validateCachedPackage(directory, context, version) {
  const packageRoot = join(directory, 'node_modules', context.npmName)
  await assertAccountAncestors(packageRoot)
  const status = await lstat(packageRoot)
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('Cached official package must be a regular directory')
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  const skill = JSON.parse(await readFile(join(packageRoot, 'skill', 'skill.json'), 'utf8'))
  if (manifest.name !== context.npmName || manifest.version !== version || releaseVersion(skill.version) !== version
    || skill.name !== context.skillName || skill.endpoint !== context.endpoint || typeof skill.schemaVersion !== 'string') {
    throw new Error('Installed official package identity does not match the published release')
  }
  return { ...context, packageRoot, packageVersion: version, skillVersion: skill.version,
    schemaVersion: skill.schemaVersion, skillDir: join(packageRoot, 'skill') }
}

export function windowsNpmEntry(output) {
  const commands = output.split(/\r?\n/).map(line => line.trim()).filter(line => /\\npm\.cmd$/i.test(line))
  if (!commands.length || !win32.isAbsolute(commands[0]) || /[\u0000-\u001f]/.test(commands[0])) {
    throw new Error('where.exe did not return an absolute npm.cmd location')
  }
  return { command: commands[0], script: win32.join(win32.dirname(commands[0]), 'node_modules', 'npm', 'bin', 'npm-cli.js') }
}

async function npmInvocation(environment) {
  if (process.platform !== 'win32') return { executable: 'npm', args: [] }
  const found = await runFile('where.exe', ['npm'], { env: environment, windowsHide: true, timeout: LOOKUP_TIMEOUT_MS })
  const entry = windowsNpmEntry(found.stdout)
  for (const path of [entry.command, entry.script]) {
    await assertAccountAncestors(win32.dirname(path), 'win32')
    const status = await lstat(path)
    if (!status.isFile() || status.isSymbolicLink()) throw new Error('Windows npm entry must be a regular file without symlink ancestors')
  }
  return { executable: process.execPath, args: [entry.script] }
}

async function installPackage(directory, context, version, environment) {
  if (typeof environment.PATH !== 'string' || !environment.PATH) throw new Error('Package installation PATH is required')
  const childEnvironment = { PATH: environment.PATH, HOME: currentAccountHome() }
  for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SystemRoot', 'COMSPEC', 'PATHEXT']) {
    if (environment[name] !== undefined) childEnvironment[name] = environment[name]
  }
  const invocation = await npmInvocation(childEnvironment)
  await new Promise((accept, reject) => {
    const child = spawn(invocation.executable, [...invocation.args, 'install', '--prefix', directory,
      '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--save-exact',
      '--registry=https://registry.npmjs.org', context.npmName + '@' + version],
    { env: childEnvironment, stdio: 'ignore', timeout: INSTALL_TIMEOUT_MS })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? accept()
      : reject(new Error('Official package update failed: exit=' + code + ' signal=' + signal)))
  })
}

export async function latestOfficialSkillContext(context, dependencies = {}) {
  const release = await inspectOfficialRelease(context, dependencies)
  if (release.current) return context
  const environment = dependencies.environment === undefined ? process.env : dependencies.environment
  const home = dependencies.homeDirectory === undefined ? currentAccountHome() : dependencies.homeDirectory
  const directory = join(accountBrokerDirectory(environment, process.platform, home), 'packages')
  await ensureAccountDirectory(directory, dependencies)
  const target = join(directory, context.npmName + '-' + release.version)
  try {
    await lstat(target)
    return await validateCachedPackage(target, context, release.version)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const staged = await mkdtemp(join(directory, '.update-'))
  try {
    const install = dependencies.installPackage === undefined ? installPackage : dependencies.installPackage
    await install(staged, context, release.version, environment)
    await validateCachedPackage(staged, context, release.version)
    try { await rename(staged, target) } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error
      await validateCachedPackage(target, context, release.version)
    }
    return await validateCachedPackage(target, context, release.version)
  } finally { await rm(staged, { recursive: true, force: true }) }
}

export async function latestOfficialModule(context, filename, dependencies) {
  const updated = await latestOfficialSkillContext(context, dependencies)
  if (updated.packageRoot === context.packageRoot) return null
  return { context: updated, module: await import(pathToFileURL(join(updated.packageRoot, filename)).href) }
}

export function withUpgradeMetadata(result, upgrade) {
  if (result.upgrade === undefined) return { ...result, upgrade }
  return { ...result, upgrade: { ...result.upgrade, previousVersion: upgrade.previousVersion,
    runtimeUpdated: upgrade.runtimeUpdated || result.upgrade.runtimeUpdated,
    reloadRequired: upgrade.reloadRequired || result.upgrade.reloadRequired,
    managedCopies: [...upgrade.managedCopies, ...result.upgrade.managedCopies] } }
}

export async function prepareOfficialSkillUse(context, filename, dependencies) {
  const selected = await latestOfficialSkillContext(context, dependencies)
  const managedCopies = await refreshManagedSkillCopies(selected, dependencies)
  const runtimeUpdated = selected.packageRoot !== context.packageRoot
  const changedCopies = managedCopies.filter(item => item.status === 'updated')
  const upgrade = { previousVersion: context.packageVersion, version: selected.packageVersion, runtimeUpdated,
    reloadRequired: runtimeUpdated || changedCopies.length > 0, managedCopies,
    documentationPaths: changedCopies.map(item => item.documentationPath) }
  if (runtimeUpdated) upgrade.documentationPaths.push(join(selected.skillDir, 'SKILL.md'))
  return { context: selected, upgrade,
    module: runtimeUpdated ? await import(pathToFileURL(join(selected.packageRoot, filename)).href) : null }
}
