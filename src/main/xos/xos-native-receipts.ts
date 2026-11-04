// XOS fork: Stage D native run receipts (~/.orca-xos/runs/<slug>.jsonl) and the one-shot agent
// command builder. The receipt rows are legacy-shaped (status/model/failure_reason/log_path) plus
// run_id/trigger/item/worktree/branch, so the §3c board adapter merges them with the legacy
// automation-runs.jsonl rows without a second code path.
import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { XosGoalRun } from '../../shared/xos-goals-types'
import { xosHome } from './xos-crontab'
import { parseFrontmatter, frontmatterString, readHead } from './xos-goal-files'
import { projectSlug } from './xos-goal-org'

const RECEIPT_TAIL_BYTES = 1024 * 1024

export type XosNativeReceipt = XosGoalRun & {
  run_id: string
  trigger: string | null
  mode: string
  item_path?: string | null
  item_title?: string | null
  worktree_path?: string | null
  branch?: string | null
  parent_run_id?: string | null
}

const runsDir = (): string => join(xosHome(), 'runs')

export function receiptsPath(repoRoot: string): string {
  return join(runsDir(), `${projectSlug(basename(repoRoot))}.jsonl`)
}

export function nativeRunLogsDir(repoRoot: string): string {
  return join(runsDir(), 'logs', projectSlug(basename(repoRoot)))
}

export function appendReceipt(repoRoot: string, receipt: XosNativeReceipt): void {
  try {
    mkdirSync(runsDir(), { recursive: true })
    appendFileSync(receiptsPath(repoRoot), `${JSON.stringify(receipt)}\n`, 'utf8')
  } catch (error) {
    console.warn('[xos] could not write a native run receipt', error)
  }
}

/** Newest first. Reads only the tail so the file can grow without bound. */
export function readReceiptLines(repoRoot: string): XosNativeReceipt[] {
  let fd: number | null = null
  try {
    const path = receiptsPath(repoRoot)
    const size = statSync(path).size
    const start = Math.max(0, size - RECEIPT_TAIL_BYTES)
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf8').split('\n')
    const rows = start > 0 ? lines.slice(1) : lines
    const receipts: XosNativeReceipt[] = []
    for (const line of rows) {
      try {
        const receipt: XosNativeReceipt = JSON.parse(line)
        receipts.push(receipt)
      } catch {
        // Skip a torn line.
      }
    }
    return receipts
  } catch {
    return []
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

/** Native receipts of this repo, grouped by goal and newest first (board adapter input). */
export function readNativeReceipts(repoRoot: string): Map<string, XosGoalRun[]> {
  const byGoal = new Map<string, XosGoalRun[]>()
  for (const receipt of readReceiptLines(repoRoot).toReversed()) {
    const list = byGoal.get(receipt.goal) ?? []
    list.push(receipt)
    byGoal.set(receipt.goal, list)
  }
  return byGoal
}

export function runsTodayCount(repoRoot: string, goal: string, nowMs: number): number {
  const day = new Date(nowMs).toISOString().slice(0, 10)
  return readReceiptLines(repoRoot).filter(
    (receipt) => receipt.goal === goal && (receipt.started_at ?? '').startsWith(day)
  ).length
}

/** The one-shot agent command for a native run (claude -p / codex exec over a prompt file). */
export function buildAgentRunCommand(args: {
  root: string
  promptPath: string
  agent: string
  model: string | null
  effort: string | null
  lockLane: string
  inboxOnly: boolean
}): string {
  const envPrefix = [
    `CASCADE_ACTIVE_LOCK_LANE=${JSON.stringify(args.lockLane)}`,
    ...(args.inboxOnly ? ['CASCADE_GOAL_INBOX_ONLY=1'] : [])
  ].join(' ')
  if (args.agent === 'claude') {
    const modelArg = args.model ? ` --model ${JSON.stringify(args.model)}` : ''
    const effortArg = args.effort ? ` --effort ${JSON.stringify(args.effort)}` : ''
    return `cd ${JSON.stringify(args.root)} && ${envPrefix} claude -p "$(cat ${JSON.stringify(args.promptPath)})"${modelArg}${effortArg} --dangerously-skip-permissions`
  }
  const modelArg = args.model ? ` -m ${JSON.stringify(args.model)}` : ''
  const effortArg = args.effort
    ? ` -c ${JSON.stringify(`model_reasoning_effort="${args.effort}"`)}`
    : ''
  return `cd ${JSON.stringify(args.root)} && ${envPrefix} codex exec --dangerously-bypass-approvals-and-sandbox -C ${JSON.stringify(args.root)}${modelArg}${effortArg} - < ${JSON.stringify(args.promptPath)}`
}

export function itemTitleFrom(path: string): string {
  const fm = parseFrontmatter(readHead(path, 8192))
  return (
    frontmatterString(fm, 'title') ??
    basename(path, '.md')
      .replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '')
      .replace(/[-_]+/g, ' ')
  )
}
