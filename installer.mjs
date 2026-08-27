/**
 * 八个官方技能共用这一份安装器。packages/*-cli/installer.mjs 必须与本文件字节一致。
 * 禁止第二套超时、第二套版本来源、第二套 bin 名。
 */
import { randomUUID } from 'node:crypto'
import { constants, existsSync, readFileSync } from 'node:fs'
import { cp, lstat, mkdir, open, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

export const LOOKUP_TIMEOUT_MS = 8000
export const CALL_TIMEOUT_MS = 120_000
const INSTALL_META = 'install-meta.json'
const FEEDBACK_API_PATH = '/api/v1/telemetry/skill-usage'
const BRAIN_CLIENT_TOKEN_FILE_ENV = 'CLITAX_BRAIN_CLIENT_TOKEN_FILE'
const BRAIN_CLIENT_TOKEN_FILE_VERSION = 'member-brain.client-token-file/1.0'
const BRAIN_CLIENT_AUTH_SCHEME = 'BrainClient'
const BRAIN_CLIENT_TOKEN_FILE_MAX_BYTES = 16_384
const BRAIN_CLIENT_TOKEN_FILE_MODE = 0o600
const FEEDBACK_COMMENT_MAX = 500
const FEEDBACK_SCORE_MIN = 0
const FEEDBACK_SCORE_MAX = 100
const BRAIN_CLIENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const FEEDBACK_INVOCATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FEEDBACK_SCORE_PATTERN = /^(?:0|[1-9]\d{0,2})$/

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function requiredString(value, label) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(`${label} is required`)
  return text
}

export function loadOfficialSkillContext(packageRoot) {
  const pkg = asObject(JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')), 'package.json')
  const skill = asObject(JSON.parse(readFileSync(join(packageRoot, 'skill/skill.json'), 'utf8')), 'skill.json')
  const npmName = requiredString(pkg.name, 'package.json name')
  const packageVersion = requiredString(pkg.version, 'package.json version')
  const displayName = requiredString(skill.displayName, 'skill.json displayName')
  const skillName = requiredString(skill.name, 'skill.json name')
  const schemaVersion = requiredString(skill.schemaVersion, 'skill.json schemaVersion')
  const endpoint = requiredString(skill.endpoint, 'skill.json endpoint')
  const skillVersion = requiredString(skill.version, 'skill.json version')
  const runtimeCode = requiredString(endpoint.replace(/^https:\/\/cli\.tax\//, ''), 'runtime code')
  if (!/^[A-Za-z0-9]{10}$/.test(runtimeCode)) {
    throw new Error(`skill.json endpoint must be https://cli.tax/{10-char-code}: ${endpoint}`)
  }
  if (skillVersion.replace(/^v/i, '') !== packageVersion.replace(/^v/i, '')) {
    throw new Error(`skill.json ${skillVersion} must match package.json ${packageVersion}`)
  }
  return {
    packageRoot,
    npmName,
    packageVersion,
    displayName,
    skillName,
    schemaVersion,
    endpoint,
    skillVersion,
    runtimeCode,
    latestEndpoint: `https://cli.tax/api/public/skills/${runtimeCode}`,
    skillDir: join(packageRoot, 'skill'),
  }
}

export function readInstallMeta(target) {
  const path = join(target, INSTALL_META)
  if (!existsSync(path)) return null
  return asObject(JSON.parse(readFileSync(path, 'utf8')), INSTALL_META)
}

export function installTarget(skillName, explicit) {
  if (explicit) return resolve(explicit)
  const codexHome = process.env.CODEX_HOME?.trim()
  if (codexHome) return join(codexHome, 'skills', skillName)
  return join(process.cwd(), '.codex', 'skills', skillName)
}

export async function fetchLatestVersion(context) {
  const response = await fetch(context.latestEndpoint, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`cli.tax skill lookup failed: HTTP ${response.status}`)
  const data = asObject(await response.json(), 'cli.tax skill lookup')
  return {
    version: requiredString(data.version, 'cli.tax skill lookup version'),
    displayName: requiredString(data.displayName, 'cli.tax skill lookup displayName'),
  }
}

export async function callOfficialSkill(context, operation, input) {
  const requestId = `${context.npmName}-${Date.now()}`
  const response = await fetch(context.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: {
        schemaVersion: context.schemaVersion,
        requestId,
        operation,
        input,
      },
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`${context.displayName} ${operation} failed: non-JSON response (HTTP ${response.status}). Check ${context.endpoint}.`)
  }
  if (!response.ok || payload?.ok !== true) {
    const message = payload?.error?.message
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error(`${context.displayName} ${operation} failed: HTTP ${response.status}`)
    }
    throw new Error(`${context.displayName} ${operation} failed: ${message}`)
  }
  return payload
}

export function feedbackCommandInput(args) {
  const invocationId = requiredString(args[1], 'feedback invocation id')
  if (!FEEDBACK_INVOCATION_PATTERN.test(invocationId)) {
    throw new Error('feedback invocation id must be the UUID returned by a real skill response')
  }
  const scoreText = requiredString(args[2], 'feedback score')
  if (!FEEDBACK_SCORE_PATTERN.test(scoreText)) {
    throw new Error(`feedback score must be an integer between ${FEEDBACK_SCORE_MIN} and ${FEEDBACK_SCORE_MAX}`)
  }
  const score = Number(scoreText)
  if (!Number.isInteger(score) || score < FEEDBACK_SCORE_MIN || score > FEEDBACK_SCORE_MAX) {
    throw new Error(`feedback score must be between ${FEEDBACK_SCORE_MIN} and ${FEEDBACK_SCORE_MAX}`)
  }
  const userComment = args.slice(3).join(' ').trim()
  if (!userComment) throw new Error('feedback comment is required')
  if (userComment.length > FEEDBACK_COMMENT_MAX) {
    throw new Error(`feedback comment must be at most ${FEEDBACK_COMMENT_MAX} characters`)
  }
  return { invocationId, score, userComment }
}

async function brainClientAuthorization(context, environment) {
  const configuredPath = typeof environment[BRAIN_CLIENT_TOKEN_FILE_ENV] === 'string'
    ? environment[BRAIN_CLIENT_TOKEN_FILE_ENV].trim() : ''
  if (!configuredPath) throw new Error(`${BRAIN_CLIENT_TOKEN_FILE_ENV} is required`)
  if (process.platform === 'win32' || typeof process.getuid !== 'function') {
    throw new Error('Brain Client token file ownership cannot be verified')
  }
  const tokenFilePath = resolve(configuredPath)
  const linkStatus = await lstat(tokenFilePath)
  if (linkStatus.isSymbolicLink()) throw new Error('Brain Client token file cannot be a symlink')
  const handle = await open(tokenFilePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const status = await handle.stat()
    if (!status.isFile() || status.uid !== process.getuid()
      || (status.mode & 0o777) !== BRAIN_CLIENT_TOKEN_FILE_MODE
      || status.size < 1 || status.size > BRAIN_CLIENT_TOKEN_FILE_MAX_BYTES) {
      throw new Error('Brain Client token file must be owned by the current user with mode 0600')
    }
    const tokenFile = asObject(JSON.parse(await handle.readFile('utf8')), 'Brain Client token file')
    const expectedKeys = ['authorizationScheme', 'endpoint', 'schemaVersion', 'token']
    if (Object.keys(tokenFile).sort().join('\n') !== expectedKeys.join('\n')) {
      throw new Error('Brain Client token file contains unknown or missing fields')
    }
    const endpoint = new URL(requiredString(tokenFile.endpoint, 'Brain Client endpoint'))
    if (tokenFile.schemaVersion !== BRAIN_CLIENT_TOKEN_FILE_VERSION
      || tokenFile.authorizationScheme !== BRAIN_CLIENT_AUTH_SCHEME
      || endpoint.origin !== new URL(context.endpoint).origin
      || endpoint.pathname !== FEEDBACK_API_PATH || endpoint.search || endpoint.hash
      || endpoint.username || endpoint.password
      || !BRAIN_CLIENT_TOKEN_PATTERN.test(tokenFile.token)) {
      throw new Error('Brain Client token file authority is invalid')
    }
    return `${BRAIN_CLIENT_AUTH_SCHEME} ${tokenFile.token}`
  } finally {
    await handle.close()
  }
}

export async function submitOfficialSkillFeedback(context, args, environment, request) {
  const input = feedbackCommandInput(args)
  const authorization = await brainClientAuthorization(context, environment)
  const requestId = `${context.runtimeCode}-${randomUUID()}`
  let response
  try {
    response = await request(new URL(FEEDBACK_API_PATH, context.endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization,
      },
      body: JSON.stringify({
        requestId,
        skillId: context.runtimeCode,
        invocationId: input.invocationId,
        score: input.score,
        userComment: input.userComment,
      }),
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
  } catch {
    throw new Error('cli.tax feedback request failed')
  }
  let payload
  try {
    payload = asObject(await response.json(), 'cli.tax feedback response')
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('cli.tax feedback response')) throw error
    throw new Error(`cli.tax feedback failed: non-JSON response (HTTP ${response.status})`)
  }
  if (!response.ok || payload.ok !== true) {
    throw new Error(`cli.tax feedback failed: HTTP ${response.status}`)
  }
  if (payload.requestId !== requestId || typeof payload.id !== 'string'
    || !FEEDBACK_INVOCATION_PATTERN.test(payload.id)
    || typeof payload.duplicated !== 'boolean') {
    throw new Error('cli.tax feedback response authority is invalid')
  }
  return { id: payload.id, requestId, duplicated: payload.duplicated }
}

export async function installOfficialSkill(context, explicit) {
  const target = installTarget(context.skillName, explicit)
  await mkdir(target, { recursive: true })
  const previous = readInstallMeta(target)
  await rm(join(target, 'references'), { recursive: true, force: true })
  await cp(context.skillDir, target, { recursive: true, force: true })
  const installed = asObject(JSON.parse(readFileSync(join(target, 'skill.json'), 'utf8')), 'installed skill.json')
  const installedVersion = requiredString(installed.version, 'installed skill.json version')
  await writeFile(join(target, INSTALL_META), `${JSON.stringify({
    source: context.runtimeCode,
    slug: context.skillName,
    version: installedVersion,
    packageVersion: context.packageVersion,
    endpoint: context.endpoint,
    installedAt: new Date().toISOString(),
  }, null, 2)}\n`)
  if (previous?.version && previous.version !== installedVersion) {
    console.log(`${context.displayName} skill updated: ${target}`)
    console.log(`  ${previous.version} → ${installedVersion}`)
  } else {
    console.log(`${context.displayName} skill installed: ${target} (${installedVersion})`)
  }
  console.log('Next: return to your IDE and state the goal. The agent reads the installed SKILL.md.')
}

export async function checkOfficialSkill(context, explicit) {
  const target = installTarget(context.skillName, explicit)
  const current = readInstallMeta(target)
  if (!current) {
    console.log(`${context.displayName} skill is not installed. Run: npx ${context.npmName}@latest install`)
    process.exitCode = 1
    return
  }
  const installedVersion = requiredString(current.version, 'install-meta.json version')
  const packageVersion = requiredString(current.packageVersion, 'install-meta.json packageVersion')
  console.log(`Installed: ${installedVersion} (package ${packageVersion})`)
  const latest = await fetchLatestVersion(context)
  console.log(`Latest on cli.tax: ${latest.version}`)
  if (installedVersion === latest.version) {
    console.log('Up to date.')
    return
  }
  console.log(`Update available: ${installedVersion} → ${latest.version}`)
  console.log(`Run: npx ${context.npmName}@latest install`)
  process.exitCode = 1
}

export function defaultUsage(context, extraLines) {
  const lines = [
    `${context.npmName} — install and run the ${context.displayName} skill from CLI.Tax`,
    '',
    'Usage:',
    `  npx ${context.npmName}@latest install [directory]`,
    `      Install the ${context.displayName} skill for the current IDE.`,
    `  npx ${context.npmName}@latest check [directory]`,
    '      Check whether the installed skill has a newer version.',
    `  npx ${context.npmName}@latest run`,
    '      Run the skill handshake: discover capabilities and collect intake answers.',
    `Endpoint: ${context.endpoint}`,
  ]
  if (extraLines?.length) lines.push('', ...extraLines)
  return lines.join('\n')
}

export async function runIntakeHandshake(context, spec) {
  const capabilities = await callOfficialSkill(context, 'capabilities', {})
  const output = capabilities.output && typeof capabilities.output === 'object' ? capabilities.output : {}
  const skill = output.skill && typeof output.skill === 'object' ? output.skill : {}
  const version = typeof skill.version === 'string' && skill.version.trim()
    ? skill.version.trim()
    : context.skillVersion
  console.log(`${context.displayName} ${version}`)
  if (typeof spec.afterCapabilities === 'function') spec.afterCapabilities(output)
  const readline = createInterface({ input: stdin, output: stdout })
  const answers = []
  try {
    for (const question of spec.questions) {
      const requiredMark = question.required ? ' (required)' : ''
      console.log(`\n${question.prompt}${requiredMark}`)
      console.log(`Example: ${question.example}`)
      for (;;) {
        const answer = (await readline.question('> ')).trim()
        if (answer) {
          answers.push({ id: question.id, prompt: question.prompt, answer })
          break
        }
        if (!question.required) break
        console.log('This question is required. Please answer before continuing.')
      }
    }
  } finally {
    readline.close()
  }
  const target = join(process.cwd(), spec.outputFile)
  await writeFile(target, `${JSON.stringify({
    schemaVersion: context.schemaVersion,
    endpoint: context.endpoint,
    createdAt: new Date().toISOString(),
    answers,
  }, null, 2)}\n`)
  console.log(`\nRequirements saved: ${target}`)
  console.log('Next: continue in your IDE agent with this file.')
}

export async function dispatchOfficialSkillCli(options) {
  const packageRoot = options.packageRoot ?? dirname(fileURLToPath(options.importMetaUrl))
  const context = loadOfficialSkillContext(packageRoot)
  const args = process.argv.slice(2)
  const command = args[0] ?? 'help'
  const argument = args[1]
  try {
    if (command === 'install') await installOfficialSkill(context, argument)
    else if (command === 'check') await checkOfficialSkill(context, argument)
    else if (command === 'run') await options.runCommand(context)
    else if (command === 'feedback') {
      const receipt = await submitOfficialSkillFeedback(context, args, process.env, fetch)
      console.log(`${context.displayName} feedback accepted: ${receipt.id}`)
    }
    else if (command === 'help' || command === '--help' || command === '-h') {
      console.log(options.usage ? options.usage(context) : defaultUsage(context, options.extraUsageLines))
    } else {
      console.error(`Unknown command: ${command}`)
      console.log(options.usage ? options.usage(context) : defaultUsage(context, options.extraUsageLines))
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
