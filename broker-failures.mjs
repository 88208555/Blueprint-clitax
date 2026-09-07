const TRANSPORT_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/
const NETWORK_TRANSPORT_ERROR = 'NETWORK_TRANSPORT'
const SKILL_INVOCATION_ERROR = 'SKILL_INVOCATION_FAILED'
const TRANSPORT_STAGES = new Set(['configuration', 'connecting', 'tls', 'request-sent', 'response-body', 'complete'])
const MAX_TRANSPORT_ATTEMPTS = 3

export function transportDiagnostics(value) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.attempts)
    || value.attempts < 0 || value.attempts > MAX_TRANSPORT_ATTEMPTS
    || !TRANSPORT_STAGES.has(value.stage) || typeof value.submitted !== 'boolean') return null
  return { attempts: value.attempts, stage: value.stage, submitted: value.submitted }
}

export class OfficialSkillInvocationError extends Error {
  constructor(context, request, transportCode, stage, transport) {
    super(`${context.displayName} ${request.operation} invocation failed: network transport ${transportCode}`)
    this.name = 'OfficialSkillInvocationError'
    this.code = NETWORK_TRANSPORT_ERROR
    this.requestId = request.requestId
    this.operation = request.operation
    const diagnostic = transportDiagnostics(transport)
    this.stage = diagnostic ? diagnostic.stage : stage
    if (diagnostic) this.transport = diagnostic
    this.retryable = false
    this.transportCode = transportCode
  }
}

export class OfficialSkillResponseError extends Error {
  constructor(request, stage, message) {
    super(message)
    this.name = 'OfficialSkillResponseError'
    this.code = SKILL_INVOCATION_ERROR
    this.requestId = request.requestId
    this.operation = request.operation
    this.stage = stage
    this.retryable = false
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
  if (error instanceof OfficialSkillInvocationError || error instanceof OfficialSkillResponseError) {
    const failure = { code: error.code, message: error.message, requestId: error.requestId,
      operation: error.operation, stage: error.stage, retryable: error.retryable }
    if (typeof error.transportCode === 'string') failure.transportCode = error.transportCode
    if (typeof error.receiptStatus === 'string') failure.receiptStatus = error.receiptStatus
    if (error.recovery) failure.recovery = error.recovery
    const diagnostic = transportDiagnostics(error.transport)
    if (diagnostic) failure.transport = diagnostic
    return { ok: false, error: failure }
  }
  return { ok: false, error: { code: SKILL_INVOCATION_ERROR,
    message: error instanceof Error ? error.message : 'Skill invocation failed', retryable: false } }
}
