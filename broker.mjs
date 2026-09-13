import { createHash, randomUUID } from 'node:crypto'
import { brainClientAuthorization } from './broker-credentials.mjs'
import { prepareOfficialSkillUse, withUpgradeMetadata } from './official-skill-update.mjs'
export { brainClientAuthorization, brainClientTokenPath } from './broker-credentials.mjs'
export { LOOKUP_TIMEOUT_MS } from './official-skill-update.mjs'
import { OfficialSkillInvocationError, OfficialSkillResponseError, transportFailureCode, transportDiagnostics } from './broker-failures.mjs'
import { queryOfficialSkillReceipt, SKILL_RECEIPT_HEADER, SKILL_RECEIPT_SCHEMA } from './broker-recovery.mjs'
export { officialSkillFailureResponse, transportFailureCode } from './broker-failures.mjs'

export const CALL_TIMEOUT_MS = 120_000
const FEEDBACK_COMMENT_MAX = 500
const EVALUATION_DURATION_MAX = 86_400_000
const SCORE_MIN = 0
const SCORE_MAX = 100
const INVOCATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const PROTOCOL_STATUSES = new Set(['succeeded', 'blocked', 'failed'])
const VALIDATION_STATES = new Set(['passed', 'failed', 'incomplete'])
const EVALUATION_SCHEMA = 'skill-automatic-evaluation/1.0'
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const REQUEST_SCHEMA_PATTERN = /^([A-Za-z0-9.-]+\.skill)\.request\/([0-9]+\.[0-9]+)$/

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

async function responsePayload(response, context, request) {
  const label = `${context.displayName} ${request.operation} response`
  if (response.status === 401 || response.status === 403) {
    throw new OfficialSkillResponseError(request, 'http-response', 'Brain Client authorization was rejected; copy the current authenticated setup from CLI.Tax and run configure again. Revoked credentials cannot renew themselves.')
  }
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new OfficialSkillResponseError(request, 'response-parse', `${label} is not valid JSON (HTTP ${response.status})`)
    }
    throw new OfficialSkillInvocationError(context, request, transportFailureCode(error), 'response-body', error?.transport)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new OfficialSkillResponseError(request, 'response-validation', `${label} must be an object`)
  }
  return payload
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

export async function invokeOfficialSkill(context, operation, input, dependencies) {
  const prepared = await prepareOfficialSkillUse(context, 'broker.mjs', dependencies)
  if (prepared.module !== null) return withUpgradeMetadata(
    await prepared.module.invokeOfficialSkill(prepared.context, operation, input, dependencies), prepared.upgrade)
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
      headers: { 'Content-Type': 'application/json', Authorization: authorization,
        [SKILL_RECEIPT_HEADER]: SKILL_RECEIPT_SCHEMA },
      body: JSON.stringify({ input: requestEnvelope }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
  } catch (error) {
    const failure = new OfficialSkillInvocationError(context, requestEnvelope, transportFailureCode(error), 'request', error?.transport)
    return withUpgradeMetadata(await recoverTransportFailure(context, requestEnvelope, dependencies, authorization, failure), prepared.upgrade)
  }
  let payload
  try {
    payload = await responsePayload(response, context, requestEnvelope)
  } catch (error) {
    if (!(error instanceof OfficialSkillInvocationError)) throw error
    return withUpgradeMetadata(await recoverTransportFailure(context, requestEnvelope, dependencies, authorization, error), prepared.upgrade)
  }
  if (!response.ok || payload.ok !== true) {
    throw new OfficialSkillResponseError(requestEnvelope, 'http-response', `${context.displayName} ${operation} failed: HTTP ${response.status}`)
  }
  try {
    const invocation = validateInvocationResponse(context, operation, payload, requestEnvelope)
    const transport = transportDiagnostics(response.transport)
    return withUpgradeMetadata(transport ? { ...invocation, transport } : invocation, prepared.upgrade)
  } catch (error) {
    throw new OfficialSkillResponseError(requestEnvelope, 'response-validation',
      error instanceof Error ? error.message : 'Skill response validation failed')
  }
}

async function recoverTransportFailure(context, request, dependencies, authorization, failure) {
  if (failure.transport?.submitted === false) throw failure
  try {
    const invocation = await queryOfficialSkillReceipt(context, request, dependencies, authorization,
      (payload) => validateInvocationResponse(context, request.operation, payload, request))
    return failure.transport ? { ...invocation, transport: failure.transport } : invocation
  } catch (error) {
    if (!(error instanceof OfficialSkillResponseError) || error.code !== 'SKILL_INVOCATION_UNCERTAIN') throw error
    failure.recovery = { status: error.receiptStatus, message: error.message }
    throw failure
  }
}

export async function recoverOfficialSkill(context, operation, requestId, dependencies) {
  const normalizedOperation = requiredString(operation, 'skill operation')
  const normalizedRequestId = requiredString(requestId, 'skill requestId')
  if (!IDENTIFIER_PATTERN.test(normalizedOperation) || !IDENTIFIER_PATTERN.test(normalizedRequestId)) {
    throw new Error('skill recovery identity is invalid')
  }
  expectedResponseSchema(context.schemaVersion)
  const environment = asObject(dependencies.environment, 'broker environment')
  if (typeof dependencies.request !== 'function') throw new Error('broker request dependency is required')
  const authorization = await brainClientAuthorization(context, environment, dependencies.credentialAccess)
  const request = { schemaVersion: context.schemaVersion, requestId: normalizedRequestId, operation: normalizedOperation }
  return queryOfficialSkillReceipt(context, request, dependencies, authorization,
    (payload) => validateInvocationResponse(context, normalizedOperation, payload, request))
}

function validateInvocationResponse(context, operation, payload, requestEnvelope) {
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
