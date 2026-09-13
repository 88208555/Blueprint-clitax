import { execFile } from 'node:child_process'
import { lstat, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, parse, resolve, win32 } from 'node:path'
import { userInfo } from 'node:os'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const runFile = promisify(execFile)
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const SYSTEM_SID = 'S-1-5-18'
const ACL_SID_ALIASES = Object.freeze({ SY: SYSTEM_SID, WD: 'S-1-1-0', BA: 'S-1-5-32-544',
  BU: 'S-1-5-32-545', AU: 'S-1-5-11', CO: 'S-1-3-0', CG: 'S-1-3-1', AN: 'S-1-5-7' })
const SID_PATTERN = /^S-1-(?:[0-9]+-)*[0-9]+$/
const ACL_TIMEOUT_MS = 15_000

export function currentAccountHome() {
  const home = userInfo().homedir
  if (typeof home !== 'string' || !parse(home).root) throw new Error('The current account has no absolute home directory')
  return home
}

export async function assertAccountAncestors(path, platform = process.platform) {
  const paths = platform === 'win32' ? win32 : { dirname, resolve, parse }
  let current = paths.resolve(path)
  const ancestors = []
  while (current !== paths.parse(current).root) {
    ancestors.unshift(current)
    current = paths.dirname(current)
  }
  for (const ancestor of ancestors) {
    let status
    try { status = await lstat(ancestor) } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (status.isSymbolicLink() || !status.isDirectory()) throw new Error('Account storage cannot traverse symlink or non-directory parents')
  }
}

function aclText(bytes) {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
    ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8')
}

export function windowsAclEntries(text) {
  const descriptor = text.split(/\r?\n/).find(line => line.startsWith('D:'))
  if (!descriptor) throw new Error('Windows ACL descriptor is missing')
  const entries = [...descriptor.matchAll(/\(([^()]*)\)/g)].map(match => {
    const fields = match[1].split(';')
    if (fields.length !== 6) throw new Error('Windows ACL entry is invalid')
    return { type: fields[0], flags: fields[1], rights: fields[2], sid: fields[5] }
  })
  if (!entries.length) throw new Error('Windows ACL cannot be empty')
  return { descriptor, entries }
}

export function assertRestrictedWindowsAcl(text, ownerSid) {
  const { descriptor, entries } = windowsAclEntries(text)
  if (!descriptor.startsWith('D:P') || entries.length !== 2) throw new Error('Windows account ACL must be protected and grant only the user and SYSTEM')
  const expected = new Set([ownerSid, SYSTEM_SID])
  for (const entry of entries) {
    const sid = Object.hasOwn(ACL_SID_ALIASES, entry.sid) ? ACL_SID_ALIASES[entry.sid] : entry.sid
    if (entry.type !== 'A' || !['FA', '0x1f01ff'].includes(entry.rights)
      || entry.flags.replaceAll('OI', '').replaceAll('CI', '') !== '' || !expected.delete(sid)) {
      throw new Error('Windows account ACL contains unexpected access')
    }
  }
  if (expected.size) throw new Error('Windows account ACL is missing the user or SYSTEM')
}

async function windowsOwnerSid(run) {
  const result = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: ACL_TIMEOUT_MS })
  const candidates = result.stdout.match(/S-1-(?:[0-9]+-)*[0-9]+/g)
  if (candidates === null || candidates.length !== 1 || !SID_PATTERN.test(candidates[0])) throw new Error('Current Windows account SID could not be verified')
  return candidates[0]
}

async function readWindowsAcl(path, run) {
  const temporary = join(dirname(path), '.acl-' + randomUUID() + '.txt')
  try {
    await run('icacls.exe', [path, '/save', temporary, '/q'], { windowsHide: true, timeout: ACL_TIMEOUT_MS })
    return aclText(await readFile(temporary))
  } finally {
    try { await rm(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

async function protectWindowsPath(path, directory, dependencies) {
  const run = dependencies.execFile === undefined ? runFile : dependencies.execFile
  const owner = await windowsOwnerSid(run)
  const flags = directory ? '(OI)(CI)F' : 'F'
  await run('icacls.exe', [path, '/inheritance:r', '/grant:r', '*' + owner + ':' + flags,
    '*' + SYSTEM_SID + ':' + flags], { windowsHide: true, timeout: ACL_TIMEOUT_MS })
  const { entries } = windowsAclEntries(await readWindowsAcl(path, run))
  for (const entry of entries) {
    const sid = Object.hasOwn(ACL_SID_ALIASES, entry.sid) ? ACL_SID_ALIASES[entry.sid] : entry.sid
    if (entry.type === 'A' && [owner, SYSTEM_SID].includes(sid)) continue
    if (!SID_PATTERN.test(sid)) throw new Error('Unexpected Windows ACL trustee')
    await run('icacls.exe', [path, entry.type === 'D' ? '/remove:d' : '/remove:g', '*' + sid],
      { windowsHide: true, timeout: ACL_TIMEOUT_MS })
  }
  assertRestrictedWindowsAcl(await readWindowsAcl(path, run), owner)
}

export async function protectAccountPath(path, directory, dependencies = {}) {
  const platform = dependencies.platform === undefined ? process.platform : dependencies.platform
  await assertAccountAncestors(dirname(path), platform)
  const status = await lstat(path)
  if (status.isSymbolicLink() || (directory ? !status.isDirectory() : !status.isFile())) throw new Error('Account storage object has an unsafe type')
  if (platform === 'win32') return protectWindowsPath(path, directory, dependencies)
  const mode = directory ? DIRECTORY_MODE : FILE_MODE
  if (status.uid !== process.getuid() || (status.mode & 0o777) !== mode) throw new Error('Account storage must be owned by the current account with restricted permissions')
}

export async function ensureAccountDirectory(path, dependencies = {}) {
  const platform = dependencies.platform === undefined ? process.platform : dependencies.platform
  await assertAccountAncestors(path, platform)
  await mkdir(path, { recursive: true, mode: DIRECTORY_MODE })
  await protectAccountPath(path, true, dependencies)
}

export async function verifyAccountPath(path, dependencies = {}) {
  const platform = dependencies.platform === undefined ? process.platform : dependencies.platform
  await assertAccountAncestors(dirname(path), platform)
  const status = await lstat(path)
  if (!status.isFile() || status.isSymbolicLink()) throw new Error('Credential must be a regular account file')
  if (platform !== 'win32') {
    if (status.uid !== process.getuid() || (status.mode & 0o777) !== FILE_MODE) throw new Error('Credential must be owned by the account with mode 0600')
    return
  }
  const run = dependencies.execFile === undefined ? runFile : dependencies.execFile
  const owner = await windowsOwnerSid(run)
  assertRestrictedWindowsAcl(await readWindowsAcl(path, run), owner)
}
