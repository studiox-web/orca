import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createXosQueueWatcher,
  evaluateProjectQueueTriggers,
  type XosQueueTriggerEvent
} from './xos-queue-watcher'

describe('xos-queue-watcher (Stage C §3g.3)', () => {
  let root: string
  let xosHomeDir: string
  const prevXosHome = process.env.ORCA_XOS_HOME

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xos-queue-watcher-'))
    xosHomeDir = join(root, '.orca-xos')
    process.env.ORCA_XOS_HOME = xosHomeDir
  })

  afterEach(() => {
    if (prevXosHome === undefined) {
      delete process.env.ORCA_XOS_HOME
    } else {
      process.env.ORCA_XOS_HOME = prevXosHome
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('triggers input_queue_event when an eligible item arrives and respects max_runs_per_day + lock_lane', async () => {
    const repoRoot = join(root, 'demo-repo')
    const goalADir = join(repoRoot, 'automations/goals/builder-a')
    const goalBDir = join(repoRoot, 'automations/goals/builder-b')
    const specsDir = join(repoRoot, 'docs/features/specs')
    mkdirSync(goalADir, { recursive: true })
    mkdirSync(goalBDir, { recursive: true })
    mkdirSync(specsDir, { recursive: true })

    writeFileSync(
      join(goalADir, 'GOAL.md'),
      [
        '---',
        'lock_lane: repo-mutating',
        'max_runs_per_day: 1',
        'queues:',
        '  in:',
        '    - type: feature-ideas',
        '      stage: specs',
        '      path: docs/features/specs',
        '---',
        '# Goal: Builder A'
      ].join('\n'),
      'utf8'
    )
    writeFileSync(
      join(goalBDir, 'GOAL.md'),
      [
        '---',
        'lock_lane: repo-mutating',
        'max_runs_per_day: 2',
        'queues:',
        '  in:',
        '    - type: feature-ideas',
        '      stage: specs',
        '      path: docs/features/specs',
        '---',
        '# Goal: Builder B'
      ].join('\n'),
      'utf8'
    )

    const specItemPath = join(specsDir, '2026-04-19-fast-search.md')
    writeFileSync(
      specItemPath,
      ['---', 'title: Fast Search', 'builder:', '  ready: true', '---', '# Fast Search'].join('\n'),
      'utf8'
    )

    const fired: XosQueueTriggerEvent[] = []
    const watcher = createXosQueueWatcher({
      getProjectRoots: () => [repoRoot],
      onTrigger: (ev) => {
        fired.push(ev)
      },
      debounceMs: 50
    })

    watcher.notifyPathChanged(repoRoot, specItemPath)
    const firstBatch = await watcher.flush()
    // Both builder-a and builder-b share lock_lane repo-mutating, so only builder-a fires on tick 1
    expect(firstBatch).toHaveLength(1)
    expect(firstBatch[0]?.goal).toBe('builder-a')
    expect(firstBatch[0]?.reason).toBe('input_queue_event')
    expect(firstBatch[0]?.candidateItemPaths).toContain(specItemPath)

    // On tick 2, builder-a has reached max_runs_per_day: 1, so builder-b fires next
    const secondBatch = await watcher.tick()
    expect(secondBatch).toHaveLength(1)
    expect(secondBatch[0]?.goal).toBe('builder-b')
    watcher.stop()
  })

  it('wakes upstream goal when downstream queue drops below floor and wakes reply mode on open inbox message', async () => {
    const repoRoot = join(root, 'floor-repo')
    const upstreamDir = join(repoRoot, 'automations/goals/spec-writer')
    const inboxDir = join(upstreamDir, 'inbox')
    const backlogDir = join(repoRoot, 'docs/features/backlog')
    const specsDir = join(repoRoot, 'docs/features/specs')
    mkdirSync(inboxDir, { recursive: true })
    mkdirSync(backlogDir, { recursive: true })
    mkdirSync(specsDir, { recursive: true })

    writeFileSync(
      join(upstreamDir, 'GOAL.md'),
      [
        '---',
        'lock_lane: docs-only',
        'queues:',
        '  in:',
        '    - type: feature-ideas',
        '      stage: backlog',
        '      path: docs/features/backlog',
        '  out:',
        '    - type: feature-ideas',
        '      stage: specs',
        '      path: docs/features/specs',
        '      floor: 2',
        '      ceiling: 5',
        '---',
        '# Goal: Spec Writer'
      ].join('\n'),
      'utf8'
    )

    writeFileSync(
      join(backlogDir, '2026-04-19-idea-1.md'),
      '---\ntitle: Idea 1\n---\n# Idea 1\n',
      'utf8'
    )
    // Downstream specs has 1 ready item (< floor 2)
    writeFileSync(
      join(specsDir, '2026-04-19-spec-1.md'),
      '---\ntitle: Spec 1\nbuilder:\n  ready: true\n---\n# Spec 1\n',
      'utf8'
    )

    const floorEvents = await evaluateProjectQueueTriggers({
      repoRoot,
      changedPaths: [join(specsDir, '2026-04-19-spec-1.md')]
    })
    expect(floorEvents).toHaveLength(1)
    expect(floorEvents[0]?.goal).toBe('spec-writer')
    expect(floorEvents[0]?.reason).toBe('downstream_below_floor')
    expect(floorEvents[0]?.mode).toBe('normal')

    // Now drop an open operator message into inbox/
    const msgPath = join(inboxDir, '2026-04-19T12-00-00Z-operator.md')
    writeFileSync(
      msgPath,
      '---\nid: msg-1\nfrom: operator\nto: spec-writer\nstatus: open\n---\nPlease prioritize audio effects.\n',
      'utf8'
    )
    const replyEvents = await evaluateProjectQueueTriggers({
      repoRoot,
      changedPaths: [msgPath]
    })
    expect(replyEvents).toHaveLength(1)
    expect(replyEvents[0]?.goal).toBe('spec-writer')
    expect(replyEvents[0]?.mode).toBe('reply')
    expect(replyEvents[0]?.reason).toBe('inbox_open_message')
    expect(replyEvents[0]?.lockLane).toBe('dm')
  })
})
