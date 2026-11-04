// XOS fork: H3. The queues block exactly as xos/PLAN.md §3g documents it must work.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseFrontmatter } from './xos-goal-files'
import { projectHomeDir } from './xos-project-home'
import { evaluateGoalQueueGate, resolveGoalDeclaredQueues } from './xos-queue-gate'

const PLAN_EXAMPLE = `---
queues:
  in:
    - id: candidates
      path: inbox/ # relative to the goal home (§5)
      ready_when: count >= 1
  out:
    - id: ready-specs
      path: items/feature/planned/ # relative to the Orca project home
      match: builder.ready == true
      floor: 5
      ceiling: 8
      hard_cap: 10
  rejects: inbox/{not-now,too-big}/
max_runs_per_day: 3
---
`

let base: string
let repo: string
let goalDir: string
let planned: string
const fm = (): Record<string, unknown> => parseFrontmatter(PLAN_EXAMPLE)

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'xos-queues-'))
  process.env.ORCA_XOS_HOME = join(base, 'home')
  repo = join(base, 'site')
  goalDir = join(repo, 'automations', 'goals', 'groomer')
  mkdirSync(join(goalDir, 'inbox'), { recursive: true })
  writeFileSync(join(goalDir, 'GOAL.md'), PLAN_EXAMPLE)
  planned = join(projectHomeDir(repo), 'items', 'feature', 'planned')
  mkdirSync(planned, { recursive: true })
})

afterEach(() => {
  delete process.env.ORCA_XOS_HOME
  rmSync(base, { recursive: true, force: true })
})

describe('the plan’s queues syntax', () => {
  it('parses every field', () => {
    const declared = resolveGoalDeclaredQueues(repo, 'groomer', fm())
    expect(declared.in[0]).toMatchObject({ paths: [join(goalDir, 'inbox')], minCount: 1 })
    expect(declared.out[0]).toMatchObject({
      paths: [planned],
      matchKey: 'builder.ready',
      matchValue: 'true',
      floor: 5,
      ceiling: 8,
      hardCap: 10
    })
    expect(declared.rejects).toEqual(['inbox/not-now/', 'inbox/too-big/'])
    expect(declared.maxRunsPerDay).toBe(3)
  })

  it('finds work in the goal’s own inbox', () => {
    writeFileSync(join(goalDir, 'inbox', 'pitch.md'), '---\ntitle: Pitch\n---\n')
    const gate = evaluateGoalQueueGate({ repoRoot: repo, goal: 'groomer', fm: fm() })
    expect(gate).toMatchObject({ allowed: true, hasInputWork: true, totalEligibleIn: 1 })
  })

  it('holds a queue below `count >= N`', () => {
    const custom = parseFrontmatter(PLAN_EXAMPLE.replace('count >= 1', 'count >= 2'))
    writeFileSync(join(goalDir, 'inbox', 'pitch.md'), '---\ntitle: Pitch\n---\n')
    expect(evaluateGoalQueueGate({ repoRoot: repo, goal: 'groomer', fm: custom }).allowed).toBe(
      false
    )
  })

  it('counts only matching items toward the ceiling', () => {
    writeFileSync(join(goalDir, 'inbox', 'pitch.md'), '---\ntitle: Pitch\n---\n')
    for (let index = 0; index < 8; index += 1) {
      writeFileSync(join(planned, `draft-${index}.md`), '---\nbuilder:\n  ready: false\n---\n')
    }
    expect(evaluateGoalQueueGate({ repoRoot: repo, goal: 'groomer', fm: fm() }).allowed).toBe(true)
    for (let index = 0; index < 8; index += 1) {
      writeFileSync(join(planned, `ready-${index}.md`), '---\nbuilder:\n  ready: true\n---\n')
    }
    const full = evaluateGoalQueueGate({ repoRoot: repo, goal: 'groomer', fm: fm() })
    expect(full.skippedPrecheck).toContain('at ceiling (8/8)')
  })

  it('still reads the older `key: value` form', () => {
    const older = parseFrontmatter(
      '---\nqueues:\n  in:\n    - path: inbox\n      ready_when: "builder.ready: true"\n---\n'
    )
    expect(resolveGoalDeclaredQueues(repo, 'groomer', older).in[0]).toMatchObject({
      readyKey: 'builder.ready',
      readyValue: 'true'
    })
  })
})
