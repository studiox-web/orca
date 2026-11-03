import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { xosHome } from './xos-crontab'
import { parseFrontmatter } from './xos-goal-files'
import {
  claimWorkItem,
  readTransitionEvents,
  releaseWorkItemClaim,
  transitionWorkItem
} from './xos-item-claims'
import { evaluateGoalQueueGate } from './xos-queue-gate'

const tempDirs: string[] = []

function makeTempRepo(name = 'queue-repo'): string {
  const base = mkdtempSync(join(tmpdir(), 'xos-queue-'))
  tempDirs.push(base)
  const repo = join(base, name)
  mkdirSync(repo, { recursive: true })
  return repo
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
  rmSync(join(xosHome(), 'projects'), { recursive: true, force: true })
})

describe('xos-queue-gate & xos-item-claims (RT16, RT17, §3g)', () => {
  it('evaluates declared queues, enforces max_runs_per_day and ceiling, and ignores active claims until stale', () => {
    const repo = makeTempRepo('builder-repo')
    const plannedDir = join(repo, 'docs', 'features', 'planned')
    const inProgressDir = join(repo, 'docs', 'features', 'in-progress')
    mkdirSync(plannedDir, { recursive: true })
    mkdirSync(inProgressDir, { recursive: true })

    const fm = parseFrontmatter(
      [
        '---',
        'id: implement-planned-feature-backlog',
        'queues:',
        '  max_runs_per_day: 3',
        '  in:',
        '    - path: docs/features/planned',
        '      type: feature',
        '      stage: planned',
        '      ready_when: "builder.ready: true"',
        '  out:',
        '    - path: docs/features/in-progress',
        '      type: feature',
        '      stage: in-progress',
        '      ceiling: 2',
        '---'
      ].join('\n')
    )

    // 1. Empty input queue -> skipped_precheck.
    const emptyGate = evaluateGoalQueueGate({
      repoRoot: repo,
      goal: 'implement-planned-feature-backlog',
      fm
    })
    expect(emptyGate.allowed).toBe(false)
    expect(emptyGate.skippedPrecheck).toContain('input queue empty')

    // 2. Add unready item -> still skipped_precheck.
    const specPath = join(plannedDir, '2026-04-01-spec-a.md')
    writeFileSync(specPath, '---\ntitle: Spec A\nbuilder:\n  ready: false\n---\n# Spec A\n')
    expect(
      evaluateGoalQueueGate({
        repoRoot: repo,
        goal: 'implement-planned-feature-backlog',
        fm
      }).allowed
    ).toBe(false)

    // 3. Mark item ready -> allowed!
    writeFileSync(specPath, '---\ntitle: Spec A\nbuilder:\n  ready: true\n---\n# Spec A\n')
    const readyGate = evaluateGoalQueueGate({
      repoRoot: repo,
      goal: 'implement-planned-feature-backlog',
      fm
    })
    expect(readyGate.allowed).toBe(true)
    expect(readyGate.candidateItemPaths).toEqual([specPath])
    expect(readyGate.queueContext).toContain('1 ready / 1 total')

    // 4. Max runs per day cap -> skipped_precheck.
    const dailyCapGate = evaluateGoalQueueGate({
      repoRoot: repo,
      goal: 'implement-planned-feature-backlog',
      fm,
      runsToday: 3
    })
    expect(dailyCapGate.allowed).toBe(false)
    expect(dailyCapGate.skippedPrecheck).toContain('daily run cap reached (3/3 today)')

    // 5. Claim item -> active claim makes queue look empty to concurrent runs.
    const nowMs = Date.parse('2026-04-03T12:00:00Z')
    const claimed = claimWorkItem(specPath, { runId: 'run-101', nowMs })
    expect(claimed.claimed).toBe(true)
    expect(claimWorkItem(specPath, { runId: 'run-202', nowMs: nowMs + 60_000 }).claimed).toBe(false)

    const claimedGate = evaluateGoalQueueGate({
      repoRoot: repo,
      goal: 'implement-planned-feature-backlog',
      fm,
      nowMs: nowMs + 60_000
    })
    expect(claimedGate.allowed).toBe(false)
    expect(claimedGate.skippedPrecheck).toContain('1 claimed')

    // 6. After claim timeout expires, stale claim is ignored and item is eligible again!
    const expiredClaimGate = evaluateGoalQueueGate({
      repoRoot: repo,
      goal: 'implement-planned-feature-backlog',
      fm,
      nowMs: nowMs + 60 * 60_000,
      claimTimeoutMs: 45 * 60_000
    })
    expect(expiredClaimGate.allowed).toBe(true)

    // 7. Transition item to in-progress and record transition index.
    releaseWorkItemClaim(specPath)
    const movedPath = transitionWorkItem({
      repoRoot: repo,
      filePath: specPath,
      toDir: inProgressDir,
      goal: 'implement-planned-feature-backlog',
      runId: 'run-101',
      branch: 'feat/spec-a',
      commit: 'abc1234',
      outcome: 'started',
      nowMs
    })
    expect(movedPath).toBe(join(inProgressDir, '2026-04-01-spec-a.md'))
    expect(readFileSync(movedPath, 'utf8')).toContain('branch: feat/spec-a')
    const events = readTransitionEvents(repo)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      item: '2026-04-01-spec-a',
      fromStage: 'planned',
      toStage: 'in-progress',
      goal: 'implement-planned-feature-backlog',
      runId: 'run-101',
      branch: 'feat/spec-a'
    })

    // 8. Ceiling backpressure when out queue reaches ceiling (2).
    writeFileSync(
      join(plannedDir, '2026-04-02-spec-b.md'),
      '---\ntitle: Spec B\nbuilder:\n  ready: true\n---\n'
    )
    writeFileSync(join(inProgressDir, '2026-04-02-spec-c.md'), '---\ntitle: Spec C\n---\n')
    const ceilingGate = evaluateGoalQueueGate({
      repoRoot: repo,
      goal: 'implement-planned-feature-backlog',
      fm
    })
    expect(ceilingGate.allowed).toBe(false)
    expect(ceilingGate.skippedPrecheck).toContain('at ceiling (2/2)')
  })
})
