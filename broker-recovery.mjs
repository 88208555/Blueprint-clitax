import { OfficialSkillResponseError, transportFailureCode, transportDiagnostics } from './broker-failures.mjs'

export const SKILL_RECEIPT_SCHEMA = 'skill-runtime-receipt/1.0'
export const SKILL_RECEIPT_HEADER = 'X-Skill-Receipt'
const RECEIPT_API_PATH = '/api/v1/skill-invocations'
const QUERY_TIMEOUT_MS = 5_000
const QUERY_ATTEMPTS = 3
const QUERY_DELAY_MS = 250
const TERMINAL_STATUSES = new Set(['completed', 'failed'])
const RECEIPT_STATUSES = new Set([...TERMINAL_STATUSES, 'pending', 'expired', 'not-found'])

class ReceiptRecoveryError extends OfficialSkillResponseError {
  constructor(request, status, message, transportCode) {
    super(request, 'receipt-query', message)
    this.name = 'ReceiptRecoveryError'
    this.code = 'SKILL_INVOCATION_UNCERTAIN'
    this.receiptStatus = status
    if (transportCode) this.transportCode = transportCode
  }
}

function validateReceipt(response, payload, context, request) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || payload.schemaVersion !== SKILL_RECEIPT_SCHEMA || payload.runtimeCode !== context.runtimeCode
    || payload.requestId !== request.requestId || !RECEIPT_STATUSES.has(payload.status)) {
    throw new ReceiptRecoveryError(request, 'invalid', 'Receipt query returned invalid or mismatched execution identity')
  }
  const expectedHttpStatus = payload.status === 'pending' ? 202
    : payload.status === 'expired' ? 410 : payload.status === 'not-found' ? 404 : 200
  if (response.status !== expectedHttpStatus || (payload.status !== 'not-found'
    && !Number.isFinite(Date.parse(payload.expiresAt)))) {
    throw new ReceiptRecoveryError(request, 'invalid', 'Receipt status or expiration metadata is invalid')
  }
  if (TERMINAL_STATUSES.has(payload.status) && (!Number.isInteger(payload.httpStatus)
    || payload.httpStatus < 100 || payload.httpStatus > 599 || !payload.response
    || typeof payload.response !== 'object' || Array.isArray(payload.response))) {
    throw new ReceiptRecoveryError(request, 'invalid', 'Receipt has no valid recorded HTTP result')
  }
  if (payload.status === 'failed' && (payload.httpStatus < 400
    || typeof payload.response.error !== 'string' || typeof payload.response.code !== 'string')) {
    throw new ReceiptRecoveryError(request, 'invalid', 'Failed receipt has no valid recorded error')
  }
  return payload
}

async function fetchReceipt(context, request, dependencies, authorization) {
  const endpoint = new URL(context.endpoint)
  const path = `${RECEIPT_API_PATH}/${encodeURIComponent(context.runtimeCode)}/${encodeURIComponent(request.requestId)}`
  let response
  let payload
  try {
    response = await dependencies.request(new URL(path, endpoint.origin).href, {
      method: 'GET', redirect: 'error', headers: { Authorization: authorization },
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    })
  } catch (error) {
    throw new ReceiptRecoveryError(request, 'query-failed', 'Receipt query failed; execution outcome remains uncertain',
      transportFailureCode(error))
  }
  if (response.status === 401 || response.status === 403) {
    throw new ReceiptRecoveryError(request, 'unauthorized', `Receipt query authorization failed: HTTP ${response.status}`)
  }
  try {
    payload = await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) throw new ReceiptRecoveryError(request, 'invalid', 'Receipt query returned invalid JSON')
    throw new ReceiptRecoveryError(request, 'query-failed', 'Receipt body was interrupted; execution outcome remains uncertain',
      transportFailureCode(error))
  }
  return { receipt: validateReceipt(response, payload, context, request), transport: transportDiagnostics(response.transport) }
}

function receiptOutcome(receipt, context, request, validateInvocation, transport) {
  if (receipt.status === 'failed') {
    throw new OfficialSkillResponseError(request, 'http-response',
      `${context.displayName} ${request.operation} failed: HTTP ${receipt.httpStatus} (recorded receipt)`)
  }
  if (receipt.httpStatus !== 200 || receipt.response.ok !== true) {
    throw new ReceiptRecoveryError(request, 'invalid', 'Completed receipt does not contain a successful HTTP response')
  }
  try {
    const invocation = validateInvocation(receipt.response)
    return { ...invocation, recovery: { status: 'completed', requestId: request.requestId },
      ...(transport ? { transport } : {}) }
  } catch (error) {
    throw new OfficialSkillResponseError(request, 'receipt-validation',
      error instanceof Error ? error.message : 'Recorded skill response validation failed')
  }
}

export async function queryOfficialSkillReceipt(context, request, dependencies, authorization, validateInvocation) {
  let lastFailure
  for (let attempt = 0; attempt < QUERY_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, QUERY_DELAY_MS))
    let fetched
    try {
      fetched = await fetchReceipt(context, request, dependencies, authorization)
    } catch (error) {
      if (!(error instanceof ReceiptRecoveryError) || error.receiptStatus !== 'query-failed') throw error
      lastFailure = error
      continue
    }
    const { receipt, transport } = fetched
    if (TERMINAL_STATUSES.has(receipt.status)) return receiptOutcome(receipt, context, request, validateInvocation, transport)
    lastFailure = new ReceiptRecoveryError(request, receipt.status,
      `Invocation outcome is ${receipt.status}; query this requestId again before any new execution`)
    if (receipt.status !== 'pending') throw lastFailure
  }
  throw lastFailure
}
