function responseValue(message, chunks, state) {
  const headers = new Headers()
  for (let index = 0; index < message.rawHeaders.length; index += 2) {
    headers.append(message.rawHeaders[index], message.rawHeaders[index + 1])
  }
  const status = message.statusCode
  if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error('BROKER_RESPONSE_STATUS_INVALID')
  const body = Buffer.concat(chunks)
  const emptyBody = status === 204 || status === 205 || status === 304
  const response = new Response(emptyBody ? null : body, { status, headers })
  response.transport = Object.freeze({ ...state, stage: 'complete' })
  return response
}

/** No write/end/flushHeaders is permitted before the destination TLS socket is authenticated. */
export function attemptBrokerHttps(input, dependencies) {
  return new Promise((resolve, reject) => {
    const { state, signal, failure } = dependencies
    const agent = dependencies.createAgent({ ...input.agentOptions, keepAlive: false, maxSockets: 1, maxCachedSessions: 0 })
    let request
    let settled = false
    let connectTimer
    const cleanup = () => {
      clearTimeout(connectTimer)
      signal.removeEventListener('abort', abort)
      agent.destroy()
    }
    const finishError = code => {
      if (settled) return
      settled = true
      const error = failure(code)
      request?.destroy()
      cleanup()
      reject(error)
    }
    const abort = () => finishError('ABORT_ERR')
    const receive = response => {
      state.stage = 'response-body'
      const chunks = []
      let bytes = 0
      response.on('error', error => finishError(error.code))
      response.on('aborted', () => finishError('BROKER_RESPONSE_TRUNCATED'))
      response.on('close', () => { if (!response.complete) finishError('BROKER_RESPONSE_TRUNCATED') })
      response.on('data', chunk => {
        bytes += chunk.length
        if (bytes > dependencies.maxResponseBytes) finishError('BROKER_RESPONSE_TOO_LARGE')
        else chunks.push(chunk)
      })
      response.on('end', () => {
        if (settled) return
        if (!response.complete) return finishError('BROKER_RESPONSE_TRUNCATED')
        const coding = response.headers['content-encoding']
        if (coding !== undefined && coding !== 'identity') return finishError('BROKER_RESPONSE_ENCODING_UNSUPPORTED')
        let value
        try { value = responseValue(response, chunks, state) }
        catch (error) { return finishError(error.message) }
        settled = true
        cleanup()
        resolve(value)
      })
    }
    try {
      request = dependencies.request(input.target, { method: input.method, headers: input.headers, agent,
        rejectUnauthorized: true }, receive)
      request.on('error', error => finishError(error.code))
      request.once('socket', socket => {
        state.stage = 'tls'
        const send = () => {
          if (settled) return
          if (signal.aborted) return abort()
          if (socket.encrypted !== true || socket.authorized !== true) return finishError('BROKER_TLS_UNAUTHORIZED')
          clearTimeout(connectTimer)
          state.stage = 'request-sent'
          state.submitted = true
          try { request.end(input.body) } catch (error) { finishError(error.code) }
        }
        if (socket.encrypted === true && socket.authorized === true) send()
        else socket.once('secureConnect', send)
      })
      connectTimer = setTimeout(() => finishError('ETIMEDOUT'), dependencies.connectTimeoutMs)
      connectTimer.unref()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    } catch (error) { finishError(error.code) }
  })
}
