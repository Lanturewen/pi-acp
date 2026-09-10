import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function getZedSettingsPath(): string {
  const osPlatform = platform()
  if (osPlatform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    return join(appData, 'Zed', 'settings.json')
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  const primary = join(xdgConfig, 'zed', 'settings.json')
  if (existsSync(primary)) return primary

  if (osPlatform === 'darwin') {
    const macAlt = join(homedir(), 'Library', 'Application Support', 'Zed', 'settings.json')
    if (existsSync(macAlt)) return macAlt
  }

  return primary
}

export function stripJsonCommentsAndCommas(str: string): string {
  let inString = false
  let inSingleComment = false
  let inMultiComment = false
  let result = ''

  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    const next = str[i + 1]

    if (!inString && !inSingleComment && !inMultiComment) {
      if (char === '/' && next === '/') {
        inSingleComment = true
        i++
        continue
      }
      if (char === '/' && next === '*') {
        inMultiComment = true
        i++
        continue
      }
      if (char === '"') {
        inString = true
        result += char
        continue
      }
      result += char
    } else if (inString) {
      result += char
      if (char === '\\') {
        result += next ?? ''
        i++
      } else if (char === '"') {
        inString = false
      }
    } else if (inSingleComment) {
      if (char === '\n' || char === '\r') {
        inSingleComment = false
        result += char
      }
    } else if (inMultiComment) {
      if (char === '*' && next === '/') {
        inMultiComment = false
        i++
      }
    }
  }

  return result.replace(/,\s*([}\]])/g, '$1')
}

export interface SetupZedOptions {
  settingsPath?: string
  global?: boolean
  distPath?: string
}

export function setupZed(options: SetupZedOptions = {}): void {
  const zedPath = options.settingsPath || getZedSettingsPath()
  const useGlobal = options.global === true

  let resolvedDist = options.distPath
  if (!resolvedDist && !useGlobal) {
    try {
      const currentDir = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
      resolvedDist = resolve(currentDir, '..', '..', 'dist', 'index.js')
      if (!existsSync(resolvedDist)) {
        resolvedDist = resolve(currentDir, '..', 'index.js')
      }
    } catch {
      resolvedDist = 'pi-acp'
    }
  }

  const serverConfig: Record<string, any> = {
    type: 'custom',
    command: useGlobal ? 'pi-acp' : process.execPath,
    args: useGlobal ? [] : [resolvedDist]
  }

  console.log(`[pi-acp] Configuring Zed settings at: ${zedPath}`)

  const zedDir = dirname(zedPath)
  if (!existsSync(zedDir)) {
    mkdirSync(zedDir, { recursive: true })
  }

  if (!existsSync(zedPath)) {
    const initial = {
      agent_servers: {
        'pi-acp': serverConfig
      }
    }
    writeFileSync(zedPath, JSON.stringify(initial, null, 2) + '\n', 'utf-8')
    console.log('✓ Created Zed settings.json and registered pi-acp successfully!')
    return
  }

  // Backup original file
  const backupPath = `${zedPath}.bak`
  try {
    copyFileSync(zedPath, backupPath)
  } catch {
    // ignore
  }

  const raw = readFileSync(zedPath, 'utf-8')
  let parsed: any = null
  try {
    parsed = JSON.parse(stripJsonCommentsAndCommas(raw))
  } catch (err: any) {
    console.error(`[pi-acp] Warning: Could not parse ${zedPath} as JSON: ${err.message}`)
  }

  // Preserve existing default_config_options if user already customized it
  if (parsed?.agent_servers?.['pi-acp']?.default_config_options) {
    serverConfig.default_config_options = parsed.agent_servers['pi-acp'].default_config_options
  }

  const piAcpEntry = JSON.stringify(serverConfig, null, 4)
    .split('\n')
    .map((line, i) => (i === 0 ? line : '      ' + line))
    .join('\n')

  let updatedContent: string | null = null

  // 1. Check if "pi-acp" entry exists inside "agent_servers"
  const piAcpRegex = /("agent_servers"\s*:\s*\{[\s\S]*?)("pi-acp"\s*:\s*\{[\s\S]*?\n\s*\}[,\s]*)/
  if (piAcpRegex.test(raw)) {
    updatedContent = raw.replace(piAcpRegex, `$1"pi-acp": ${piAcpEntry},\n`)
  } else {
    // 2. Check if "agent_servers" exists
    const agentServersRegex = /("agent_servers"\s*:\s*\{)/
    if (agentServersRegex.test(raw)) {
      updatedContent = raw.replace(agentServersRegex, `$1\n    "pi-acp": ${piAcpEntry},`)
    } else {
      // 3. Insert "agent_servers" after opening brace {
      const openingBraceRegex = /(\{[\s\S]*?)(\{)/
      if (openingBraceRegex.test(raw)) {
        updatedContent = raw.replace(/\{/, `{\n  "agent_servers": {\n    "pi-acp": ${piAcpEntry}\n  },`)
      }
    }
  }

  // Validate the updated content
  let isValid = false
  if (updatedContent) {
    try {
      JSON.parse(stripJsonCommentsAndCommas(updatedContent))
      isValid = true
    } catch {
      isValid = false
    }
  }

  if (isValid && updatedContent) {
    writeFileSync(zedPath, updatedContent, 'utf-8')
  } else if (parsed && typeof parsed === 'object') {
    if (!parsed.agent_servers) parsed.agent_servers = {}
    parsed.agent_servers['pi-acp'] = serverConfig
    writeFileSync(zedPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
  } else {
    console.error(`[pi-acp] Failed to safely update ${zedPath}. Please configure manually.`)
    process.exit(1)
  }

  console.log('✓ Successfully configured pi-acp in Zed settings.json!')
  console.log(`  Backup saved to: ${backupPath}`)
}
