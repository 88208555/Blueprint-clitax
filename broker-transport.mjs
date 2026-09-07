import { Agent, request as httpsRequest } from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'
import { attemptBrokerHttps } from './broker-transport-attempt.mjs'

export const BROKER_TRANSPORT_TIMEOUT_MS = 120_000
export const BROKER_TRANSPORT_CONNECT_TIMEOUT_MS = 8_000
export const BROKER_TRANSPORT_MAX_ATTEMPTS = 3
export const BROKER_TRANSPORT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const RETRY_DELAY_MS = 150
const PROXY_KEYS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy']
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'])
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/

export class BrokerTransportError extends Error {
  constructor(code, transport) {
    const safeCode = typeof code === 'string' && CODE_PATTERN.test(code) ? code : 'BROKER_TRANSPORT_FAILED'
    super(`HTTPS broker transport failed (${safeCode})`)
    this.name = 'BrokerTransportError'
    this.code = safeCode
    this.transport = Object.freeze({ ...transport })
  }
}

/** Native Agent proxyEnv: https://nodejs.org/api/https.html#new-agentoptions */
export function brokerProxyEnvironment(environment, nodeVersion = process.versions.node) {
  const proxyEnv = {}
  for (const key of PROXY_KEYS) {
    if (environment[key] !== undefined) {
      if (typeof environment[key] !== 'string') throw new Error('BROKER_PROXY_ENV_INVALID')
      proxyEnv[key] = environment[key]
    }
  }
  const hasProxy = PROXY_KEYS.slice(0, 4).some(key => typeof proxyEnv[key] === 'string' && proxyEnv[key].trim())
  const version = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(nodeVersion)
  if (!version) throw new Error('BROKER_NODE_VERSION_INVALID')
  const major = Number(version[1]), minor = Number(version[2])
  const supportsProxy = major > 24 || major === 24 && minor >= 5 || major === 22 && minor >= 21
  if (hasProxy && !supportsProxy) throw new Error('BROKER_PROXY_UNSUPPORTED_NODE')
  for (const key of PROXY_KEYS.slice(0, 4)) {
    if (!proxyEnv[key]) continue
    let proxy
    try { proxy = new URL(proxyEnv[key]) } catch { throw new Error('BROKER_PROXY_ENV_INVALID') }
    if (!['http:', 'https:'].includes(proxy.protocol)) throw new Error('BROKER_PROXY_ENV_INVALID')
  }
  return supportsProxy ? { proxyEnv } : {}
}

function requestInput(url, options) {
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('BROKER_HTTPS_REQUIRED')
  const method = options.method === undefined ? 'GET' : options.method
  if (typeof method !== 'string' || !/^[A-Z]+$/.test(method)) throw new Error('BROKER_METHOD_INVALID')
  const headers = new Headers(options.headers)
  headers.set('accept-encoding', 'identity')
  const source = options.body
  if (source !== undefined && source !== null && typeof source !== 'string' && !(source instanceof Uint8Array)) {
    throw new Error('BROKER_BODY_INVALID')
  }
  const body = source === undefined || source === null ? undefined : Buffer.from(source)
  if (body !== undefined) headers.set('content-length', String(body.length))
  return { target, method, headers: Object.fromEntries(headers), body }
}

function overallSignal(external) {
  const controller = new AbortController()
  const abort = () => controller.abort(external.reason)
  if (external?.aborted) controller.abort(external.reason)
  else external?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('ETIMEDOUT')), BROKER_TRANSPORT_TIMEOUT_MS)
  timer.unref()
  return { signal: controller.signal, cleanup() {
    clearTimeout(timer)
    external?.removeEventListener('abort', abort)
  } }
}

/** Dependencies support isolated native TLS tests; production callers supply only environment. */
export function createBrokerTransport({ environment = process.env, request = httpsRequest,
  createAgent = options => new Agent(options), nodeVersion = process.versions.node } = {}) {
  return async function brokerRequest(url, options = {}) {
    const state = { attempts: 0, stage: 'configuration', submitted: false }
    let configured
    try { configured = { ...requestInput(url, options), agentOptions: brokerProxyEnvironment(environment, nodeVersion) } }
    catch (error) { throw new BrokerTransportError(error.message, state) }
    const overall = overallSignal(options.signal)
    try {
      for (let number = 1; number <= BROKER_TRANSPORT_MAX_ATTEMPTS; number += 1) {
        if (overall.signal.aborted) throw new BrokerTransportError('ABORT_ERR', state)
        state.attempts = number
        state.stage = 'connecting'
        try {
          return await attemptBrokerHttps(configured, { request, createAgent, signal: overall.signal, state,
            connectTimeoutMs: BROKER_TRANSPORT_CONNECT_TIMEOUT_MS, maxResponseBytes: BROKER_TRANSPORT_MAX_RESPONSE_BYTES,
            failure: code => new BrokerTransportError(code, state) })
        } catch (error) {
          const failure = error instanceof BrokerTransportError ? error : new BrokerTransportError(error.code, state)
          const reconnect = !state.submitted && !overall.signal.aborted && TRANSIENT_CODES.has(failure.code)
            && number < BROKER_TRANSPORT_MAX_ATTEMPTS
          if (!reconnect) throw failure
          try { await delay(RETRY_DELAY_MS, undefined, { signal: overall.signal }) }
          catch { throw new BrokerTransportError('ABORT_ERR', state) }
        }
      }
      throw new BrokerTransportError('BROKER_TRANSPORT_ATTEMPTS_EXHAUSTED', state)
    } finally { overall.cleanup() }
  }
}
