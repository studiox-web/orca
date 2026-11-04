// XOS fork: Orca, not the agent, moves work items after a run (§3g.4). Success advances the item and
// records the run on it; failure puts it back unclaimed with the error attached.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { audit } from './xos-crontab'
import { resolveGoalDeclaredQueues } from './xos-declared-queues'
import { parseFrontmatter, readHead } from './xos-goal-files'
import {
  patchMarkdownFrontmatter,
  recordTransitionEvent,
  transitionWorkItem
} from './xos-item-claims'
import { resolveGoalDir, resolveStageDirs } from './xos-project-home'
import { LEGACY_ITEM_TYPES, type LegacyItemType, type LegacyStage } from './xos-queue-map'
import { locateWorkItem, resolveStageTargetDir } from './xos-work-items-crud'

export type XosItemSettlement =
  | 'advanced'
  | 'moved-by-agent'
  | 'no-next-stage'
  | 'returned'
  | 'gone'

function locateStage(
  repoRoot: string,
  itemPath: string
): { type: LegacyItemType; index: number } | null {
  const dir = dirname(itemPath)
  for (const type of LEGACY_ITEM_TYPES) {
    const index = type.stages.findIndex((stage) =>
      resolveStageDirs(repoRoot, type.id, stage).includes(dir)
    )
    if (index !== -1) {
      return { type, index }
    }
  }
  return null
}

/** The stage this goal hands items to: a later one it writes, preferring a finished stage. */
function nextLegacyStage(type: LegacyItemType, index: number, goal: string): LegacyStage | null {
  const written = type.stages
    .slice(index + 1)
    .filter((stage) => stage.writers?.includes(goal) && stage.kind !== 'rejected')
  return written.find((stage) => stage.kind === 'done') ?? written[0] ?? null
}

function nextStageDir(repoRoot: string, goal: string, itemPath: string): string | null {
  const fm = parseFrontmatter(readHead(`${resolveGoalDir(repoRoot, goal)}/GOAL.md`, 16 * 1024))
  const located = locateStage(repoRoot, itemPath)
  if (fm.queues && typeof fm.queues === 'object') {
    const declared = resolveGoalDeclaredQueues(repoRoot, goal, fm).out
    const out =
      declared.find((queue) => queue.typeId === located?.type.id && queue.paths.length > 0) ??
      declared.find((queue) => queue.paths.length > 0)
    if (out) {
      return out.paths[0]
    }
  }
  if (!located) {
    return null
  }
  const stage = nextLegacyStage(located.type, located.index, goal)
  return stage ? resolveStageTargetDir(repoRoot, located.type, stage) : null
}

function oneLine(text: string): string {
  return JSON.stringify(text.replace(/\s+/g, ' ').trim().slice(0, 300))
}

/** Advance on success; on anything else the item returns to its stage, unclaimed. */
export function settleWorkItem(args: {
  repoRoot: string
  goal: string
  itemPath: string
  runId: string
  success: boolean
  error?: string | null
  branch?: string | null
  commit?: string | null
  nowMs?: number
}): XosItemSettlement {
  if (!existsSync(args.itemPath)) {
    const moved = locateWorkItem([args.repoRoot], basename(args.itemPath))
    if (!moved) {
      return 'gone'
    }
    // An older contract may still move its own file: record it, so history stays complete.
    recordTransitionEvent(args.repoRoot, {
      at: new Date(args.nowMs ?? Date.now()).toISOString(),
      item: basename(args.itemPath, '.md'),
      fromPath: args.itemPath,
      toPath: moved.item.path,
      fromStage: basename(dirname(args.itemPath)),
      toStage: moved.stage.id,
      goal: args.goal,
      runId: args.runId,
      outcome: 'moved-by-agent'
    })
    return 'moved-by-agent'
  }
  const nowIso = new Date(args.nowMs ?? Date.now()).toISOString()
  const toDir = args.success ? nextStageDir(args.repoRoot, args.goal, args.itemPath) : null
  if (toDir) {
    transitionWorkItem({
      repoRoot: args.repoRoot,
      filePath: args.itemPath,
      toDir,
      goal: args.goal,
      runId: args.runId,
      branch: args.branch ?? undefined,
      commit: args.commit ?? undefined,
      outcome: 'success',
      nowMs: args.nowMs
    })
    return 'advanced'
  }
  const patched = patchMarkdownFrontmatter(readFileSync(args.itemPath, 'utf8'), {
    claimed_by: null,
    claimed_at: null,
    claim_until: null,
    last_run_id: args.runId,
    ...(args.success
      ? { last_error: null }
      : { last_error: oneLine(args.error ?? 'The run failed.'), last_failed_at: nowIso })
  })
  writeFileSync(args.itemPath, patched, 'utf8')
  if (args.success) {
    audit({ action: 'item.no_next_stage', goal: args.goal, path: args.itemPath, runId: args.runId })
    return 'no-next-stage'
  }
  return 'returned'
}
