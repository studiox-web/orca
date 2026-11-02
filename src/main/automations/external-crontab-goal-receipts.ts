// XOS fork only: enriches crontab jobs that launch a Studio X goal runner
// (`automations/bin/run-goal-cron.sh <goal> <agent>`) with the runner's JSONL receipts.
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { ExternalAutomationRunStatus } from '../../shared/automations-types'
import type { CrontabEntry, CrontabRunEvidence } from './external-crontab-jobs'

const RECEIPTS_RELATIVE_PATH = join('automations', 'logs', 'automation-runs.jsonl')
const RECEIPT_TAIL_LINES = 2000
const RUNS_PER_GOAL = 10

type GoalReceipt = {
  goal: string
  runner?: string
  status?: string
  started_at?: string
  duration_seconds?: number
  exit_code?: number
  log_path?: string
  model?: string
}

const GOAL_RUNNER_PATTERN = /run-goal-cron\.sh\s+([A-Za-z0-9._-]+)/

export function goalNameForEntry(entry: CrontabEntry): string | null {
  return GOAL_RUNNER_PATTERN.exec(entry.command)?.[1] ?? null
}

function runStatus(status: string | undefined): ExternalAutomationRunStatus {
  if (status === 'success') {
    return 'completed'
  }
  return status === 'failed' ? 'failed' : 'unknown'
}

function parseReceipts(text: string): GoalReceipt[] {
  const receipts: GoalReceipt[] = []
  for (const line of text.split('\n').slice(-RECEIPT_TAIL_LINES)) {
    try {
      const parsed = JSON.parse(line) as GoalReceipt
      if (parsed && typeof parsed.goal === 'string') {
        receipts.push(parsed)
      }
    } catch {
      // Partial or foreign lines are skipped; receipts are append-only evidence.
    }
  }
  return receipts
}

function describeReceipt(receipt: GoalReceipt): string {
  const minutes = Math.round((receipt.duration_seconds ?? 0) / 6) / 10
  const parts = [
    receipt.status ?? 'unknown',
    receipt.model ?? receipt.runner,
    `${minutes}m`,
    receipt.exit_code !== undefined ? `exit ${receipt.exit_code}` : null
  ]
  return parts.filter(Boolean).join(' · ')
}

/** Returns goal-receipt evidence keyed by entry id; entries without a goal runner are absent. */
export async function readGoalReceiptEvidence(
  entries: CrontabEntry[]
): Promise<Map<string, CrontabRunEvidence>> {
  const evidence = new Map<string, CrontabRunEvidence>()
  const receiptsByWorkdir = new Map<string, GoalReceipt[]>()
  for (const entry of entries) {
    const goal = goalNameForEntry(entry)
    const workdir = entry.workdir
    if (!goal || !workdir || !isAbsolute(workdir)) {
      continue
    }
    let receipts = receiptsByWorkdir.get(workdir)
    if (!receipts) {
      try {
        receipts = parseReceipts(await readFile(join(workdir, RECEIPTS_RELATIVE_PATH), 'utf8'))
      } catch {
        receipts = []
      }
      receiptsByWorkdir.set(workdir, receipts)
    }
    const runs = receipts
      .filter((receipt) => receipt.goal === goal && receipt.started_at)
      .slice(-RUNS_PER_GOAL)
      .toReversed()
    const latest = runs[0]
    if (!latest) {
      continue
    }
    evidence.set(entry.id, {
      lastRunAt: latest.started_at ?? null,
      lastStatus: latest.status ?? null,
      lastError: latest.status === 'failed' ? describeReceipt(latest) : null,
      runs: runs.map((receipt) => ({
        id: `${entry.id}:${receipt.started_at}`,
        runAt: receipt.started_at ?? null,
        status: runStatus(receipt.status),
        outputPreview: describeReceipt(receipt),
        outputContent: null,
        error: receipt.status === 'failed' ? describeReceipt(receipt) : null,
        outputPath: receipt.log_path ? join(workdir, receipt.log_path) : null
      }))
    })
  }
  return evidence
}
