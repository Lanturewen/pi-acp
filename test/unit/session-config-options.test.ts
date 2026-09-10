import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiAcpAgent } from '../../src/acp/agent.js'
import { FakeAgentSideConnection, asAgentConn } from '../helpers/fakes.js'

class FakeSessions {
  constructor(private readonly session: any) {}

  async create() {
    return this.session
  }

  maybeGet(sessionId: string) {
    if (sessionId !== this.session.sessionId) return undefined
    return this.session
  }

  get(sessionId: string) {
    if (sessionId !== this.session.sessionId) {
      throw new Error(`Unknown sessionId: ${sessionId}`)
    }
    return this.session
  }
}

test('PiAcpAgent: newSession returns configOptions for model and thinking selectors', async () => {
  const realSetTimeout = globalThis.setTimeout
  ;(globalThis as any).setTimeout = () => 0 as any

  const prevAgentDir = process.env.PI_CODING_AGENT_DIR
  const prevEnabled = process.env.PI_ENABLED_MODELS
  const tempAgentDir = mkdtempSync(join(tmpdir(), 'pi-acp-test-agent-'))
  process.env.PI_CODING_AGENT_DIR = tempAgentDir
  delete process.env.PI_ENABLED_MODELS

  try {
    const conn = new FakeAgentSideConnection()
    const session = {
      sessionId: 's1',
      cwd: process.cwd(),
      proc: {
        async getAvailableModels() {
          return {
            models: [
              { provider: 'test', id: 'alpha', name: 'Alpha' },
              { provider: 'test', id: 'beta', name: 'Beta' }
            ]
          }
        },
        async getState() {
          return {
            thinkingLevel: 'high',
            model: { provider: 'test', id: 'beta' }
          }
        }
      },
      setStartupInfo() {},
      sendStartupInfoIfPending() {}
    }

    const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
    ;(agent as any).sessions = new FakeSessions(session) as any

    const result = await agent.newSession({ cwd: process.cwd(), mcpServers: [] } as any)

    assert.equal(result.models?.currentModelId, 'test/beta')
    assert.equal(result.modes?.currentModeId, 'high')
    assert.deepEqual(result.configOptions, [
      {
        type: 'select',
        id: 'model',
        category: 'model',
        name: 'Model',
        description: 'Select the model for this session',
        currentValue: 'test/beta',
        options: [
          { value: 'test/alpha', name: 'Alpha', description: null },
          { value: 'test/beta', name: 'Beta', description: null }
        ]
      },
      {
        type: 'select',
        id: 'thought_level',
        category: 'thought_level',
        name: 'Thinking',
        description: 'Set the reasoning effort for this session',
        currentValue: 'high',
        options: [
          { value: 'off', name: 'off', description: null },
          { value: 'minimal', name: 'minimal', description: null },
          { value: 'low', name: 'low', description: null },
          { value: 'medium', name: 'medium', description: null },
          { value: 'high', name: 'high', description: null },
          { value: 'xhigh', name: 'xhigh', description: null }
        ]
      }
    ])
  } finally {
    ;(globalThis as any).setTimeout = realSetTimeout
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir
    if (prevEnabled === undefined) delete process.env.PI_ENABLED_MODELS
    else process.env.PI_ENABLED_MODELS = prevEnabled
    rmSync(tempAgentDir, { recursive: true, force: true })
  }
})

test('PiAcpAgent: setSessionConfigOption maps model changes to pi and emits config_option_update', async () => {
  const conn = new FakeAgentSideConnection()
  const state = {
    thinkingLevel: 'medium',
    model: { provider: 'test', id: 'alpha' }
  }
  const setModelCalls: Array<{ provider: string; modelId: string }> = []

  const session = {
    sessionId: 's1',
    cwd: process.cwd(),
    proc: {
      async getAvailableModels() {
        return {
          models: [
            { provider: 'test', id: 'alpha', name: 'Alpha' },
            { provider: 'test', id: 'beta', name: 'Beta' }
          ]
        }
      },
      async getState() {
        return state
      },
      async setModel(provider: string, modelId: string) {
        setModelCalls.push({ provider, modelId })
        state.model = { provider, id: modelId }
      }
    }
  }

  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
  ;(agent as any).sessions = new FakeSessions(session) as any

  const result = await agent.setSessionConfigOption({
    sessionId: 's1',
    configId: 'model',
    value: 'test/beta'
  } as any)

  assert.deepEqual(setModelCalls, [{ provider: 'test', modelId: 'beta' }])
  assert.equal(result.configOptions.find(option => option.id === 'model')?.currentValue, 'test/beta')
  assert.deepEqual(conn.updates, [
    {
      sessionId: 's1',
      update: {
        sessionUpdate: 'config_option_update',
        configOptions: result.configOptions
      }
    }
  ])
})

test('PiAcpAgent: setSessionConfigOption maps thought level changes to pi and emits sync updates', async () => {
  const conn = new FakeAgentSideConnection()
  const state = {
    thinkingLevel: 'medium',
    model: { provider: 'test', id: 'alpha' }
  }
  const thinkingLevels: string[] = []

  const session = {
    sessionId: 's1',
    cwd: process.cwd(),
    proc: {
      async getAvailableModels() {
        return {
          models: [{ provider: 'test', id: 'alpha', name: 'Alpha' }]
        }
      },
      async getState() {
        return state
      },
      async setThinkingLevel(level: string) {
        thinkingLevels.push(level)
        state.thinkingLevel = level
      }
    }
  }

  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
  ;(agent as any).sessions = new FakeSessions(session) as any

  const result = await agent.setSessionConfigOption({
    sessionId: 's1',
    configId: 'thought_level',
    value: 'xhigh'
  } as any)

  assert.deepEqual(thinkingLevels, ['xhigh'])
  assert.equal(result.configOptions.find(option => option.id === 'thought_level')?.currentValue, 'xhigh')
  assert.deepEqual(conn.updates, [
    {
      sessionId: 's1',
      update: {
        sessionUpdate: 'current_mode_update',
        currentModeId: 'xhigh'
      }
    },
    {
      sessionId: 's1',
      update: {
        sessionUpdate: 'config_option_update',
        configOptions: result.configOptions
      }
    }
  ])
})

test('PiAcpAgent: dynamically aligns thinking levels with model and preserves custom levels like ultra', async () => {
  const realSetTimeout = globalThis.setTimeout
  ;(globalThis as any).setTimeout = () => 0 as any

  try {
    const conn = new FakeAgentSideConnection()
    const session = {
      sessionId: 's2',
      cwd: process.cwd(),
      proc: {
        async getAvailableModels() {
          return {
            models: [{ provider: 'test', id: 'custom-model', name: 'Custom Model' }]
          }
        },
        async getAvailableThinkingLevels() {
          return ['low', 'medium', 'high', 'xhigh', 'max']
        },
        async getState() {
          return {
            thinkingLevel: 'high',
            model: {
              provider: 'test',
              id: 'custom-model',
              reasoning: true,
              thinkingLevelMap: {
                ultra: 'ultra'
              }
            }
          }
        }
      },
      setStartupInfo() {},
      sendStartupInfoIfPending() {}
    }

    const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
    ;(agent as any).sessions = new FakeSessions(session) as any

    const result = await agent.newSession({ cwd: process.cwd(), mcpServers: [] } as any)

    const thoughtOption = result.configOptions.find(o => o.id === 'thought_level')
    assert.ok(thoughtOption && thoughtOption.type === 'select')
    assert.deepEqual(
      thoughtOption.options.map((o: any) => o.value),
      ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
    )
    assert.equal(result.modes?.currentModeId, 'high')
  } finally {
    ;(globalThis as any).setTimeout = realSetTimeout
  }
})

test('PiAcpAgent: setSessionConfigOption syncs clamped effective level from pi', async () => {
  const conn = new FakeAgentSideConnection()
  const state = {
    thinkingLevel: 'low',
    model: { provider: 'test', id: 'always-on' }
  }

  const session = {
    sessionId: 's3',
    cwd: process.cwd(),
    proc: {
      async getAvailableModels() {
        return {
          models: [{ provider: 'test', id: 'always-on', name: 'Always On' }]
        }
      },
      async getAvailableThinkingLevels() {
        return ['low', 'medium', 'high']
      },
      async getState() {
        return state
      },
      async setThinkingLevel(_level: string) {
        // Model does not support "off", pi clamps it to "low"
        state.thinkingLevel = 'low'
      }
    }
  }

  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
  ;(agent as any).sessions = new FakeSessions(session) as any

  const result = await agent.setSessionConfigOption({
    sessionId: 's3',
    configId: 'thought_level',
    value: 'off'
  } as any)

  assert.equal(result.configOptions.find(option => option.id === 'thought_level')?.currentValue, 'low')
  assert.deepEqual(conn.updates, [
    {
      sessionId: 's3',
      update: {
        sessionUpdate: 'current_mode_update',
        currentModeId: 'low'
      }
    },
    {
      sessionId: 's3',
      update: {
        sessionUpdate: 'config_option_update',
        configOptions: result.configOptions
      }
    }
  ])
})

test('PiAcpAgent: filters available models by enabledModels setting and retains current model', async () => {
  const realSetTimeout = globalThis.setTimeout
  ;(globalThis as any).setTimeout = () => 0 as any

  const prevAgentDir = process.env.PI_CODING_AGENT_DIR
  const prevEnabled = process.env.PI_ENABLED_MODELS
  const tempAgentDir = mkdtempSync(join(tmpdir(), 'pi-acp-test-agent-'))
  process.env.PI_CODING_AGENT_DIR = tempAgentDir
  process.env.PI_ENABLED_MODELS = 'test/alpha,openai/*,antigravity/*'

  try {
    const conn = new FakeAgentSideConnection()
    const session = {
      sessionId: 's4',
      cwd: process.cwd(),
      proc: {
        async getAvailableModels() {
          return {
            models: [
              { provider: 'test', id: 'alpha', name: 'Alpha Model (test)' },
              { provider: 'test', id: 'beta', name: 'Beta Model' },
              { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o' },
              { provider: 'antigravity', id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Antigravity)' },
              { provider: 'anthropic', id: 'claude-3-5', name: 'Claude 3.5' }
            ]
          }
        },
        async getState() {
          return {
            thinkingLevel: 'off',
            // Notice: test/beta is current, even though it is not in PI_ENABLED_MODELS
            model: { provider: 'test', id: 'beta' }
          }
        }
      },
      setStartupInfo() {},
      sendStartupInfoIfPending() {}
    }

    const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
    ;(agent as any).sessions = new FakeSessions(session) as any

    const result = await agent.newSession({ cwd: process.cwd(), mcpServers: [] } as any)

    const modelOption = result.configOptions.find(o => o.id === 'model')
    assert.ok(modelOption && modelOption.type === 'select')
    // test/alpha and openai/gpt-4o match the filter; test/beta is kept because it's current; anthropic/claude-3-5 is filtered out
    assert.deepEqual(
      modelOption.options.map((o: any) => o.value),
      ['test/alpha', 'test/beta', 'openai/gpt-4o', 'antigravity/gemini-3.8-flash']
    )
    // Display names must have provider prefix and trailing parenthesized provider removed
    assert.deepEqual(
      modelOption.options.map((o: any) => o.name),
      ['Alpha Model', 'Beta Model', 'GPT-4o', 'Gemini 3.8 Flash']
    )
  } finally {
    ;(globalThis as any).setTimeout = realSetTimeout
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir
    if (prevEnabled === undefined) delete process.env.PI_ENABLED_MODELS
    else process.env.PI_ENABLED_MODELS = prevEnabled
    rmSync(tempAgentDir, { recursive: true, force: true })
  }
})

