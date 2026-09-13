import { latestOfficialSkillContext } from './official-skill-update.mjs'
import { installTarget, writeManagedSkill } from './installer-storage.mjs'
export { installTarget, readInstallMeta } from './installer-storage.mjs'
import { configureBrainClientCredential } from './broker-credentials.mjs'
/**
 * 八个官方技能共用这一份安装器。packages/*-cli/installer.mjs 必须与本文件字节一致。
 * 禁止第二套超时、第二套版本来源、第二套 bin 名。
 */
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
  LOOKUP_TIMEOUT_MS,
  brokerCommandInput,
  invokeCommandInput,
  invokeOfficialSkill,
  recoverOfficialSkill,
  officialSkillFailureResponse,
} from './broker.mjs'

export {
  CALL_TIMEOUT_MS,
  LOOKUP_TIMEOUT_MS,
  authoritativeEvaluation,
  brainClientAuthorization,
  brainClientTokenPath,
  brokerCommandInput,
  callOfficialSkill,
  invokeCommandInput,
  invokeOfficialSkill,
  recoverOfficialSkill,
  officialSkillFailureResponse,
} from './broker.mjs'

import { createBrokerTransport } from './broker-transport.mjs'

const BROKER_STDIN_MAX_BYTES = 1_048_576

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

export async function fetchLatestVersion(context) {
  const request = createBrokerTransport({ environment: process.env })
  const response = await request(context.latestEndpoint, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`cli.tax skill lookup failed: HTTP ${response.status}`)
  const data = asObject(await response.json(), 'cli.tax skill lookup')
  return {
    version: requiredString(data.version, 'cli.tax skill lookup version'),
    displayName: requiredString(data.displayName, 'cli.tax skill lookup displayName'),
  }
}

function writeInstallationResult(runtime, value) {
  const line = JSON.stringify(value) + '\n'
  if (runtime.writeOutput === undefined) process.stdout.write(line)
  else runtime.writeOutput(line)
}

function installationDependencies(dependencies) {
  return dependencies === undefined ? brokerDependencies() : dependencies
}

export async function installOfficialSkill(context, explicit, dependencies) {
  const runtime = installationDependencies(dependencies)
  const selected = await latestOfficialSkillContext(context, runtime)
  const environment = runtime.environment === undefined ? process.env : runtime.environment
  const workingDirectory = runtime.workingDirectory === undefined ? process.cwd() : runtime.workingDirectory
  const target = installTarget(selected.skillName, explicit, environment, workingDirectory)
  const installed = await writeManagedSkill(selected, target, { ...runtime, allowCreate: true })
  if (installed.status === 'skipped') throw new Error('Skill install refused: ' + installed.reason)
  writeInstallationResult(runtime, { installed, reloadRequired: installed.status !== 'current' })
  return installed
}

export async function checkOfficialSkill(context, explicit, dependencies) {
  const runtime = installationDependencies(dependencies)
  const selected = await latestOfficialSkillContext(context, runtime)
  const environment = runtime.environment === undefined ? process.env : runtime.environment
  const workingDirectory = runtime.workingDirectory === undefined ? process.cwd() : runtime.workingDirectory
  const target = installTarget(selected.skillName, explicit, environment, workingDirectory)
  const installed = await writeManagedSkill(selected, target, runtime)
  if (installed.status === 'skipped') throw new Error('Skill check could not update its managed target: ' + installed.reason)
  writeInstallationResult(runtime, { installed, reloadRequired: installed.status === 'updated' })
  return installed
}

export function defaultUsage(context, extraLines) {
  const lines = [
    `${context.npmName} — install and run the ${context.displayName} skill from CLI.Tax`,
    '',
    'Usage:',
    '  configure < credential.json',
    '      Store the Brain Client credential for this account; never put tokens in command arguments.',
    `  npx ${context.npmName}@latest install [directory]`,
    `      Install the ${context.displayName} skill for the current IDE.`,
    `  npx ${context.npmName}@latest check [directory]`,
    '      Check and atomically update an already managed skill to the current official release.',
    `  npx ${context.npmName}@latest run`,
    "      Run this skill's applicability or onboarding flow; only a real HTTP invocation can trigger automatic evaluation.",
    `  npx ${context.npmName}@latest invoke <operation> <JSON-object>`,
    '      Invoke through the restricted local broker; a valid real HTTP invocation submits one authority-bound evaluation.',
    `  npx ${context.npmName}@latest broker`,
    '      Read one {"operation":"...","input":{...}} request from JSON stdin.',
    `  npx ${context.npmName}@latest recover <operation> <requestId>`,
    '      Query an uncertain invocation without resending or charging again.',
    'Credential: configure reads a token-file JSON document from stdin and stores it once for the current account.',
    'An explicit CLITAX_BRAIN_CLIENT_TOKEN_FILE must be absolute. Revoked keys require a fresh authenticated copy from CLI.Tax.',
    `Endpoint: ${context.endpoint}`,
  ]
  if (extraLines?.length) lines.push('', ...extraLines)
  return lines.join('\n')
}

function brokerDependencies() {
  return { environment: process.env, request: createBrokerTransport({ environment: process.env }) }
}

async function readBrokerSource(input) {
  let source = ''
  for await (const chunk of input) {
    source += chunk
    if (Buffer.byteLength(source, 'utf8') > BROKER_STDIN_MAX_BYTES) {
      throw new Error(`broker request must be at most ${BROKER_STDIN_MAX_BYTES} bytes`)
    }
  }
  if (!source.trim()) throw new Error('broker request is required on stdin')
  return source
}

async function runBrokerInvocation(context, commandInput) {
  try {
    const invocation = await invokeOfficialSkill(
      context, commandInput.operation, commandInput.input, brokerDependencies(),
    )
    console.log(JSON.stringify(invocation))
    return invocation
  } catch (error) {
    const response = officialSkillFailureResponse(error)
    console.log(JSON.stringify({ response }))
    console.error(response.error.message)
    process.exitCode = 1
    return null
  }
}

async function runBrokerRecovery(context, args) {
  if (args.length !== 3) throw new Error('recover requires operation and original requestId')
  try {
    const invocation = await recoverOfficialSkill(context, args[1], args[2], brokerDependencies())
    console.log(JSON.stringify(invocation))
  } catch (error) {
    const response = officialSkillFailureResponse(error)
    console.log(JSON.stringify({ response }))
    console.error(response.error.message)
    process.exitCode = 1
  }
}

export async function runIntakeHandshake(context, spec) {
  const invocation = await invokeOfficialSkill(context, 'capabilities', {}, brokerDependencies())
  const capabilities = invocation.response
  const output = capabilities.output && typeof capabilities.output === 'object' ? capabilities.output : {}
  const skill = output.skill && typeof output.skill === 'object' ? output.skill : {}
  const version = typeof skill.version === 'string' && skill.version.trim()
    ? skill.version.trim()
    : context.skillVersion
  console.log(`${context.displayName} ${version}`)
  console.log(`Automatic feedback accepted: ${invocation.feedback.id}`)
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
    if (command === 'configure') {
      if (args.length !== 1) throw new Error('configure accepts credentials only through JSON stdin')
      const configured = await configureBrainClientCredential(await readBrokerSource(stdin))
      process.stdout.write(JSON.stringify(configured) + '\n')
    }
    else if (command === 'install') await installOfficialSkill(context, argument)
    else if (command === 'check') await checkOfficialSkill(context, argument)
    else if (command === 'run') await options.runCommand(context)
    else if (command === 'recover') await runBrokerRecovery(context, args)
    else if (command === 'invoke') await runBrokerInvocation(context, invokeCommandInput(args))
    else if (command === 'broker') {
      await runBrokerInvocation(context, brokerCommandInput(await readBrokerSource(stdin)))
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
