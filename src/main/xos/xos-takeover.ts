// XOS fork: Stage D hybrid drill-in helpers (plan §3e.3, §3f, §3g.5, §3h.2): the takeover prompt
// (goal prompt + the previous run's log tail + "you are taking over"), takeover run receipts
// (§3e.6: manual sessions are runs of the goal too), and the next eligible input item for
// "Build now", including its workspace kind (code items build in a fresh worktree; ops/data
// items keep the shared project workspace).
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { XosNextGoalItem } from '../../shared/xos-goals-types'
import { readHead, readTail, parseFrontmatter } from './xos-goal-files'
import { assembleGoalPrompt } from './xos-goal-prompt'
import { resolveGoalDir, resolveStageDirs } from './xos-project-home'
import { evaluateGoalQueueGate } from './xos-queue-gate'
import { LEGACY_ITEM_TYPES } from './xos-queue-map'
import { itemTitleFrom, readReceiptLines, appendReceipt } from './xos-native-receipts'
import type { XosNativeRunTrigger } from './xos-live-runs-types'

const ITEM_PROMPT_BYTES = 32 * 1024
const RUN_CONTEXT_BYTES = 12 * 1024
const CODE_ITEM_TYPES = new Set(['feature', 'bug'])

/** Assemble a takeover prompt: goal prompt + previous-run context + "you are taking over" (§3e.3). */
export function buildTakeoverPrompt(args: {
  repoRoot: string
  goal: string
  agent?: string
  message?: string
  itemPath?: string | null
  fromStartedAt?: string | null
}):
  | { ok: true; prompt: string; goalDir: string; agent: string; fromRunId: string | null }
  | { ok: false; error: string } {
  try {
    const assembled = assembleGoalPrompt({
      repoRoot: args.repoRoot,
      goal: args.goal,
      mode: 'normal',
      operatorMessage: args.message,
      requestedAgent: args.agent,
      bypassQueueGate: true
    })
    if (assembled.status !== 'ready') {
      return { ok: false, error: assembled.reason }
    }
    let prompt = assembled.prompt
    const receipts = readReceiptLines(args.repoRoot).toReversed()
    const from = args.fromStartedAt
      ? receipts.find(
          (receipt) => receipt.goal === args.goal && receipt.started_at === args.fromStartedAt
        )
      : receipts.find((receipt) => receipt.goal === args.goal)
    if (from) {
      const context = from.log_path ? readTail(from.log_path, RUN_CONTEXT_BYTES) : null
      prompt += `\n\n## You Are Taking Over From Run ${from.run_id} (§3e)\n\n- Trigger: ${from.trigger ?? 'unknown'} · Status: ${from.status}${from.failure_reason ? ` (${from.failure_reason})` : ''} · Model: ${from.model ?? 'unknown'}\n- The full transcript is the run log at \`${from.log_path}\`.\n\n### Last screen output of that run\n\n${context ?? '_No log tail available._'}`
    }
    if (args.itemPath) {
      prompt += `\n\n## Claimed Work Item\n\n- File: ${args.itemPath} (claimed for this session)\n- Enrich it; Orca moves it when you release the goal as done; reference "${basename(args.itemPath, '.md')}" in the commit message.\n\n${readHead(args.itemPath, ITEM_PROMPT_BYTES) ?? ''}`
    }
    return {
      ok: true,
      prompt,
      goalDir: assembled.goalDir,
      agent: assembled.agent,
      fromRunId: from?.run_id ?? null
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Record an interactive takeover session as a run of the goal (§3e.6). */
export function recordTakeoverReceipt(args: {
  repoRoot: string
  goal: string
  agent: string
  trigger: XosNativeRunTrigger
  itemPath?: string | null
  worktreePath?: string | null
  branch?: string | null
  parentRunId?: string | null
  nowMs?: number
}): string {
  const nowMs = args.nowMs ?? Date.now()
  const runId = `takeover-${nowMs.toString(36)}`
  appendReceipt(args.repoRoot, {
    run_id: runId,
    goal: args.goal,
    runner: args.agent,
    status: 'takeover',
    started_at: new Date(nowMs).toISOString(),
    finished_at: null,
    duration_seconds: null,
    exit_code: null,
    log_path: '',
    trigger: args.trigger,
    mode: 'normal',
    item_path: args.itemPath ?? null,
    item_title: args.itemPath ? itemTitleFrom(args.itemPath) : null,
    worktree_path: args.worktreePath ?? null,
    branch: args.branch ?? null,
    parent_run_id: args.parentRunId ?? null
  })
  return runId
}

/** Code items (feature/bug) build in a fresh worktree; ops/data items stay in place (§3f). */
export function resolveItemWorkspace(
  repoRoot: string,
  itemPath: string
): 'new-worktree' | 'existing' {
  for (const type of LEGACY_ITEM_TYPES) {
    for (const stage of type.stages) {
      if (
        resolveStageDirs(repoRoot, type.id, stage).some((dir) => itemPath.startsWith(`${dir}/`))
      ) {
        return CODE_ITEM_TYPES.has(type.id) ? 'new-worktree' : 'existing'
      }
    }
  }
  return 'existing'
}

/** First eligible unclaimed input item of the goal's queue gate, for "Build now" (§3h.2). */
export function nextEligibleItem(repoRoot: string, goal: string): XosNextGoalItem {
  const goalDir = resolveGoalDir(repoRoot, goal)
  const fm = parseFrontmatter(readHead(join(goalDir, 'GOAL.md'), 8192))
  const gate = evaluateGoalQueueGate({ repoRoot, goal, fm })
  const path = gate.candidateItemPaths[0]
  if (!path || !existsSync(path)) {
    return null
  }
  return {
    path,
    title: itemTitleFrom(path),
    stage: basename(dirname(path)),
    workspace: resolveItemWorkspace(repoRoot, path)
  }
}
