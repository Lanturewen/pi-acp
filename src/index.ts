import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'
import { PiAcpAgent } from './acp/agent.js'
import { getPiCommand, shouldUseShellForPiCommand } from './pi-rpc/command.js'
// Terminal Auth entrypoint. The ACP client launches the agent with `--terminal-login`.
if (process.argv.includes('--terminal-login')) {
  const { spawnSync } = await import('node:child_process')
  const cmd = getPiCommand(process.env.PI_ACP_PI_COMMAND)
  const res = spawnSync(cmd, [], {
    stdio: 'inherit',
    env: process.env,
    shell: shouldUseShellForPiCommand(cmd)
  })

  if ((res as any).error && (res as any).error.code === 'ENOENT') {
    process.stderr.write(
      `pi-acp: could not start pi (command not found: ${cmd}). Install it via \`npm install -g @earendil-works/pi-coding-agent\` or ensure \`pi\` is on your PATH.\n`
    )
    process.exit(1)
  }

  process.exit(typeof res.status === 'number' ? res.status : 1)
}

const input = new WritableStream<Uint8Array>({
  write(chunk) {
    return new Promise<void>(resolve => {
      if ((process.stdout as any).destroyed || !process.stdout.writable) return resolve()

      try {
        process.stdout.write(chunk, err => {
          void err
          resolve()
        })
      } catch {
        // Common: ERR_STREAM_DESTROYED ("Cannot call write after a stream was destroyed").
        resolve()
      }
    })
  }
})

const output = new ReadableStream<Uint8Array>({
  start(controller) {
    process.stdin.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
    process.stdin.on('end', () => controller.close())
    process.stdin.on('error', err => controller.error(err))
  }
})

const stream = ndJsonStream(input, output)

const agentHolder: { agent?: PiAcpAgent } = {}

function wrapAcpStream(
  rawStream: { readable: ReadableStream<any>; writable: WritableStream<any> },
  holder: { agent?: PiAcpAgent }
) {
  const requestIdToSession = new Map<string, string>()

  const readable = rawStream.readable.pipeThrough(
    new TransformStream<any, any>({
      transform(message, controller) {
        if (message && typeof message === 'object') {
          const id = message.id != null ? String(message.id) : null
          const sessionId = typeof message.params?.sessionId === 'string' ? message.params.sessionId : null

          if (id && sessionId) {
            requestIdToSession.set(id, sessionId)
            holder.agent?.registerRequestIdSession(id, sessionId)
          }

          if (message.method === '$/cancel_request') {
            const rawReqId = message.params?.requestId ?? message.params?.id
            const reqId = rawReqId != null ? String(rawReqId) : null
            const targetSessionId = reqId ? requestIdToSession.get(reqId) : null

            // If it's a notification (no id) and we found the target session,
            // translate it to standard ACP session/cancel notification.
            // If it has an id (a request), let AgentSideConnection handle it
            // via extMethod so that a proper response is sent back to Zed!
            if (!message.id && targetSessionId) {
              controller.enqueue({
                jsonrpc: '2.0',
                method: 'session/cancel',
                params: { sessionId: targetSessionId }
              })
              return
            }
          }
        }
        controller.enqueue(message)
      }
    })
  )

  const transformWritable = new TransformStream<any, any>({
    transform(message, controller) {
      if (message && typeof message === 'object' && message.id != null) {
        const id = String(message.id)
        requestIdToSession.delete(id)
        holder.agent?.unregisterRequestId(id)
      }
      controller.enqueue(message)
    }
  })
  void transformWritable.readable.pipeTo(rawStream.writable).catch(() => {})

  return {
    readable,
    writable: transformWritable.writable
  }
}

const wrappedStream = wrapAcpStream(stream, agentHolder)

const _agent = new AgentSideConnection(conn => {
  const a = new PiAcpAgent(conn)
  agentHolder.agent = a
  return a
}, wrappedStream)

function shutdown() {
  try {
    // Best-effort: dispose session subprocesses when the client disconnects.
    agentHolder.agent?.dispose?.()
  } catch {
    // ignore
  }
  try {
    process.exit(0)
  } catch {
    // ignore
  }
}

process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)

process.stdin.resume()
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Avoid crashing if the client closes stdout early.
process.stdout.on('error', () => {
  try {
    process.exit(0)
  } catch {
    // ignore
  }
})
