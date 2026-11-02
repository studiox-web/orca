import { runProcess } from '@orca/process-host'
import type { ExternalAutomationManager } from '../../shared/automations-types'
import { mapCrontabJobs, parseCrontab, type CrontabRunEvidence } from './external-crontab-jobs'
import { readCrontabLogEvidence } from './external-crontab-evidence'
import { readGoalReceiptEvidence } from './external-crontab-goal-receipts'

const CRONTAB_READ_TIMEOUT_MS = 5_000
const MANAGER_ID = 'crontab:local'

/** Lists the user's crontab read-only. Windows has no crontab, and an empty crontab hides the manager. */
export async function listLocalCrontabManager(
  providerLabel: string
): Promise<ExternalAutomationManager | null> {
  if (process.platform === 'win32') {
    return null
  }
  let text: string
  try {
    const result = await runProcess({
      program: 'crontab',
      args: ['-l'],
      timeoutMs: CRONTAB_READ_TIMEOUT_MS
    })
    // Why: `crontab -l` exits non-zero with "no crontab for <user>" when none is installed.
    if (result.timedOut || result.code !== 0) {
      return null
    }
    text = result.stdout
  } catch {
    return null
  }
  const entries = parseCrontab(text)
  if (entries.length === 0) {
    return null
  }
  const evidence = new Map<string, CrontabRunEvidence>()
  const logEvidence = await Promise.all(entries.map((entry) => readCrontabLogEvidence(entry)))
  entries.forEach((entry, index) => {
    const found = logEvidence[index]
    if (found) {
      evidence.set(entry.id, found)
    }
  })
  // Goal receipts carry real statuses, so they win over the redirected-log fallback.
  for (const [id, found] of await readGoalReceiptEvidence(entries)) {
    evidence.set(id, found)
  }
  return {
    id: MANAGER_ID,
    provider: 'crontab',
    label: `${providerLabel} on this computer`,
    targetLabel: 'this computer',
    target: { type: 'local' },
    status: 'available',
    error: null,
    canManage: false,
    jobs: mapCrontabJobs({ managerId: MANAGER_ID, entries, now: Date.now(), evidence })
  }
}
