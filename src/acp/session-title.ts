const TITLE_MAX_LEN = 80

/** Derive a sidebar title from the first user message. */
export function titleFromUserText(text: string | null | undefined): string | null {
  if (!text) return null

  let cleaned = text.replace(/\r\n/g, '\n')

  // Strip ACP/Zed injected context markers like [Context] file://... or [Embedded Context] ...
  cleaned = cleaned.replace(/\[(?:Context|Embedded Context|Audio)\][^\n]*/g, '')
  cleaned = cleaned.replace(/file:\/\/\S+/g, '')

  const lines = cleaned
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const candidate = lines.find(line => !line.startsWith('/'))
  if (candidate) {
    const collapsed = candidate.replace(/\s+/g, ' ').trim()
    if (collapsed) {
      return collapsed.length > TITLE_MAX_LEN ? collapsed.slice(0, TITLE_MAX_LEN).trimEnd() : collapsed
    }
  }

  // Fallback: if message only had file links or file names, use the referenced filename
  const fileMatch = text.match(/(?:file:\/\/|\/)([^\/\s\?#]+\.[a-zA-Z0-9_-]+)/)
  if (fileMatch && fileMatch[1]) {
    try {
      const decoded = decodeURIComponent(fileMatch[1]).trim()
      if (decoded) {
        return decoded.length > TITLE_MAX_LEN ? decoded.slice(0, TITLE_MAX_LEN).trimEnd() : decoded
      }
    } catch {
      return fileMatch[1].slice(0, TITLE_MAX_LEN).trimEnd()
    }
  }

  return null
}
