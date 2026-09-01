import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { resolve, win32 } from 'node:path'

export const LOOKUP_TIMEOUT_MS = 8000
export const CALL_TIMEOUT_MS = 120_000
const FEEDBACK_API_PATH = '/api/v1/telemetry/skill-usage'
const TOKEN_FILE_ENV = 'CLITAX_BRAIN_CLIENT_TOKEN_FILE'
const TOKEN_FILE_VERSION = 'member-brain.client-token-file/1.0'
const AUTH_SCHEME = 'BrainClient'
const TOKEN_FILE_MAX_BYTES = 16_384
const POSIX_TOKEN_FILE_MODE = 0o600
const WINDOWS_BROKER_DIRECTORY = ['CLI.Tax', 'broker']
const FEEDBACK_COMMENT_MAX = 500
const EVALUATION_DURATION_MAX = 86_400_000
const SCORE_MIN = 0
const SCORE_MAX = 100
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const INVOCATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const PROTOCOL_STATUSES = new Set(['succeeded', 'blocked', 'failed'])
const VALIDATION_STATES = new Set(['passed', 'failed', 'incomplete'])
const EVALUATION_SCHEMA = 'skill-automatic-evaluation/1.0'
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const REQUEST_SCHEMA_PATTERN = /^([A-Za-z0-9.-]+\.skill)\.request\/([0-9]+\.[0-9]+)$/
const TRANSPORT_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/
const NETWORK_TRANSPORT_ERROR = 'NETWORK_TRANSPORT'
const SKILL_INVOCATION_ERROR = 'SKILL_INVOCATION_FAILED'

class OfficialSkillInvocationError extends Error {
  constructor(context, operation, transportCode) {
    super(`${context.displayName} ${operation} invocation failed: network transport ${transportCode}`)
    this.name = 'OfficialSkillInvocationError'
    this.code = NETWORK_TRANSPORT_ERROR
    this.operation = operation
    this.retryable = false
    this.transportCode = transportCode
  }
}

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

function boundedInteger(value, label) {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
  return value
}

function insideWindowsDirectory(candidate, directory) {
  const relative = win32.relative(directory, candidate)
  return relative === '' || (!relative.startsWith('..\\') && relative !== '..' && !win32.isAbsolute(relative))
}

export function brainClientTokenPath(environment, platform = process.platform) {
  const configured = requiredString(environment[TOKEN_FILE_ENV], TOKEN_FILE_ENV)
  if (platform !== 'win32') return resolve(configured)
  if (!win32.isAbsolute(configured)) {
    throw new Error('Windows Brain Client token file path must be absolute')
  }
  const localAppData = requiredString(environment.LOCALAPPDATA, 'LOCALAPPDATA')
  const brokerDirectory = win32.resolve(localAppData, ...WINDOWS_BROKER_DIRECTORY)
  const candidate = win32.resolve(configured)
  if (!insideWindowsDirectory(candidate, brokerDirectory)) {
    throw new Error(`Windows Brain Client token file must be inside ${brokerDirectory}`)
  }
  return candidate
}

function assertTokenFileStatus(status, platform, currentUserId) {
  if (!status.isFile() || status.size < 1 || status.size > TOKEN_FILE_MAX_BYTES) {
    throw new Error('Brain Client token file must be a non-empty restricted file')
  }
  if (platform === 'win32') return
  if (!Number.isInteger(currentUserId)) {
    throw new Error('Brain Client token file ownership cannot be verified')
  }
  if (status.uid !== currentUserId || (status.mode & 0o777) !== POSIX_TOKEN_FILE_MODE) {
    throw new Error('Brain Client token file must be owned by the current user with mode 0600')
  }
}

function parseTokenFile(source) {
  let tokenFile
  try {
    tokenFile = asObject(JSON.parse(source), 'Brain Client token file')
  } catch {
    throw new Error('Brain Client token file must contain valid JSON')
  }
  const expectedKeys = ['authorizationScheme', 'endpoint', 'schemaVersion', 'token']
  if (Object.keys(tokenFile).sort().join('\n') !== expectedKeys.join('\n')) {
    throw new Error('Brain Client token file contains unknown or missing fields')
  }
  return tokenFile
}

export async function brainClientAuthorization(context, environment, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform
  const tokenFilePath = brainClientTokenPath(environment, platform)
  const inspectPath = dependencies.lstat ?? lstat
  const openPath = dependencies.open ?? open
  const currentUserId = platform === 'win32'
    ? null
    : (dependencies.getuid ?? process.getuid)?.()
  const linkStatus = await inspectPath(tokenFilePath)
  if (linkStatus.isSymbolicLink()) throw new Error('Brain Client token file cannot be a symlink')
  const noFollow = platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0)
  const handle = await openPath(tokenFilePath, constants.O_RDONLY | noFollow)
  try {
    const status = await handle.stat()
    assertTokenFileStatus(status, platform, currentUserId)
    const tokenFile = parseTokenFile(await handle.readFile('utf8'))
    const endpoint = new URL(requiredString(tokenFile.endpoint, 'Brain Client endpoint'))
    if (tokenFile.schemaVersion !== TOKEN_FILE_VERSION
      || tokenFile.authorizationScheme !== AUTH_SCHEME
      || endpoint.origin !== new URL(context.endpoint).origin
      || endpoint.pathname !== FEEDBACK_API_PATH || endpoint.search || endpoint.hash
      || endpoint.username || endpoint.password
      || !TOKEN_PATTERN.test(tokenFile.token)) {
      throw new Error('Brain Client token file authority is invalid')
    }
    return `${AUTH_SCHEME} ${tokenFile.token}`
  } finally {
    await handle.close()
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('automatic evaluation contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = asObject(value, 'automatic evaluation')
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`
}

function expectedResponseSchema(requestSchema) {
  const matched = requiredString(requestSchema, 'skill request schemaVersion')
    .match(REQUEST_SCHEMA_PATTERN)
  if (!matched) throw new Error('skill request schemaVersion is invalid')
  return `${matched[1]}.response/${matched[2]}`
}

function protocolResponse(protocolValue, requestEnvelope) {
  const protocol = asObject(protocolValue, 'skill protocol response')
  const responseSchema = expectedResponseSchema(requestEnvelope.schemaVersion)
  if (protocol.schemaVersion !== responseSchema) {
    throw new Error('skill protocol response schemaVersion does not match the request')
  }
  if (protocol.requestId !== requestEnvelope.requestId) {
    throw new Error('skill protocol response requestId does not match the request')
  }
  const status = requiredString(protocol.status, 'skill protocol status')
  if (!PROTOCOL_STATUSES.has(status)) {
    throw new Error('skill protocol status must be succeeded, blocked, or failed')
  }
  return { protocol, responseSchema, status }
}

export function authoritativeEvaluation(value, expected) {
  const evaluation = asObject(value, 'server automatic evaluation')
  const expectedKeys = [
    'digest', 'durationMs', 'findingCount', 'operation', 'p0Count', 'p1Count', 'p2Count',
    'requestId', 'responseSchemaVersion', 'schemaVersion', 'score', 'status', 'userComment',
    'validation',
  ]
  if (Object.keys(evaluation).sort().join('\n') !== expectedKeys.join('\n')) {
    throw new Error('server automatic evaluation contains unknown or missing fields')
  }
  if (evaluation.schemaVersion !== EVALUATION_SCHEMA
    || evaluation.operation !== expected.operation
    || evaluation.requestId !== expected.requestId
    || evaluation.responseSchemaVersion !== expected.responseSchema
    || evaluation.status !== expected.status
    || !VALIDATION_STATES.has(evaluation.validation)
    || typeof evaluation.userComment !== 'string' || !evaluation.userComment.trim()
    || Buffer.byteLength(evaluation.userComment, 'utf8') > FEEDBACK_COMMENT_MAX
    || typeof evaluation.digest !== 'string' || !DIGEST_PATTERN.test(evaluation.digest)) {
    throw new Error('server automatic evaluation authority is invalid')
  }
  for (const field of ['durationMs', 'findingCount', 'p0Count', 'p1Count', 'p2Count', 'score']) {
    boundedInteger(evaluation[field], `server automatic evaluation ${field}`)
  }
  if (evaluation.score < SCORE_MIN || evaluation.score > SCORE_MAX
    || evaluation.durationMs > EVALUATION_DURATION_MAX
    || evaluation.findingCount < evaluation.p0Count + evaluation.p1Count + evaluation.p2Count) {
    throw new Error('server automatic evaluation bounds are invalid')
  }
  if ((evaluation.status !== 'succeeded' || evaluation.validation !== 'passed'
    || evaluation.p0Count > 0 || evaluation.p1Count > 0) && evaluation.score >= 60) {
    throw new Error('server automatic evaluation cannot report a positive score')
  }
  const { digest, ...core } = evaluation
  const actualDigest = createHash('sha256').update(canonicalJson(core)).digest('hex')
  if (digest !== actualDigest) throw new Error('server automatic evaluation digest is invalid')
  return evaluation
}

async function responsePayload(response, label) {
  try {
    return asObject(await response.json(), label)
  } catch {
    throw new Error(`${label} is not valid JSON (HTTP ${response.status})`)
  }
}

function invocationRequest(context, operation, input) {
  const normalizedOperation = requiredString(operation, 'skill operation')
  if (!IDENTIFIER_PATTERN.test(normalizedOperation)) {
    throw new Error('skill operation is invalid')
  }
  expectedResponseSchema(context.schemaVersion)
  return {
    schemaVersion: context.schemaVersion,
    requestId: `${context.runtimeCode}-${randomUUID()}`,
    operation: normalizedOperation,
    input: asObject(input, 'skill operation input'),
  }
}

export function transportFailureCode(error) {
  const inspected = new Set()
  let candidate = error
  while (candidate && typeof candidate === 'object' && !inspected.has(candidate)) {
    inspected.add(candidate)
    const code = typeof candidate.code === 'string' ? candidate.code.trim() : ''
    if (TRANSPORT_ERROR_CODE_PATTERN.test(code)) return code
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    if (name === 'AbortError' || name === 'TimeoutError') return name
    candidate = candidate.cause
  }
  return 'UNKNOWN_TRANSPORT_ERROR'
}

export function officialSkillFailureResponse(error) {
  if (error instanceof OfficialSkillInvocationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        operation: error.operation,
        retryable: error.retryable,
        transportCode: error.transportCode,
      },
    }
  }
  return {
    ok: false,
    error: {
      code: SKILL_INVOCATION_ERROR,
      message: error instanceof Error ? error.message : 'Skill invocation failed',
      retryable: false,
    },
  }
}

export async function invokeOfficialSkill(context, operation, input, dependencies) {
  const environment = asObject(dependencies.environment, 'broker environment')
  if (typeof dependencies.request !== 'function') {
    throw new Error('broker request dependency is required')
  }
  const authorization = await brainClientAuthorization(context, environment, dependencies.credentialAccess)
  const requestEnvelope = invocationRequest(context, operation, input)
  let response
  try {
    response = await dependencies.request(context.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ input: requestEnvelope }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
  } catch (error) {
    throw new OfficialSkillInvocationError(context, operation, transportFailureCode(error))
  }
  const payload = await responsePayload(response, `${context.displayName} ${operation} response`)
  if (!response.ok || payload.ok !== true) {
    throw new Error(`${context.displayName} ${operation} failed: HTTP ${response.status}`)
  }
  const invocationId = payload.feedbackInvocationId
  if (typeof invocationId !== 'string' || !INVOCATION_PATTERN.test(invocationId)) {
    throw new Error(`${context.displayName} ${operation} response is missing a valid feedbackInvocationId`)
  }
  const feedbackReceiptId = payload.feedbackReceiptId
  const feedbackRequestId = payload.feedbackRequestId
  if (typeof feedbackReceiptId !== 'string' || !INVOCATION_PATTERN.test(feedbackReceiptId)
    || feedbackRequestId !== `automatic-${invocationId}`) {
    throw new Error(`${context.displayName} ${operation} response is missing a committed feedback receipt`)
  }
  const protocolAuthority = protocolResponse(payload.output, requestEnvelope)
  const evaluation = authoritativeEvaluation(payload.feedbackEvaluation, {
    operation: requestEnvelope.operation,
    requestId: requestEnvelope.requestId,
    responseSchema: protocolAuthority.responseSchema,
    status: protocolAuthority.status,
  })
  const feedback = {
    id: feedbackReceiptId,
    requestId: feedbackRequestId,
    duplicated: false,
  }
  return { response: payload, invocationId, evaluation, feedback }
}

export async function callOfficialSkill(context, operation, input, dependencies) {
  return (await invokeOfficialSkill(context, operation, input, dependencies)).response
}

export function invokeCommandInput(args) {
  const operation = requiredString(args[1], 'skill operation')
  const source = args.slice(2).join(' ').trim()
  if (!source) return { operation, input: {} }
  try {
    return { operation, input: asObject(JSON.parse(source), 'skill operation input') }
  } catch {
    throw new Error('skill operation input must be a JSON object')
  }
}

export function brokerCommandInput(source) {
  let parsed
  try {
    parsed = asObject(JSON.parse(source), 'broker request')
  } catch {
    throw new Error('broker request must be a JSON object')
  }
  if (Object.keys(parsed).some((key) => !['operation', 'input'].includes(key))) {
    throw new Error('broker request contains unknown fields')
  }
  return {
    operation: requiredString(parsed.operation, 'skill operation'),
    input: asObject(parsed.input, 'skill operation input'),
  }
}
