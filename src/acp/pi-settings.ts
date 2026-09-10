import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === 'object' && !Array.isArray(x)
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    const av = out[k]
    if (isObject(av) && isObject(v)) out[k] = deepMerge(av, v)
    else out[k] = v
  }
  return out
}

function readJsonFile(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {}
    const raw = readFileSync(path, 'utf-8')
    const data = JSON.parse(raw)
    return isObject(data) ? data : {}
  } catch {
    return {}
  }
}

function getMergedSettings(cwd: string): Record<string, unknown> {
  const globalSettingsPath = join(getAgentDir(), 'settings.json')
  const projectSettingsPath = resolve(cwd, '.pi', 'settings.json')

  const global = readJsonFile(globalSettingsPath)
  const project = readJsonFile(projectSettingsPath)
  return deepMerge(global, project)
}

export function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ? resolve(process.env.PI_CODING_AGENT_DIR) : join(homedir(), '.pi', 'agent')
}

/**
 * Mirror pi settings semantics (global + project merge, project overrides global).
 * Only returns the bits we currently need.
 */
export function getEnableSkillCommands(cwd: string): boolean {
  const merged = getMergedSettings(cwd)

  const direct = merged.enableSkillCommands
  if (typeof direct === 'boolean') return direct

  // Back-compat: some versions used skills.enableSkillCommands
  const nested = isObject(merged.skills) ? merged.skills.enableSkillCommands : undefined
  if (typeof nested === 'boolean') return nested

  return true
}

/**
 * Mirror pi's quietStartup setting: if true, pi suppresses the verbose startup prelude.
 * We use it to decide whether to synthesize + emit our own "startup info" message.
 */
export function getQuietStartup(cwd: string): boolean {
  const merged = getMergedSettings(cwd)

  const direct = merged.quietStartup
  if (typeof direct === 'boolean') return direct

  // Back-compat: some versions used quietStart
  const legacy = (merged as any).quietStart
  if (typeof legacy === 'boolean') return legacy

  return false
}

/**
 * Mirror pi's enabledModels setting (array of model glob/ID patterns).
 * Checks PI_ENABLED_MODELS env var first, then merged project + global settings.json.
 */
export function getEnabledModels(cwd?: string): string[] | null {
  if (process.env.PI_ENABLED_MODELS) {
    const raw = process.env.PI_ENABLED_MODELS.trim()
    try {
      if (raw.startsWith('[')) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean)
      }
    } catch {
      // ignore
    }
    return raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }

  if (cwd) {
    const merged = getMergedSettings(cwd)
    if (Array.isArray(merged.enabledModels)) {
      return merged.enabledModels.map(String).filter(Boolean)
    }
  } else {
    const globalSettingsPath = join(getAgentDir(), 'settings.json')
    const global = readJsonFile(globalSettingsPath)
    if (Array.isArray(global.enabledModels)) {
      return global.enabledModels.map(String).filter(Boolean)
    }
  }

  return null
}

/**
 * Checks if a model matches a pattern (glob, exact, or partial match).
 * Strips optional trailing thinking level suffix (e.g. ":high").
 */
export function matchesModelPattern(
  model: { provider: string; id: string; name?: string },
  pattern: string
): boolean {
  const trimmed = pattern.trim()
  if (!trimmed) return false

  // Strip optional thinking level suffix (:off, :low, etc.)
  const colonIdx = trimmed.lastIndexOf(':')
  let cleanPattern = trimmed
  if (colonIdx !== -1) {
    const suffix = trimmed.substring(colonIdx + 1).toLowerCase()
    const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    if (thinkingLevels.includes(suffix)) {
      cleanPattern = trimmed.substring(0, colonIdx).trim()
    }
  }

  const pLower = cleanPattern.toLowerCase()
  const providerLower = model.provider.toLowerCase()
  const idLower = model.id.toLowerCase()
  const fullIdLower = `${providerLower}/${idLower}`
  const nameLower = (model.name ?? '').toLowerCase()

  // Wildcard matching with * or ?
  if (pLower.includes('*') || pLower.includes('?')) {
    const regex = new RegExp(
      '^' + pLower.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      'i'
    )
    return regex.test(fullIdLower) || regex.test(idLower) || (Boolean(nameLower) && regex.test(nameLower))
  }

  // Exact ID match or full provider/id match
  if (fullIdLower === pLower || idLower === pLower) {
    return true
  }

  // Exact Provider match
  if (providerLower === pLower) {
    return true
  }

  // Substring matching on id or name
  if (idLower.includes(pLower) || (Boolean(nameLower) && nameLower.includes(pLower))) {
    return true
  }

  return false
}

