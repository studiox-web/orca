import { describe, expect, it } from 'vitest'
import type { XosGoalUsage } from '../../shared/xos-goals-types'
import {
  computeCostPerShippedFeature,
  computeFunnelStats,
  computeRejectionBucketStats,
  computeStuckItemAlerts,
  computeTimeInQueue,
  computeTokenBurnForecast,
  computeWeeklyVelocity
} from './xos-analytics'
import type { XosItemTransitionEvent } from './xos-item-claims'

function makeTransition(
  overrides: Partial<XosItemTransitionEvent> &
    Pick<XosItemTransitionEvent, 'item' | 'fromStage' | 'toStage' | 'goal' | 'at'>
): XosItemTransitionEvent {
  return {
    fromPath: `/repo/items/${overrides.fromStage}/${overrides.item}.md`,
    toPath: `/repo/items/${overrides.toStage}/${overrides.item}.md`,
    runId: 'run-1',
    ...overrides
  }
}

describe('xos-analytics', () => {
  it('computes time-in-queue dwell stats and stuck-item alerts', () => {
    const nowMs = Date.parse('2026-04-20T12:00:00Z')
    const transitions: XosItemTransitionEvent[] = [
      makeTransition({
        item: 'feat-a',
        fromStage: 'pitch',
        toStage: 'accepted',
        goal: 'feature-Assessment',
        runId: 'run-1',
        at: '2026-04-18T00:00:00Z'
      }),
      makeTransition({
        item: 'feat-a',
        fromStage: 'accepted',
        toStage: 'planned',
        goal: 'feature-Planning',
        runId: 'run-2',
        at: '2026-04-18T12:00:00Z'
      }),
      makeTransition({
        item: 'feat-a',
        fromStage: 'planned',
        toStage: 'completed',
        goal: 'feature-Implementation',
        runId: 'run-3',
        at: '2026-04-19T12:00:00Z'
      })
    ]
    const activeItems = [
      {
        item: 'feat-stuck',
        path: '/repo/items/feature/accepted/feat-stuck.md',
        typeId: 'feature',
        stageId: 'accepted',
        mtimeMs: Date.parse('2026-04-15T12:00:00Z'),
        claimedBy: 'feature-Planning'
      }
    ]

    const dwell = computeTimeInQueue(transitions, activeItems, nowMs)
    const accepted = dwell.find((d) => d.stageId === 'accepted')
    expect(accepted?.sampleCount).toBe(2)
    expect(accepted?.avgHours).toBe(66)

    const alerts = computeStuckItemAlerts(activeItems, nowMs, 72)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].item).toBe('feat-stuck')
    expect(alerts[0].ageHours).toBe(120)
    expect(alerts[0].claimedBy).toBe('feature-Planning')
  })

  it('computes funnel conversion (inbox -> accepted -> ready -> completed) and rejection buckets', () => {
    const funnel = computeFunnelStats({
      inboxCount: 10,
      acceptedCount: 4,
      readyCount: 3,
      inProgressCount: 1,
      completedCount: 6,
      rejectedCount: 16
    })
    expect(funnel.map((s) => s.stage)).toEqual(['inbox', 'accepted', 'ready', 'completed'])
    expect(funnel[0].cumulativeCount).toBe(30)
    expect(funnel[1].cumulativeCount).toBe(14)
    expect(funnel[2].cumulativeCount).toBe(10)
    expect(funnel[3].cumulativeCount).toBe(6)
    expect(funnel[3].conversionFromTopPct).toBe(20)

    const rejections = computeRejectionBucketStats([
      'duplicate',
      'duplicate',
      'out-of-scope',
      { bucket: 'needs-evidence', count: 2 }
    ])
    expect(rejections[0]).toEqual({ bucket: 'duplicate', count: 2, sharePct: 40 })
    expect(rejections[1]).toEqual({ bucket: 'needs-evidence', count: 2, sharePct: 40 })
    expect(rejections[2]).toEqual({ bucket: 'out-of-scope', count: 1, sharePct: 20 })
  })

  it('computes weekly velocity and cost per shipped feature joining transitions with token usage', () => {
    const nowMs = Date.parse('2026-04-20T12:00:00Z')
    const transitions: XosItemTransitionEvent[] = [
      makeTransition({
        item: 'feat-1',
        fromStage: 'pitch',
        toStage: 'accepted',
        goal: 'feature-Assessment',
        runId: 'run-a',
        at: '2026-04-17T10:00:00Z'
      }),
      makeTransition({
        item: 'feat-1',
        fromStage: 'accepted',
        toStage: 'completed',
        goal: 'feature-Implementation',
        runId: 'run-b',
        at: '2026-04-18T10:00:00Z'
      }),
      makeTransition({
        item: 'bug-1',
        fromStage: 'triaged',
        toStage: 'fixed',
        goal: 'Bug-Management',
        runId: 'run-c',
        at: '2026-04-19T10:00:00Z'
      })
    ]

    const velocity = computeWeeklyVelocity(transitions, { nowMs, weeks: 2 })
    expect(velocity).toHaveLength(2)
    expect(velocity[1].featuresCompleted).toBe(1)
    expect(velocity[1].bugsFixed).toBe(1)
    expect(velocity[1].completedCount).toBe(2)

    const usageByGoal = new Map<string, XosGoalUsage[]>([
      [
        'feature-Assessment',
        [
          {
            ts: '2026-04-17T10:05:00Z',
            feature: 'feat-1',
            model: 'claude-sonnet-4-6',
            actual_tokens: 12_000,
            estimated_cost_usd: 0.45
          }
        ]
      ]
    ])
    const costSummary = computeCostPerShippedFeature({
      transitions,
      usageByGoal,
      runCostById: {
        'run-b': { tokens: 28_000, costUsd: 1.05, model: 'claude-opus-4-6' }
      }
    })
    expect(costSummary.shippedFeatures).toHaveLength(1)
    expect(costSummary.shippedFeatures[0].tokens).toBe(40_000)
    expect(costSummary.shippedFeatures[0].costUsd).toBe(1.5)
    expect(costSummary.avgCostPerFeatureUsd).toBe(1.5)

    const forecast = computeTokenBurnForecast({
      usedPercent: 45,
      windowMinutes: 300,
      resetsAtMs: nowMs + 2.5 * 3_600_000,
      targetUtilizationPct: 95,
      nowMs
    })
    expect(forecast.projectedPctAtReset).toBe(90)
    expect(forecast.status).toBe('on-track')
  })
})
