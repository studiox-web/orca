// XOS fork: Stage B pre-run queue gate (`skipped_precheck`, RT16) and prompt queue snapshot (RT17, §3g.2–3g.3).
import { statSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  resolveGoalDeclaredQueues,
  type XosDeclaredQueueIn,
  type XosDeclaredQueueOut,
  type XosDeclaredQueues
} from './xos-declared-queues'
import { parseFrontmatter, readHead, safeReaddir } from './xos-goal-files'
import { DEFAULT_CLAIM_TIMEOUT_MS, isItemClaimActive } from './xos-item-claims'

export {
  resolveGoalDeclaredQueues,
  type XosDeclaredQueueIn,
  type XosDeclaredQueueOut,
  type XosDeclaredQueues
}

const ITEM_HEAD_BYTES = 8 * 1024

export type XosQueueGateResult = {
  allowed: boolean
  skippedPrecheck: string | null
  hasInputWork: boolean
  totalEligibleIn: number
  queueContext: string
  candidateItemPaths: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function matchesExpr(fm: Record<string, unknown>, key?: string, expected?: string): boolean {
  if (!key) {
    return true
  }
  let current: unknown = fm
  for (const part of key.split('.')) {
    current = isPlainObject(current) ? current[part] : undefined
  }
  return expected === undefined || expected.toLowerCase() === 'true'
    ? current === true || current === 'true' || current === 'yes'
    : String(current ?? '').toLowerCase() === expected.toLowerCase()
}

export function isMarkdownItem(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.endsWith('.md') &&
    !lower.startsWith('.') &&
    lower !== 'readme.md' &&
    lower !== 'template.md'
  )
}

export function countDownstreamFloorItems(
  dirs: string[],
  readyKey: string | undefined,
  nowMs: number = Date.now(),
  claimTimeoutMs: number = DEFAULT_CLAIM_TIMEOUT_MS
): number {
  let count = 0
  for (const dir of dirs) {
    for (const name of safeReaddir(dir).filter(isMarkdownItem)) {
      const fm = parseFrontmatter(readHead(join(dir, name), ITEM_HEAD_BYTES))
      if (!isItemClaimActive(fm, nowMs, claimTimeoutMs) && matchesExpr(fm, readyKey)) {
        count += 1
      }
    }
  }
  return count
}

function countMatchingItems(dirs: string[], key?: string, value?: string): number {
  let count = 0
  for (const dir of dirs) {
    for (const name of safeReaddir(dir).filter(isMarkdownItem)) {
      if (
        !key ||
        matchesExpr(parseFrontmatter(readHead(join(dir, name), ITEM_HEAD_BYTES)), key, value)
      ) {
        count += 1
      }
    }
  }
  return count
}

export function countOpenReplyMessages(
  goalDir: string,
  goal: string,
  inboxIsWorkQueue: boolean
): number {
  const inboxDir = join(goalDir, 'inbox')
  let count = 0
  for (const name of safeReaddir(inboxDir).filter(isMarkdownItem)) {
    const fm = parseFrontmatter(readHead(join(inboxDir, name), 4096))
    if (inboxIsWorkQueue && !fm.from && !fm.to) {
      continue
    }
    const status = String(fm.status ?? 'open').toLowerCase()
    // read_at: a reply run already took this one; a failed run must not re-trigger forever.
    if (status === 'open' && !fm.responded_at && !fm.read_at && String(fm.from ?? '') !== goal) {
      count += 1
    }
  }
  return count
}

function formatAge(oldestMs: number | null, nowMs: number): string {
  if (oldestMs === null || oldestMs > nowMs) {
    return ''
  }
  const hours = Math.floor((nowMs - oldestMs) / 3_600_000)
  return hours >= 48
    ? `, oldest ${Math.floor(hours / 24)}d`
    : hours >= 1
      ? `, oldest ${hours}h`
      : ''
}

export function evaluateGoalQueueGate(args: {
  repoRoot: string
  goal: string
  fm: Record<string, unknown>
  runsToday?: number
  nowMs?: number
  claimTimeoutMs?: number
}): XosQueueGateResult {
  const nowMs = args.nowMs ?? Date.now()
  const claimTimeoutMs = args.claimTimeoutMs ?? DEFAULT_CLAIM_TIMEOUT_MS
  const declared = resolveGoalDeclaredQueues(args.repoRoot, args.goal, args.fm)

  if (declared.maxRunsPerDay !== null && (args.runsToday ?? 0) >= declared.maxRunsPerDay) {
    return {
      allowed: false,
      skippedPrecheck: `skipped_precheck: daily run cap reached (${args.runsToday}/${declared.maxRunsPerDay} today)`,
      hasInputWork: false,
      totalEligibleIn: 0,
      queueContext: '',
      candidateItemPaths: []
    }
  }

  let totalEligibleIn = 0
  const candidateItemPaths: string[] = []
  const inSummaries: string[] = []

  for (const queue of declared.in) {
    let total = 0
    let eligible = 0
    let claimed = 0
    let oldestMs: number | null = null
    const queueCandidates: { path: string; mtimeMs: number }[] = []

    for (const dir of queue.paths) {
      for (const name of safeReaddir(dir).filter(isMarkdownItem)) {
        const full = join(dir, name)
        try {
          const stat = statSync(full)
          if (!stat.isFile()) {
            continue
          }
          total += 1
          const itemFm = parseFrontmatter(readHead(full, ITEM_HEAD_BYTES))
          if (isItemClaimActive(itemFm, nowMs, claimTimeoutMs)) {
            claimed += 1
            continue
          }
          if (
            matchesExpr(itemFm, queue.readyKey, queue.readyValue) &&
            matchesExpr(itemFm, queue.matchKey, queue.matchValue)
          ) {
            eligible += 1
            queueCandidates.push({ path: full, mtimeMs: stat.mtimeMs })
            if (oldestMs === null || stat.mtimeMs < oldestMs) {
              oldestMs = stat.mtimeMs
            }
          }
        } catch {
          // Concurrent move.
        }
      }
    }
    queueCandidates.sort((a, b) => a.mtimeMs - b.mtimeMs)
    if (eligible >= (queue.minCount ?? 1)) {
      candidateItemPaths.push(...queueCandidates.map((c) => c.path))
      totalEligibleIn += eligible
    }
    const readyPart = queue.readyKey ? `${eligible} ready / ${total} total` : `${eligible} ready`
    const claimPart = claimed > 0 ? `, ${claimed} claimed` : ''
    inSummaries.push(`${queue.label}: ${readyPart}${claimPart}${formatAge(oldestMs, nowMs)}`)
  }

  const outSummaries: string[] = []
  for (const queue of declared.out) {
    const count = countMatchingItems(queue.paths, queue.matchKey, queue.matchValue)
    const cap = queue.hardCap ?? queue.ceiling
    outSummaries.push(
      `${queue.label}: ${count}${cap ? `/${cap}` : ''}${queue.floor ? ` (floor ${queue.floor})` : ''}`
    )
    if (queue.hardCap !== undefined && count >= queue.hardCap) {
      return {
        allowed: false,
        skippedPrecheck: `skipped_precheck: downstream queue "${queue.label}" at hard cap (${count}/${queue.hardCap})`,
        hasInputWork: totalEligibleIn > 0,
        totalEligibleIn,
        queueContext: '',
        candidateItemPaths
      }
    }
    if (queue.ceiling !== undefined && count >= queue.ceiling) {
      return {
        allowed: false,
        skippedPrecheck: `skipped_precheck: downstream queue "${queue.label}" at ceiling (${count}/${queue.ceiling})`,
        hasInputWork: totalEligibleIn > 0,
        totalEligibleIn,
        queueContext: '',
        candidateItemPaths
      }
    }
  }

  if (declared.in.length > 0 && totalEligibleIn === 0) {
    return {
      allowed: false,
      skippedPrecheck: `skipped_precheck: input queue empty (${inSummaries.join('; ')})`,
      hasInputWork: false,
      totalEligibleIn: 0,
      queueContext: '',
      candidateItemPaths: []
    }
  }

  const contextLines = [
    ...(inSummaries.length > 0 ? [`- Input queues: ${inSummaries.join(' | ')}`] : []),
    ...(outSummaries.length > 0 ? [`- Output queues: ${outSummaries.join(' | ')}`] : []),
    ...(candidateItemPaths.length > 0
      ? [
          `- Next eligible items: ${candidateItemPaths
            .slice(0, 5)
            .map((p) => basename(p))
            .join(', ')}`
        ]
      : [])
  ]
  return {
    allowed: true,
    skippedPrecheck: null,
    hasInputWork: totalEligibleIn > 0,
    totalEligibleIn,
    queueContext: contextLines.join('\n'),
    candidateItemPaths
  }
}
