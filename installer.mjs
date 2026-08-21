/**
 * 五个官方技能共用这一份安装器。packages/*-cli/installer.mjs 必须与本文件字节一致。
 * 禁止第二套超时、第二套版本来源、第二套 bin 名。
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

export const LOOKUP_TIMEOUT_MS = 8000
export const CALL_TIMEOUT_MS = 120_000
const INSTALL_META = 'install-meta.json'

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

export async function installOfficialSkill(context, explicit) {
  const target = installTarget(context.skillName, explicit)
  await mkdir(target, { recursive: true })
  const previous = readInstallMeta(target)
  await copyFile(join(context.skillDir, 'SKILL.md'), join(target, 'SKILL.md'))
  await copyFile(join(context.skillDir, 'skill.json'), join(target, 'skill.json'))
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
    '',
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
