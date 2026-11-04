import { describe, expect, it } from 'vitest'
import type { XosQueueRef } from '../../shared/xos-items-types'
import { computePipeHealth, computePipelineFromGoals, computeStuckItemAge } from './xos-pipeline'

function makeQueueRef(overrides: Partial<XosQueueRef>): XosQueueRef {
  return {
    typeId: 'feature',
    stageId: 'pitch',
    label: 'Pitches',
    count: 0,
    readyCount: null,
    floor: null,
    ceiling: null,
    oldestAt: null,
    tone: 'ok',
    ...overrides
  }
}

describe('xos-pipeline', () => {
  it('computes pipe health: starved when < floor, backed-up when >= ceiling, healthy otherwise', () => {
    expect(computePipeHealth(0, 1, 10)).toEqual({ status: 'starved', tone: 'starved' })
    expect(computePipeHealth(10, 1, 10)).toEqual({ status: 'backed-up', tone: 'backed-up' })
    expect(computePipeHealth(4, 1, 10)).toEqual({ status: 'healthy', tone: 'ok' })
    expect(computePipeHealth(0, null, null)).toEqual({ status: 'healthy', tone: 'idle' })
  })

  it('computes stuck-item age and flags items older than threshold', () => {
    const nowMs = Date.parse('2026-04-20T12:00:00Z')
    const age = computeStuckItemAge('2026-04-16T12:00:00Z', nowMs, 72)
    expect(age.oldestAgeHours).toBe(96)
    expect(age.oldestAt).toBe('2026-04-16T12:00:00.000Z')
    expect(age.stuck).toBe(true)

    const fresh = computeStuckItemAge('2026-04-20T06:00:00Z', nowMs, 72)
    expect(fresh.oldestAgeHours).toBe(6)
    expect(fresh.stuck).toBe(false)
  })

  it('connects goals into ordered pipeline flows with producer/consumer edges', () => {
    const nowMs = Date.parse('2026-04-20T12:00:00Z')
    const goals = [
      {
        goal: 'feature-discovery',
        queues: {
          in: [],
          out: [
            makeQueueRef({ stageId: 'pitch', label: 'Pitches', count: 5, floor: 2, ceiling: 12 })
          ]
        }
      },
      {
        goal: 'feature-Assessment',
        queues: {
          in: [
            makeQueueRef({ stageId: 'pitch', label: 'Pitches', count: 5, floor: 2, ceiling: 12 })
          ],
          out: [
            makeQueueRef({
              stageId: 'accepted',
              label: 'Accepted',
              count: 0,
              floor: 1,
              ceiling: 8
            })
          ]
        }
      },
      {
        goal: 'feature-Implementation',
        queues: {
          in: [
            makeQueueRef({
              stageId: 'accepted',
              label: 'Accepted',
              count: 0,
              floor: 1,
              ceiling: 8
            })
          ],
          out: [
            makeQueueRef({
              stageId: 'completed',
              label: 'Completed',
              count: 14,
              floor: null,
              ceiling: 10,
              oldestAt: '2026-04-15T12:00:00Z'
            })
          ]
        }
      }
    ]

    const summary = computePipelineFromGoals(goals, { nowMs })
    expect(summary.pipes).toHaveLength(3)
    expect(summary.healthyCount).toBe(1)
    expect(summary.starvedCount).toBe(1)
    expect(summary.backedUpCount).toBe(1)
    expect(summary.stuckCount).toBe(1)
    expect(summary.overallHealth).toBe('blocked')

    const featureFlow = summary.flows.find((f) => f.typeId === 'feature')
    expect(featureFlow?.goalOrder).toEqual([
      'feature-discovery',
      'feature-Assessment',
      'feature-Implementation'
    ])
    const pitchPipe = featureFlow?.pipes.find((p) => p.stageId === 'pitch')
    expect(pitchPipe?.fromGoals).toEqual(['feature-discovery'])
    expect(pitchPipe?.toGoals).toEqual(['feature-Assessment'])
    expect(pitchPipe?.status).toBe('healthy')
  })
})
