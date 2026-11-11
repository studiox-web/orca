import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCrontab } from './external-crontab-jobs'
import { readGoalReceiptEvidence } from './external-crontab-goal-receipts'

let root: string | null = null

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
    root = null
  }
})

function workspaceWithReceipts(lines: object[]): string {
  root = mkdtempSync(join(tmpdir(), 'crontab-receipts-'))
  mkdirSync(join(root, 'automations', 'logs'), { recursive: true })
  writeFileSync(
    join(root, 'automations', 'logs', 'automation-runs.jsonl'),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n{"partial":`
  )
  return root
}

describe('readGoalReceiptEvidence', () => {
  it('maps the newest receipts for each goal runner job', async () => {
    const dir = workspaceWithReceipts([
      {
        goal: 'editor',
        status: 'success',
        started_at: '2026-11-01T22:25:01Z',
        duration_seconds: 72,
        exit_code: 0,
        model: 'sonnet'
      },
      { goal: 'writer', status: 'success', started_at: '2026-11-01T21:25:01Z' },
      {
        goal: 'editor',
        status: 'failed',
        started_at: '2026-11-02T22:25:01Z',
        duration_seconds: 66,
        exit_code: 1,
        model: 'sonnet',
        log_path: 'storage/logs/editor.log'
      }
    ])
    const entries = parseCrontab(
      `25 15 * * * cd ${dir} && ./automations/bin/run-goal-cron.sh editor claude\n0 1 * * * cd ${dir} && ./other.sh`
    )
    const evidence = await readGoalReceiptEvidence(entries)

    expect(evidence.has(entries[1].id)).toBe(false)
    const editor = evidence.get(entries[0].id)
    expect(editor).toMatchObject({
      lastRunAt: '2026-11-02T22:25:01Z',
      lastStatus: 'failed',
      lastError: 'failed · sonnet · 1.1m · exit 1'
    })
    expect(editor?.runs.map((run) => run.status)).toEqual(['failed', 'completed'])
    expect(editor?.runs[0].outputPath).toBe(join(dir, 'storage/logs/editor.log'))
  })

  it('returns nothing when the workdir has no receipts file', async () => {
    const entries = parseCrontab(
      '0 1 * * * cd /nonexistent && ./automations/bin/run-goal-cron.sh x codex'
    )
    expect((await readGoalReceiptEvidence(entries)).size).toBe(0)
  })
})
