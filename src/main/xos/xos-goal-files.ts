// XOS fork: read one goal folder (GOAL.md, STATUS.md, log/, inbox/) the way the Command Centre did,
// but bounded: only the newest logs are opened and only their first few KB are read.
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

const LOG_LIST_LIMIT = 10
const HEAD_BYTES = 16 * 1024

export function readHead(path: string, bytes = HEAD_BYTES): string | null {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(bytes)
    const read = readSync(fd, buffer, 0, bytes, 0)
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return null
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

/** The last `bytes` of a file, starting on a line boundary when the file is longer. */
export function readTail(path: string, bytes = HEAD_BYTES): string | null {
  let fd: number | null = null
  try {
    const size = statSync(path).size
    const start = Math.max(0, size - bytes)
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8')
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
  } catch {
    return null
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

export function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

export function mtimeIso(path: string): string | null {
  try {
    return statSync(path).mtime.toISOString()
  } catch {
    return null
  }
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Leading `---` YAML block; malformed YAML yields an empty object rather than failing the board. */
export function parseFrontmatter(text: string | null): Record<string, unknown> {
  if (!text?.startsWith('---')) {
    return {}
  }
  const end = text.indexOf('\n---', 3)
  if (end === -1) {
    return {}
  }
  try {
    const parsed = parseYaml(text.slice(3, end))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function frontmatterString(fm: Record<string, unknown>, key: string): string | null {
  const value = fm[key]
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return null
}

export function frontmatterList(fm: Record<string, unknown>, key: string): string[] {
  const value = fm[key]
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }
  return []
}

/** Same `key: value` scrape as CommandCentreController::parseStatusFile. */
export function parseStatusFields(text: string | null): Record<string, string> {
  const pairs: Record<string, string> = {}
  if (!text) {
    return pairs
  }
  for (const line of text.split('\n')) {
    const match = /^\s*(?:[-*]\s+)?(\w[\w -]*):\s*(.+?)\s*$/.exec(line)
    if (!match) {
      continue
    }
    const key = match[1].trim().toLowerCase().replace(/[ -]/g, '_')
    pairs[key] = match[2].trim()
  }
  return pairs
}

export function markdownTitle(text: string | null): string | null {
  const match = text ? /^#\s+(.+)$/m.exec(text) : null
  return match ? match[1].replace(/^Goal:\s*/i, '').trim() : null
}

function markdownSectionExcerpt(text: string, heading: string): string | null {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, 'm')
  const match = pattern.exec(text)
  if (!match) {
    return null
  }
  const body = match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
    .join(' ')
  return body ? squish(body, 220) : null
}

export function squish(value: string, limit: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat
}

/** Newest-first goal logs (`log/<timestamp>.md`); filenames sort chronologically. */
export function listGoalLogs(
  goal: string,
  logDir: string
): {
  logs: { goal: string; filename: string; path: string; first_line: string }[]
  latestText: string | null
} {
  const files = safeReaddir(logDir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .toReversed()
    .slice(0, LOG_LIST_LIMIT)
  let latestText: string | null = null
  const logs = files.map((filename, index) => {
    const path = join(logDir, filename)
    const head = readHead(path, index === 0 ? HEAD_BYTES : 4096)
    if (index === 0) {
      latestText = head
    }
    const body = head?.startsWith('---') ? head.slice(head.indexOf('\n---', 3) + 4) : (head ?? '')
    const firstLine =
      body
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? ''
    return {
      goal,
      filename,
      path,
      first_line: firstLine.replace(/^#+\s*/, '')
    }
  })
  return { logs, latestText }
}

export function adminSummaryFromLog(text: string | null): string | null {
  if (!text) {
    return null
  }
  const summary = frontmatterString(parseFrontmatter(text), 'admin_summary')
  if (summary) {
    return squish(summary, 220)
  }
  for (const heading of ['Admin Summary', 'Run Summary', 'Summary', 'Outcome']) {
    const excerpt = markdownSectionExcerpt(text, heading)
    if (excerpt) {
      return excerpt
    }
  }
  return null
}

/** Open messages addressed to this goal (`inbox/*.md` with `status: open`, or no status yet). */
export function countOpenInbox(inboxDir: string): number {
  let open = 0
  for (const name of safeReaddir(inboxDir)) {
    if (!name.endsWith('.md')) {
      continue
    }
    const status = frontmatterString(
      parseFrontmatter(readHead(join(inboxDir, name), 2048)),
      'status'
    )
    if (!status || status.toLowerCase() === 'open') {
      open += 1
    }
  }
  return open
}
