import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpAgent } from '../../src/acp/agent.js'
import { PiAcpSession } from '../../src/acp/session.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

test('PiAcpAgent: extNotification handles $/cancel_request and aborts active session', async () => {
  const conn = new FakeAgentSideConnection()
  const agent = new PiAcpAgent(asAgentConn(conn))

  const proc = new FakePiRpcProcess()
  const session = new PiAcpSession({
    sessionId: 'sess-1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  // Register session into manager by overriding or accessing internal sessions
  ;(agent as any).sessions.sessions.set('sess-1', session)

  // Start a prompt turn
  const promptPromise = session.prompt('long running task')
  assert.equal(session.isRunning(), true)

  // Client sends $/cancel_request notification with requestId
  agent.registerRequestIdSession('req-42', 'sess-1')
  await agent.extNotification('$/cancel_request', { requestId: 'req-42' })

  // Verify cancel was triggered and proc was aborted
  assert.equal(proc.abortCount, 1)
  assert.equal(session.wasCancelRequested(), true)

  // Complete turn via simulated settled event
  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })

  const result = await promptPromise
  assert.equal(result, 'cancelled')
})

test('PiAcpAgent: extNotification handles $/cancel_request fallback for running session without registered id', async () => {
  const conn = new FakeAgentSideConnection()
  const agent = new PiAcpAgent(asAgentConn(conn))

  const proc = new FakePiRpcProcess()
  const session = new PiAcpSession({
    sessionId: 'sess-2',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  ;(agent as any).sessions.sessions.set('sess-2', session)

  const promptPromise = session.prompt('task')
  assert.equal(session.isRunning(), true)

  // Unknown or untracked requestId
  await agent.extNotification('$/cancel_request', { requestId: 'unknown-id' })

  assert.equal(proc.abortCount, 1)
  assert.equal(session.wasCancelRequested(), true)

  proc.emit({ type: 'agent_settled' })
  assert.equal(await promptPromise, 'cancelled')
})

test('PiAcpAgent: extMethod handles $/cancel_request without throwing methodNotFound', async () => {
  const conn = new FakeAgentSideConnection()
  const agent = new PiAcpAgent(asAgentConn(conn))

  const res = await agent.extMethod('$/cancel_request', { requestId: 'nonexistent' })
  assert.deepEqual(res, {})
})
