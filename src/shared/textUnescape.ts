/**
 * Normalizes LLM-generated Markdown/note text where JSON tool calls or responses
 * double-escaped newlines (`\\n`) or tabs (`\\t`) into literal two-character sequences.
 */
export function unescapeLlmText(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return ''
  let out = raw.replace(/\r\n/g, '\n')
  if (out.includes('\\n') || out.includes('\\t')) {
    out = out
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '  ')
  }
  return out.trim()
}

/**
 * Normalizes LLM-generated source code where JSON tool calls double-escaped
 * line breaks (`\\n`) or indentation tabs (`\\t`) onto a single line, while
 * preserving escape sequences inside quoted string literals (`"\\n"` / `'\\n'`).
 */
export function unescapeLlmCode(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return ''
  let cleaned = raw.trim().replace(/\r\n/g, '\n')

  // Strip outer markdown code fences if the LLM wrapped the snippet
  const fenced = cleaned.match(/^```(?:[a-zA-Z0-9_+-]+)?\s*\n([\s\S]*?)\n```$/)
  if (fenced && fenced[1]) {
    cleaned = fenced[1]
  }

  if (!cleaned.includes('\\n') && !cleaned.includes('\\t')) {
    return cleaned
  }

  // Walk character-by-character and unescape `\n`, `\r\n`, and `\t` that appear outside quotes
  let result = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]
    const next = cleaned[i + 1]

    if (quote) {
      if (ch === '\\' && next !== undefined) {
        result += ch + next
        i += 1
        continue
      }
      if (ch === quote) {
        quote = null
      }
      result += ch
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      result += ch
      continue
    }

    if (ch === '\\') {
      if (next === 'r' && cleaned[i + 2] === '\\' && cleaned[i + 3] === 'n') {
        result += '\n'
        i += 3
        continue
      }
      if (next === 'n') {
        result += '\n'
        i += 1
        continue
      }
      if (next === 't') {
        result += '    '
        i += 1
        continue
      }
    }

    result += ch
  }

  return result
}
