import { constants } from 'node:fs'
import { lstat, open, rename, rm } from 'node:fs/promises'
import { currentAccountHome, ensureAccountDirectory, protectAccountPath, verifyAccountPath } from './broker-account-storage.mjs'
import { isAbsolute, join, resolve, win32 } from 'node:path'
import { randomUUID } from 'node:crypto'

const TOKEN_FILE_ENV = 'CLITAX_BRAIN_CLIENT_TOKEN_FILE'
const TOKEN_FILE_VERSION = 'member-brain.client-token-file/1.0'
const TOKEN_FILE_MAX_BYTES = 16_384
const AUTH_SCHEME = 'BrainClient'
const TOKEN_ENDPOINT = 'https://cli.tax/api/v1/telemetry/skill-usage'
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const TOKEN_MODE = 0o600

export function accountBrokerDirectory(environment, platform = process.platform, home = currentAccountHome()) {
  if (platform === 'win32') {
    if (typeof environment.LOCALAPPDATA !== 'string' || !win32.isAbsolute(environment.LOCALAPPDATA)) {
      throw new Error('LOCALAPPDATA must identify the current account directory')
    }
    const relative = win32.relative(home, environment.LOCALAPPDATA)
    if (relative === '..' || relative.startsWith('..\\') || win32.isAbsolute(relative)) throw new Error('LOCALAPPDATA must belong to the current account home')
    return win32.join(environment.LOCALAPPDATA, 'CLI.Tax', 'broker')
  }
  if (!isAbsolute(home)) throw new Error('Account home directory must be absolute')
  return platform === 'darwin' ? join(home, 'Library', 'Application Support', 'CLI.Tax', 'broker')
    : join(home, '.local', 'share', 'CLI.Tax', 'broker')
}

export function brainClientTokenPath(environment, platform = process.platform, home = currentAccountHome()) {
  const configured = environment[TOKEN_FILE_ENV]
  const directory = accountBrokerDirectory(environment, platform, home)
  if (configured === undefined) return platform === 'win32'
    ? win32.join(directory, 'credential.json') : join(directory, 'credential.json')
  if (typeof configured !== 'string' || !configured.trim()) throw new Error(TOKEN_FILE_ENV + ' must be an absolute path')
  const candidate = configured.trim()
  if (platform !== 'win32') {
    if (!isAbsolute(candidate)) throw new Error(TOKEN_FILE_ENV + ' must be absolute and independent of the project directory')
    return resolve(candidate)
  }
  if (!win32.isAbsolute(candidate)) throw new Error('Windows Brain Client token file path must be absolute')
  const path = win32.resolve(candidate), relative = win32.relative(directory, path)
  if (relative === '..' || relative.startsWith('..\\') || win32.isAbsolute(relative)) {
    throw new Error('Windows Brain Client token file must be inside its account broker directory')
  }
  return path
}

export function validateBrainClientCredential(value, endpoint = TOKEN_ENDPOINT) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'authorizationScheme,endpoint,schemaVersion,token') {
    throw new Error('Brain Client credential has unknown or missing fields')
  }
  if (value.schemaVersion !== TOKEN_FILE_VERSION || value.authorizationScheme !== AUTH_SCHEME
    || value.endpoint !== TOKEN_ENDPOINT || new URL(endpoint).origin !== new URL(TOKEN_ENDPOINT).origin
    || typeof value.token !== 'string' || !TOKEN_PATTERN.test(value.token)) {
    throw new Error('Brain Client token file authority is invalid')
  }
  return value
}

function parseCredential(source) {
  if (Buffer.byteLength(source) > TOKEN_FILE_MAX_BYTES) throw new Error('Brain Client credential exceeds the size limit')
  let parsed
  try { parsed = JSON.parse(source) } catch { throw new Error('Brain Client credential must contain valid JSON') }
  return validateBrainClientCredential(parsed)
}

function assertRestrictedFile(status, platform, currentUserId) {
  if (!status.isFile() || status.size < 1 || status.size > TOKEN_FILE_MAX_BYTES) {
    throw new Error('Brain Client token file must be a non-empty restricted file')
  }
  if (platform === 'win32') return
  if (!Number.isInteger(currentUserId) || status.uid !== currentUserId || (status.mode & 0o777) !== TOKEN_MODE) {
    throw new Error('Brain Client token file must be owned by the current user with mode 0600')
  }
}

export async function brainClientAuthorization(context, environment, dependencies = {}) {
  const platform = dependencies.platform === undefined ? process.platform : dependencies.platform
  const path = brainClientTokenPath(environment, platform, dependencies.homeDirectory === undefined ? currentAccountHome() : dependencies.homeDirectory)
  const inspect = dependencies.lstat === undefined ? lstat : dependencies.lstat
  const openFile = dependencies.open === undefined ? open : dependencies.open
  const currentUserId = platform === 'win32' ? null : (dependencies.getuid === undefined ? process.getuid : dependencies.getuid)()
  let status
  try { status = await inspect(path) } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Brain Client credential is not configured; copy the authenticated setup from CLI.Tax and run configure with JSON stdin')
    throw error
  }
  if (status.isSymbolicLink()) throw new Error('Brain Client token file cannot be a symlink')
  const verifyPath = dependencies.verifyPath === undefined ? verifyAccountPath : dependencies.verifyPath
  await verifyPath(path, { ...dependencies, platform })
  const handle = await openFile(path, constants.O_RDONLY | (platform === 'win32' ? 0 : constants.O_NOFOLLOW))
  try {
    assertRestrictedFile(await handle.stat(), platform, currentUserId)
    const value = validateBrainClientCredential(parseCredential(await handle.readFile('utf8')), context.endpoint)
    return AUTH_SCHEME + ' ' + value.token
  } finally { await handle.close() }
}

export async function configureBrainClientCredential(source, environment = process.env, dependencies = {}) {
  const credential = parseCredential(source)
  const platform = dependencies.platform === undefined ? process.platform : dependencies.platform
  const home = dependencies.homeDirectory === undefined ? currentAccountHome() : dependencies.homeDirectory
  const directory = accountBrokerDirectory(environment, platform, home)
  await ensureAccountDirectory(directory, { ...dependencies, platform })
  const path = join(directory, 'credential.json')
  try { await protectAccountPath(path, false, { ...dependencies, platform }) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const temporary = join(directory, 'credential-' + randomUUID() + '.json')
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
    | (platform === 'win32' ? 0 : constants.O_NOFOLLOW), TOKEN_MODE)
  try {
    await handle.writeFile(JSON.stringify(credential) + '\n')
    await handle.sync()
  } finally { await handle.close() }
  try {
    await protectAccountPath(temporary, false, { ...dependencies, platform })
    await rename(temporary, path)
    await protectAccountPath(path, false, { ...dependencies, platform })
  } catch (error) {
    try { await rm(temporary) } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError }
    throw error
  }
  return { configured: true, path, scope: 'current-account', requiresEnvironmentOverrideRemoval: environment[TOKEN_FILE_ENV] !== undefined }
}
