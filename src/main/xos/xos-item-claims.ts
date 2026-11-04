// XOS fork: Stage B work-item claiming (`claimed_by`, `claimed_at` in item frontmatter) and
// stage-transition index (`~/.orca-xos/projects/<slug>/transitions.jsonl`, §3g.4 & §3g.6).
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseFrontmatter, readHead } from './xos-goal-files'
import { commitProjectHome, projectHomeDir } from './xos-project-home'

export const DEFAULT_CLAIM_TIMEOUT_MS = 45 * 60 * 1000
const ITEM_PROMPT_BYTES = 32 * 1024

export type XosItemTransitionEvent = {
  at: string
  item: string
  fromPath: string
  toPath: string
  fromStage: string
  toStage: string
  goal: string
  runId?: string
  branch?: string
  commit?: string
  outcome?: string
}

/** The prompt section for a claimed item: the agent enriches it, Orca moves it (§3g.4). */
export function claimedItemPromptSection(itemPath: string, runId: string): string {
  return `\n\n## Claimed Work Item (§3g)\n\n- File: ${itemPath}\n- Stage: ${basename(dirname(itemPath))}\n- This run claimed it (\`claimed_by: ${runId}\`). Enrich the file, but do not move it: Orca moves it to the next stage when the run succeeds. Reference "${basename(itemPath, '.md')}" in any commit message.\n\n### Item contents\n\n${readHead(itemPath, ITEM_PROMPT_BYTES) ?? '_Unreadable item file._'}`
}

export function isItemClaimActive(
  fm: Record<string, unknown>,
  nowMs: number = Date.now(),
  staleAfterMs: number = DEFAULT_CLAIM_TIMEOUT_MS
): boolean {
  const claimedBy = typeof fm.claimed_by === 'string' ? fm.claimed_by.trim() : ''
  if (!claimedBy) {
    return false
  }
  // A held session (takeover) states its own end instead of the run-length default.
  const until =
    fm.claim_until instanceof Date ? fm.claim_until.getTime() : Date.parse(String(fm.claim_until))
  if (Number.isFinite(until)) {
    return nowMs < until
  }
  const rawAt = fm.claimed_at
  const claimedAtMs =
    rawAt instanceof Date
      ? rawAt.getTime()
      : typeof rawAt === 'string'
        ? Date.parse(rawAt)
        : Number.NaN
  if (!Number.isFinite(claimedAtMs)) {
    return true
  }
  return nowMs - claimedAtMs < staleAfterMs
}

/** Update or remove top-level scalar keys in a markdown file's YAML frontmatter block. */
export function patchMarkdownFrontmatter(
  text: string,
  updates: Record<string, string | null>
): string {
  const keys = Object.keys(updates)
  if (keys.length === 0) {
    return text
  }
  if (!text.startsWith('---\n')) {
    const added = keys.filter((k) => updates[k] !== null).map((k) => `${k}: ${updates[k]}`)
    return added.length > 0 ? `---\n${added.join('\n')}\n---\n${text}` : text
  }
  const closeIdx = text.indexOf('\n---', 3)
  if (closeIdx === -1) {
    return text
  }
  const fmLines = text.slice(4, closeIdx).split('\n')
  const rest = text.slice(closeIdx + 4)
  const seen = new Set<string>()
  const nextLines: string[] = []
  for (const line of fmLines) {
    const match = /^([A-Za-z0-9_-]+):/.exec(line)
    const key = match?.[1]
    if (key && key in updates) {
      seen.add(key)
      if (updates[key] !== null) {
        nextLines.push(`${key}: ${updates[key]}`)
      }
      continue
    }
    nextLines.push(line)
  }
  for (const key of keys) {
    if (!seen.has(key) && updates[key] !== null) {
      nextLines.push(`${key}: ${updates[key]}`)
    }
  }
  return `---\n${nextLines.join('\n')}\n---${rest}`
}

export function claimWorkItem(
  filePath: string,
  options: {
    runId: string
    nowMs?: number
    staleAfterMs?: number
    /** Holds the claim until this time, past the default expiry. */
    untilMs?: number
  }
): { claimed: boolean; reason?: string } {
  if (!existsSync(filePath)) {
    return { claimed: false, reason: 'Item file does not exist.' }
  }
  const nowMs = options.nowMs ?? Date.now()
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_CLAIM_TIMEOUT_MS
  const text = readFileSync(filePath, 'utf8')
  const fm = parseFrontmatter(text)
  if (isItemClaimActive(fm, nowMs, staleAfterMs) && fm.claimed_by !== options.runId) {
    return {
      claimed: false,
      reason: `Already claimed by ${String(fm.claimed_by)}.`
    }
  }
  const nextText = patchMarkdownFrontmatter(text, {
    claimed_by: options.runId,
    claimed_at: new Date(nowMs).toISOString(),
    claim_until: options.untilMs ? new Date(options.untilMs).toISOString() : null
  })
  writeFileSync(filePath, nextText, 'utf8')
  return { claimed: true }
}

export function releaseWorkItemClaim(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false
  }
  const text = readFileSync(filePath, 'utf8')
  const nextText = patchMarkdownFrontmatter(text, {
    claimed_by: null,
    claimed_at: null,
    claim_until: null
  })
  if (nextText !== text) {
    writeFileSync(filePath, nextText, 'utf8')
  }
  return true
}

export function transitionsFilePath(nameOrRoot: string): string {
  return join(projectHomeDir(nameOrRoot), 'transitions.jsonl')
}

export function recordTransitionEvent(nameOrRoot: string, event: XosItemTransitionEvent): void {
  const path = transitionsFilePath(nameOrRoot)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8')
}

export function readTransitionEvents(nameOrRoot: string, limit = 100): XosItemTransitionEvent[] {
  const path = transitionsFilePath(nameOrRoot)
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    const events: XosItemTransitionEvent[] = []
    for (const line of lines.toReversed()) {
      try {
        const parsed: XosItemTransitionEvent = JSON.parse(line)
        events.push(parsed)
      } catch {
        // Ignore malformed lines.
      }
      if (events.length >= limit) {
        break
      }
    }
    return events
  } catch {
    return []
  }
}

export function transitionWorkItem(args: {
  repoRoot: string
  filePath: string
  toDir: string
  goal: string
  runId?: string
  branch?: string
  commit?: string
  outcome?: string
  nowMs?: number
}): string {
  const nowIso = new Date(args.nowMs ?? Date.now()).toISOString()
  const text = readFileSync(args.filePath, 'utf8')
  const nextText = patchMarkdownFrontmatter(text, {
    claimed_by: null,
    claimed_at: null,
    claim_until: null,
    ...(args.runId ? { last_run_id: args.runId } : {}),
    ...(args.branch ? { branch: args.branch } : {}),
    ...(args.commit ? { commit: args.commit } : {}),
    updated_at: nowIso
  })
  mkdirSync(args.toDir, { recursive: true })
  const destPath = join(args.toDir, basename(args.filePath))
  writeFileSync(args.filePath, nextText, 'utf8')
  if (destPath !== args.filePath) {
    renameSync(args.filePath, destPath)
  }
  recordTransitionEvent(args.repoRoot, {
    at: nowIso,
    item: basename(args.filePath, '.md'),
    fromPath: args.filePath,
    toPath: destPath,
    fromStage: basename(dirname(args.filePath)),
    toStage: basename(args.toDir),
    goal: args.goal,
    ...(args.runId ? { runId: args.runId } : {}),
    ...(args.branch ? { branch: args.branch } : {}),
    ...(args.commit ? { commit: args.commit } : {}),
    ...(args.outcome ? { outcome: args.outcome } : {})
  })
  void commitProjectHome(
    args.repoRoot,
    `xos: move ${basename(args.filePath)} to ${basename(args.toDir)} (${args.goal})`
  )
  return destPath
}
