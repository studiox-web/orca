// XOS fork: Stage E pipeline flow computation between goals based on declared queues (PL1–PL4, §3g.7).
import { statSync } from 'node:fs'
import { join } from 'node:path'
import {
  addUnique,
  computePipelineFromGoals as computeSharedPipeline,
  DEFAULT_STUCK_ITEM_HOURS,
  finalizeSummary,
  upsertSeed,
  type PipeSeed,
  type XosPipelineSummary
} from '../../shared/xos-pipeline-model'
import { resolveGoalDeclaredQueues } from './xos-declared-queues'
import { parseFrontmatter, readHead, safeReaddir } from './xos-goal-files'
import { listProjectGoals, resolveGoalDir } from './xos-project-home'
import { LEGACY_ITEM_TYPES } from './xos-queue-map'

export {
  computePipeHealth,
  computeStuckItemAge,
  DEFAULT_STUCK_ITEM_HOURS,
  type XosPipelineFlow,
  type XosPipelinePipe,
  type XosPipelineSummary,
  type XosPipeStatus
} from '../../shared/xos-pipeline-model'

/** Flows ordered by the legacy stage map (the renderer sorts by its own type list). */
export function computePipelineFromGoals(
  goals: Parameters<typeof computeSharedPipeline>[0],
  options?: { nowMs?: number; stuckAfterHours?: number }
): XosPipelineSummary {
  return computeSharedPipeline(goals, { ...options, types: LEGACY_ITEM_TYPES })
}

const ITEM_HEAD_BYTES = 8 * 1024

function scanQueuePaths(paths: string[], readyKey?: string, readyValue?: string) {
  let count = 0
  let ready = 0
  let oldestMs: number | null = null
  for (const dir of paths) {
    for (const name of safeReaddir(dir)) {
      const lower = name.toLowerCase()
      if (
        !lower.endsWith('.md') ||
        lower.startsWith('.') ||
        lower === 'readme.md' ||
        lower === 'template.md'
      ) {
        continue
      }
      const full = join(dir, name)
      try {
        const stat = statSync(full)
        if (!stat.isFile()) {
          continue
        }
        count += 1
        if (oldestMs === null || stat.mtimeMs < oldestMs) {
          oldestMs = stat.mtimeMs
        }
        if (readyKey) {
          let cur: unknown = parseFrontmatter(readHead(full, ITEM_HEAD_BYTES))
          for (const p of readyKey.split('.')) {
            const isRec = typeof cur === 'object' && cur !== null
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: safe record traversal
            cur = isRec ? (cur as Record<string, unknown>)[p] : undefined
          }
          const ok =
            !readyValue || readyValue.toLowerCase() === 'true'
              ? cur === true || cur === 'true' || cur === 'yes'
              : String(cur ?? '').toLowerCase() === readyValue.toLowerCase()
          if (ok) {
            ready += 1
          }
        }
      } catch {
        // Concurrent move.
      }
    }
  }
  return {
    count,
    readyCount: readyKey ? ready : null,
    oldestAt: oldestMs !== null ? new Date(oldestMs).toISOString() : null
  }
}

export function computeRepoPipeline(
  repoRoot: string,
  options?: { nowMs?: number; stuckAfterHours?: number }
): XosPipelineSummary {
  const goalNames = listProjectGoals(repoRoot)
  const seeds = new Map<string, PipeSeed>()
  for (const goal of goalNames) {
    const fm = parseFrontmatter(readHead(join(resolveGoalDir(repoRoot, goal), 'GOAL.md')))
    const declared = resolveGoalDeclaredQueues(repoRoot, goal, fm)
    const register = (
      q: (typeof declared.in)[number] & (typeof declared.out)[number],
      dir: 'in' | 'out'
    ): void => {
      const typeId = q.typeId ?? 'custom'
      const stageId = q.stageId ?? (q.paths[0] || q.label)
      const id =
        q.typeId && q.stageId ? `${typeId}:${stageId}` : (q.paths[0] ?? `${typeId}:${stageId}`)
      const seed = upsertSeed(seeds, id, typeId, stageId, q.label)
      q.paths.forEach((p) => addUnique(seed.paths, p))
      addUnique(dir === 'out' ? seed.fromGoals : seed.toGoals, goal)
      seed.floor = q.floor ?? seed.floor
      seed.ceiling = q.ceiling ?? seed.ceiling
      seed.hardCap = q.hardCap ?? seed.hardCap
      seed.readyKey = q.readyKey ?? seed.readyKey
      seed.readyValue = q.readyValue ?? seed.readyValue
    }
    declared.out.forEach((q) => register(q, 'out'))
    declared.in.forEach((q) => register(q, 'in'))
  }
  for (const seed of seeds.values()) {
    Object.assign(seed, scanQueuePaths(seed.paths, seed.readyKey, seed.readyValue))
  }
  return finalizeSummary(
    seeds.values(),
    options?.nowMs ?? Date.now(),
    options?.stuckAfterHours ?? DEFAULT_STUCK_ITEM_HOURS,
    LEGACY_ITEM_TYPES
  )
}
