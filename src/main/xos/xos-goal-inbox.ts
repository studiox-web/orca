// XOS fork: Stage B/C goal inbox & @shared/... contract include helpers (RT3, RT9, RT12, MS1, MS3).
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, normalize, relative, resolve } from 'node:path'
import { audit } from './xos-crontab'
import { parseFrontmatter, readHead, safeReaddir } from './xos-goal-files'
import { patchMarkdownFrontmatter } from './xos-item-claims'
import { commitProjectHome, resolveSharedDirs } from './xos-project-home'

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

export function listGoalInboxMessages(goalDir: string): Record<string, unknown>[] {
  const inboxDir = join(goalDir, 'inbox')
  return safeReaddir(inboxDir)
    .filter((n) => n.endsWith('.md') && !n.startsWith('.') && n.toLowerCase() !== 'readme.md')
    .sort()
    .toReversed()
    .map((filename) => {
      const path = join(inboxDir, filename)
      const text = readHead(path, 16 * 1024) ?? ''
      const fm = parseFrontmatter(text)
      const end = text.startsWith('---') ? text.indexOf('\n---', 3) : -1
      const body = (end === -1 ? text : text.slice(text.indexOf('\n', end + 4) + 1)).trim()
      return {
        filename,
        path,
        id: fm.id ?? filename.replace(/\.md$/, ''),
        from: fm.from ?? 'unknown',
        to: fm.to ?? null,
        status: fm.status ?? 'open',
        priority: fm.priority ?? 'normal',
        subject: fm.subject ?? null,
        createdAt: fm.created_at ?? null,
        readAt: fm.read_at ?? null,
        body
      }
    })
}

export function sendGoalInboxMessage(args: {
  projectRoot: string
  projectName: string
  goalsDir: string
  goal: string
  body: string
  from?: string
  subject?: string
  priority?: string
  attachments?: string[]
  cwd: string
  nowMs?: number
}): { path: string; id: string; attachments: string[] } {
  const nowIso = new Date(args.nowMs ?? Date.now()).toISOString()
  const stamp = nowIso.replace(/[:.]/g, '-')
  const sender = (args.from?.trim() || 'operator').replace(/[^A-Za-z0-9_-]/g, '-')
  const id = `${stamp}__from-${sender}__to-${args.goal}`
  const inboxDir = join(args.goalsDir, args.goal, 'inbox')
  mkdirSync(inboxDir, { recursive: true })
  const copiedAttachments: string[] = []
  for (const rawAttach of args.attachments ?? []) {
    const src = resolve(args.cwd, rawAttach)
    if (existsSync(src) && statSync(src).isFile()) {
      const attachDir = join(inboxDir, 'attachments')
      mkdirSync(attachDir, { recursive: true })
      const destName = `${stamp}-${basename(src)}`
      cpSync(src, join(attachDir, destName), { force: true })
      copiedAttachments.push(`inbox/attachments/${destName}`)
    }
  }
  const fullPath = join(inboxDir, `${id}__message.md`)
  const lines = [
    '---',
    `id: ${id}`,
    `from: ${sender}`,
    `to: ${args.goal}`,
    `created_at: ${nowIso}`,
    `priority: ${args.priority?.trim() || 'high'}`,
    'status: open',
    `subject: ${args.subject?.trim() || 'Operator instruction'}`,
    ...(copiedAttachments.length > 0 ? [`attachments: [${copiedAttachments.join(', ')}]`] : []),
    '---',
    '',
    args.body.trim(),
    ''
  ]
  writeFileSync(fullPath, lines.join('\n'), 'utf8')
  void commitProjectHome(args.projectRoot, `xos: message ${args.goal} from ${sender}`)
  audit({
    action: 'goal.message',
    project: args.projectName,
    goal: args.goal,
    from: sender,
    path: fullPath
  })
  return { path: fullPath, id, attachments: copiedAttachments }
}
