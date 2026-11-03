// XOS fork: Stage B goal inbox & @shared/... contract include helpers (RT3, RT9, RT12).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, normalize, relative, resolve } from 'node:path'
import { parseFrontmatter, readHead, safeReaddir } from './xos-goal-files'
import { patchMarkdownFrontmatter } from './xos-item-claims'
import { resolveSharedDirs } from './xos-project-home'

const MAX_INBOX_BYTES = 32 * 1024
const INCLUDE_LINE_RE = /^[ \t]*@shared\/([A-Za-z0-9._/-]+)[ \t]*$/

function findSharedFile(repoRoot: string, relPath: string): string | null {
  const clean = normalize(relPath).replace(/^\/+/, '')
  if (!clean || clean.startsWith('..') || clean.includes('/../')) {
    throw new Error(`Invalid @shared include path: @shared/${relPath}`)
  }
  for (const sharedDir of resolveSharedDirs(repoRoot)) {
    const candidate = resolve(sharedDir, clean)
    if (relative(sharedDir, candidate).startsWith('..')) {
      throw new Error(`Include escapes shared directory: @shared/${relPath}`)
    }
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/** Expand standalone `@shared/<path>` lines recursively with cycle and path-traversal guards. */
export function expandSharedIncludes(text: string, repoRoot: string, stack: string[] = []): string {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const match = INCLUDE_LINE_RE.exec(line)
    if (!match) {
      out.push(line)
      continue
    }
    const rel = match[1]
    const filePath = findSharedFile(repoRoot, rel)
    if (!filePath) {
      throw new Error(`Missing shared contract include: @shared/${rel}`)
    }
    if (stack.includes(filePath)) {
      throw new Error(`Include cycle detected for @shared/${rel}`)
    }
    const includedRaw = readFileSync(filePath, 'utf8').replace(/\n$/, '')
    const expanded = expandSharedIncludes(includedRaw, repoRoot, [...stack, filePath])
    out.push(
      `<!-- begin include: @shared/${rel} -->`,
      expanded,
      `<!-- end include: @shared/${rel} -->`
    )
  }
  return out.join('\n')
}

export function markGoalInboxReadAndCollect(
  goalDir: string,
  goal: string,
  nowIso: string = new Date().toISOString()
): { openCount: number; formattedMessages: string } {
  const inboxDir = join(goalDir, 'inbox')
  const files = safeReaddir(inboxDir)
    .filter(
      (name) => name.endsWith('.md') && !name.startsWith('.') && name.toLowerCase() !== 'readme.md'
    )
    .sort()
  let openCount = 0
  const blocks: string[] = []

  for (const name of files) {
    const full = join(inboxDir, name)
    let text = readHead(full, MAX_INBOX_BYTES) ?? ''
    const fm = parseFrontmatter(text)
    const status = String(fm.status ?? '').toLowerCase()
    const sender = String(fm.from ?? '')
    if (status === 'open') {
      openCount += 1
      if (sender !== goal && (!fm.read_at || !fm.read_by)) {
        text = patchMarkdownFrontmatter(text, {
          ...(fm.read_at ? {} : { read_at: nowIso }),
          ...(fm.read_by ? {} : { read_by: goal })
        })
        try {
          writeFileSync(full, text, 'utf8')
        } catch {
          // Best-effort mark read.
        }
      }
    }
    blocks.push(`#### File: inbox/${name}\n${text.trimEnd()}`)
  }
  return { openCount, formattedMessages: blocks.join('\n\n') }
}

export function writeGoalOperatorMessage(
  goalDir: string,
  goal: string,
  message: string,
  nowMs: number = Date.now()
): string {
  const inboxDir = join(goalDir, 'inbox')
  mkdirSync(inboxDir, { recursive: true })
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-')
  const filename = `${stamp}__from-operator__to-${goal}__operator-message.md`
  const fullPath = join(inboxDir, filename)
  const content = [
    '---',
    `id: ${stamp}__from-operator__to-${goal}`,
    'from: operator',
    `to: ${goal}`,
    `created_at: ${new Date(nowMs).toISOString()}`,
    'priority: high',
    'status: open',
    'subject: Operator instruction',
    '---',
    '',
    message.trim(),
    ''
  ].join('\n')
  writeFileSync(fullPath, content, 'utf8')
  return fullPath
}
