import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoordinatedAutomationCreateInput } from '../../../src/shared/automations-types'
import type { CoordinatedAutomationChildDefinition } from '../../../src/shared/coordinated-automation-types'
import { testState } from '../../../src/main/persistence/persistence-test-harness'
import {
  child,
  coordinatedCreateInput
} from '../../../src/main/persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import type { CoordinatedHostApproval } from '../../../src/main/automations/coordinated-automation-adapter'
import { CoordinatedWorkerStartError } from '../../../src/main/automations/coordinated-automation-recovery-context'
import {
  COORDINATED_WORKER_REPORT_MARKER,
  decodeWorkerReportResult
} from '../../../src/main/automations/coordinated-automation-worker-report-envelope'
import { InjectedCoordinatorCrash, RecoveryEnv } from './coordinated-automation-recovery-env'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../../src/main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../src/main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const DRAFT_ARTIFACT = { kind: 'draft', pathPattern: 'drafts/*.md', required: true }

function draft(overrides: Partial<CoordinatedAutomationChildDefinition> = {}) {
  return child('draft', {
    mutationClass: 'exclusive_writer',
    mutationLane: 'content',
    launchConfig: { maxRetries: 0 },
    stageAcceptance: { requiredArtifacts: [DRAFT_ARTIFACT] },
    ...overrides
  })
}

function review(overrides: Partial<CoordinatedAutomationChildDefinition> = {}) {
  return child('review', {
    dependencies: [{ childId: 'draft', condition: 'accepted' }],
    launchConfig: { maxRetries: 0 },
    ...overrides
  })
}

function pipeline(overrides: Partial<CoordinatedAutomationCreateInput> = {}) {
  return coordinatedCreateInput({ children: [draft(), review()], ...overrides })
}

let env: RecoveryEnv

beforeEach(async () => {
  env = await RecoveryEnv.create()
  env.scripts.set('draft', (identity, attempt) => env.artifactReport(identity, `draft v${attempt}`))
  env.scripts.set('review', (identity) => [{ type: 'report', result: env.report(identity) }])
})

afterEach(async () => {
  await env.dispose()
})

function stageApproval(runId: string, approverIdentity: string): CoordinatedHostApproval[] {
  const run = env.run(runId)
  const mapping = (run.childMappings ?? []).find((m) => m.childDefinitionId === 'draft')
  if (!mapping?.dispatchId) {
    return []
  }
  return [
    {
      scope: 'stage',
      approvalId: 'editor-approval',
      role: 'editor',
      approverIdentity,
      approvedAt: env.harness.clock.now(),
      automationId: run.automationId,
      definitionRevision: run.resolvedSnapshot!.definitionRevision,
      automationRunId: run.id,
      orchestrationRunId: run.orchestrationRunId!,
      childDefinitionId: 'draft',
      taskId: mapping.taskId,
      dispatchId: mapping.dispatchId
    }
  ]
}

describe('coordinated recovery: semantic completion', () => {
  it('issues a receipt only after every stage is accepted, keeping the readable report', async () => {
    const { runId } = env.createRun(pipeline())
    const outcome = await env.adapter.reconcileRun(runId)

    expect(outcome.state).toBe('completed')
    expect(outcome.run.status).toBe('completed')
    const receipt = outcome.run.completionReceipt!
    expect(receipt.frozenConfigDigest).toBe(env.run(runId).resolvedSnapshot!.canonicalDigest)
    expect(receipt.identityChain.taskMappings.map((m) => m.childDefinitionId)).toEqual([
      'draft',
      'review'
    ])
    const progress = env.adapter.inspectProgress(runId)!
    expect(Object.values(progress.stages).map((s) => s.status)).toEqual(['accepted', 'accepted'])
    expect(progress.reports.map((r) => r.disposition)).toEqual(['accepted', 'accepted'])
    expect(progress.stages.draft.acceptedArtifacts).toEqual([
      { uri: 'drafts/draft.md', sha256: expect.stringMatching(/^sha256:/) }
    ])
    const draftResult = env.db.getTask(env.taskId(runId, 'draft'))!.result!
    expect(draftResult.startsWith('draft done\n\ndraft readable report')).toBe(true)
    expect(draftResult).toContain(COORDINATED_WORKER_REPORT_MARKER)
    expect(decodeWorkerReportResult(draftResult)).toMatchObject({
      kind: 'structured',
      envelopeVersion: 1
    })
  })

  it('never accepts a technically completed Task whose report is readable-only', async () => {
    const { runId } = env.createRun(pipeline())
    await env.adapter.materializeRun(runId)
    const taskId = env.taskId(runId, 'draft')
    env.scripts.set('draft', () => [{ type: 'exit', code: 0 }])
    const { dispatch } = env.db.createStartingWorkerDispatch({
      taskId,
      creator: { kind: 'system' },
      maxDepth: 5,
      startOptions: {}
    })
    env.store.recordCoordinatedChildDispatch({
      automationRunId: runId,
      childDefinitionId: 'draft',
      dispatchId: dispatch.id
    })
    env.db.settleWorkerReport({
      taskId,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result: JSON.stringify({ provenance: 'worker_report', outcome: 'succeeded', body: 'done!' })
    })
    expect(env.db.getTask(taskId)!.status).toBe('completed')

    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('failed')
    expect(outcome.run.completionReceipt).toBeNull()
    expect(env.dispatchIds(runId, 'review')).toHaveLength(0)
    expect(env.adapter.inspectProgress(runId)!.reports[0]).toMatchObject({
      disposition: 'rejected',
      reason: 'done!'
    })
  })
})

describe('coordinated recovery: failure-injection matrix', () => {
  it('worker exits before writing an artifact: stage fails and no downstream Task starts', async () => {
    env.scripts.set('draft', () => [{ type: 'exit', code: 1 }])
    const { runId } = env.createRun(pipeline())
    const outcome = await env.adapter.reconcileRun(runId)

    expect(outcome.state).toBe('failed')
    expect(outcome.run.status).toBe('dispatch_failed')
    expect(outcome.run.completionReceipt).toBeNull()
    expect(env.dispatchIds(runId, 'review')).toHaveLength(0)
    expect(env.db.getTask(env.taskId(runId, 'review'))!.status).not.toBe('completed')
    const progress = env.adapter.inspectProgress(runId)!
    expect(progress.stages.draft.status).toBe('rejected')
    expect(progress.escalations.map((e) => e.code)).toEqual(['stage_rejected'])
  })

  it('artifact written but report lost: restart sees the artifact yet accepts only a later valid report', async () => {
    const { runId } = env.createRun(
      pipeline({ children: [draft({ launchConfig: { maxRetries: 1 } }), review()] })
    )
    env.harness.crashes.arm('worker-provider.before-acknowledgement')
    env.crashAt('report.after-native-settle')
    await expect(env.adapter.reconcileRun(runId)).rejects.toThrow(InjectedCoordinatorCrash)

    const [lostAttempt] = env.dispatchIds(runId, 'draft')
    expect((await env.harness.artifacts.inspect('drafts/draft.md')).exists).toBe(true)
    expect(env.adapter.inspectProgress(runId)!.stages.draft.status).toBe('pending')
    expect(env.db.getDispatchContextById(lostAttempt)!.status).toBe('failed')

    await env.reopen()
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('completed')
    const progress = env.adapter.inspectProgress(runId)!
    const draftReports = progress.reports.filter((r) => r.childDefinitionId === 'draft')
    expect(draftReports.map((r) => [r.dispatchId, r.disposition])).toEqual([
      [lostAttempt, 'rejected'],
      [env.dispatchIds(runId, 'draft')[1], 'accepted']
    ])
    expect(progress.stages.draft.acceptedDispatchId).toBe(env.dispatchIds(runId, 'draft')[1])
  })

  it('artifact written but report lost with no retry budget never completes', async () => {
    const { runId } = env.createRun(pipeline())
    env.harness.crashes.arm('worker-provider.before-acknowledgement')
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('failed')
    expect((await env.harness.artifacts.inspect('drafts/draft.md')).exists).toBe(true)
    expect(outcome.run.completionReceipt).toBeNull()
    expect(env.dispatchIds(runId, 'review')).toHaveLength(0)
  })

  it('report committed but acknowledgement lost: duplicate delivery reuses the report identity', async () => {
    const { runId } = env.createRun(pipeline())
    env.crashAt('report.after-native-settle')
    await expect(env.adapter.reconcileRun(runId)).rejects.toThrow(InjectedCoordinatorCrash)
    expect(env.adapter.inspectProgress(runId)!.reports).toHaveLength(0)

    await env.reopen()
    const first = await env.adapter.reconcileRun(runId)
    expect(first.state).toBe('completed')
    const [draftDispatch] = env.dispatchIds(runId, 'draft')
    const decoded = decodeWorkerReportResult(env.db.getTask(env.taskId(runId, 'draft'))!.result)
    expect(decoded.kind).toBe('structured')
    const resubmitted = env.adapter.submitWorkerReport({
      automationRunId: runId,
      taskId: env.taskId(runId, 'draft'),
      dispatchId: draftDispatch,
      report: decoded.kind === 'structured' ? decoded.report : null
    })
    expect(resubmitted.disposition).toBe('duplicate')
    const progress = env.adapter.inspectProgress(runId)!
    expect(resubmitted.reportDigest).toBe(progress.stages.draft.acceptedReportDigest)

    const again = await env.adapter.reconcileRun(runId)
    expect(again.run.completionReceipt).toEqual(first.run.completionReceipt)
    expect(env.dispatchIds(runId, 'draft')).toEqual([draftDispatch])
    expect(
      env.adapter.inspectProgress(runId)!.reports.filter((r) => r.disposition === 'accepted')
    ).toHaveLength(2)
  })

  it('late report from a superseded attempt stays auditable but cannot satisfy the stage', async () => {
    env.scripts.set('draft', (identity, attempt) =>
      attempt === 1
        ? [{ type: 'report', result: env.report(identity, { outcome: 'failed', checks: [] }) }]
        : env.artifactReport(identity, 'draft v2')
    )
    const { runId } = env.createRun(
      pipeline({ children: [draft({ launchConfig: { maxRetries: 1 } }), review()] })
    )
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('completed')
    const [superseded, active] = env.dispatchIds(runId, 'draft')

    const late = env.adapter.submitWorkerReport({
      automationRunId: runId,
      taskId: env.taskId(runId, 'draft'),
      dispatchId: superseded,
      report: env.report({
        automationRunId: runId,
        orchestrationRunId: outcome.run.orchestrationRunId!,
        childDefinitionId: 'draft',
        taskId: env.taskId(runId, 'draft'),
        dispatchId: superseded
      })
    })
    expect(late.disposition).not.toBe('settled')
    const progress = env.adapter.inspectProgress(runId)!
    expect(progress.stages.draft.acceptedDispatchId).toBe(active)
    expect(progress.reports.at(-1)).toMatchObject({
      dispatchId: superseded,
      disposition: late.disposition,
      reportDigest: late.reportDigest
    })
    const reread = await env.adapter.reconcileRun(runId)
    expect(reread.run.completionReceipt).toEqual(outcome.run.completionReceipt)
  })

  it('artifact digest changes after approval: acceptance is voided and no receipt is issued', async () => {
    const { runId } = env.createRun(
      pipeline({
        children: [
          draft({
            stageAcceptance: {
              requiredArtifacts: [DRAFT_ARTIFACT],
              requiredApprovals: [{ id: 'editor-approval', role: 'editor', required: true }]
            }
          }),
          review()
        ]
      })
    )
    env.approvals = () => stageApproval(runId, 'editor@example.test')
    env.scripts.set('review', async (identity) => {
      await env.harness.artifacts.tamper('drafts/draft.md', 'edited after approval')
      return [{ type: 'report', result: env.report(identity) }]
    })
    const outcome = await env.adapter.reconcileRun(runId)

    expect(outcome.state).toBe('blocked')
    expect(outcome.run.status).not.toBe('completed')
    expect(outcome.run.completionReceipt).toBeNull()
    const progress = env.adapter.inspectProgress(runId)!
    expect(progress.stages.draft.status).toBe('invalidated')
    expect(progress.escalations).toEqual([
      expect.objectContaining({ code: 'artifact_mutated', requiresHumanDecision: true })
    ])
    expect((await env.adapter.reconcileRun(runId)).state).toBe('blocked')
  })

  it('reviewer and author identity are the same: final approval is rejected', async () => {
    const stageGated = draft({
      stageAcceptance: {
        requiredArtifacts: [DRAFT_ARTIFACT],
        requiredApprovals: [{ id: 'editor-approval', role: 'editor', required: true }]
      }
    })
    const { runId } = env.createRun(pipeline({ children: [stageGated, review()] }))
    env.approvals = () => stageApproval(runId, 'worker:draft')
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('failed')
    expect(outcome.run.completionReceipt).toBeNull()
    expect(env.adapter.inspectProgress(runId)!.stages.draft.lastError).toContain('self-approval')
  })

  it('parent approval by an authoring worker is rejected; a distinct approver completes', async () => {
    const { runId } = env.createRun(
      pipeline({
        outcomeContract: {
          ...coordinatedCreateInput().outcomeContract!,
          requiredApprovals: [{ id: 'publish-ok', role: 'publisher' }]
        }
      })
    )
    let approver = 'worker:review'
    env.approvals = () => {
      const run = env.run(runId)
      return [
        {
          scope: 'parent',
          approvalId: 'publish-ok',
          role: 'publisher',
          approverIdentity: approver,
          approvedAt: env.harness.clock.now(),
          automationId: run.automationId,
          definitionRevision: run.resolvedSnapshot!.definitionRevision,
          automationRunId: run.id,
          orchestrationRunId: run.orchestrationRunId ?? ''
        }
      ]
    }
    const rejected = await env.adapter.reconcileRun(runId)
    expect(rejected.state).toBe('blocked')
    expect(rejected.run.completionReceipt).toBeNull()
    expect(rejected.run.error).toContain('self-approval')

    approver = 'publisher@example.test'
    const accepted = await env.adapter.reconcileRun(runId)
    expect(accepted.state).toBe('completed')
    expect(accepted.run.completionReceipt!.approvals.map((a) => a.approverIdentity)).toEqual([
      'publisher@example.test'
    ])
    expect(env.dispatchIds(runId, 'draft')).toHaveLength(1)
  })

  it('review limit reached: escalates once and opens no further fix attempt', async () => {
    env.scripts.set('review', (identity, attempt) => [
      {
        type: 'report',
        result: env.report(identity, {
          outcome: 'failed',
          blockers: [{ code: 'STYLE', message: `issue ${attempt}`, resolvableBy: 'upstream_fix' }]
        })
      }
    ])
    const { runId } = env.createRun(pipeline())
    const outcome = await env.adapter.reconcileRun(runId)

    expect(outcome.state).toBe('blocked')
    expect(env.dispatchIds(runId, 'draft')).toHaveLength(3)
    expect(env.dispatchIds(runId, 'review')).toHaveLength(3)
    const progress = env.adapter.inspectProgress(runId)!
    expect(progress.stages.draft.reviewIterations).toBe(2)
    expect(progress.escalations.map((e) => e.code)).toEqual(['review_limit'])

    await env.reopen()
    expect((await env.adapter.reconcileRun(runId)).state).toBe('blocked')
    expect(env.dispatchIds(runId, 'draft')).toHaveLength(3)
    expect(env.adapter.inspectProgress(runId)!.escalations).toHaveLength(1)
  })

  it('a repeated material finding escalates instead of looping', async () => {
    env.scripts.set('review', (identity) => [
      {
        type: 'report',
        result: env.report(identity, {
          outcome: 'failed',
          blockers: [{ code: 'FACT', message: 'Source is wrong', resolvableBy: 'upstream_fix' }]
        })
      }
    ])
    const { runId } = env.createRun(pipeline())
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('blocked')
    expect(env.dispatchIds(runId, 'draft')).toHaveLength(2)
    expect(env.adapter.inspectProgress(runId)!.escalations.map((e) => e.code)).toEqual([
      'repeated_finding'
    ])
  })

  it('a fixed draft re-earns acceptance and the reviewer re-runs on the new version', async () => {
    env.scripts.set('review', (identity, attempt) => [
      {
        type: 'report',
        result:
          attempt === 1
            ? env.report(identity, {
                outcome: 'failed',
                blockers: [{ code: 'TONE', message: 'Too long', resolvableBy: 'upstream_fix' }]
              })
            : env.report(identity)
      }
    ])
    const { runId } = env.createRun(pipeline())
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('completed')
    const progress = env.adapter.inspectProgress(runId)!
    expect(progress.stages.draft.acceptedDispatchId).toBe(env.dispatchIds(runId, 'draft')[1])
    expect(progress.stages.draft.reviewIterations).toBe(1)
  })

  it('cost ceiling reached: no new Dispatch starts and the escalation is visible', async () => {
    env.costPerAttemptUsd = 1
    const { runId } = env.createRun(pipeline({ globalCeilings: { maxEstimatedCostUsd: 1.5 } }))
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('blocked')
    expect(env.dispatchIds(runId, 'review')).toHaveLength(0)
    const progress = env.adapter.inspectProgress(runId)!
    expect(progress.spentCostUsd).toBe(1)
    expect(progress.halt).toMatchObject({ state: 'blocked' })
    expect(progress.escalations.map((e) => e.code)).toEqual(['cost_ceiling'])
  })

  it('wall-clock ceiling reached before report admission: no acceptance or new Dispatch', async () => {
    const { runId } = env.createRun(pipeline({ globalCeilings: { maxWallClockSeconds: 60 } }))
    env.crashAt('report.after-native-settle')
    await expect(env.adapter.reconcileRun(runId)).rejects.toThrow(InjectedCoordinatorCrash)
    await env.harness.clock.advanceBy(120_000)
    await env.reopen()
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('blocked')
    expect(outcome.run.status).toBe('dispatched')
    expect(outcome.run.error).toContain('wall-clock')
    expect(env.adapter.inspectProgress(runId)!.stages.draft.status).toBe('pending')
    expect(env.adapter.inspectProgress(runId)!.reports).toEqual([])
    expect(env.run(runId).completionReceipt ?? null).toBeNull()
    expect(env.dispatchIds(runId, 'review')).toHaveLength(0)
    expect(env.adapter.inspectProgress(runId)!.escalations.map((e) => e.code)).toEqual([
      'wall_clock_ceiling'
    ])
  })

  it('concurrency ceiling holds independent stages to one active attempt', async () => {
    const independent = [child('left'), child('right')]
    for (const id of ['left', 'right']) {
      env.scripts.set(id, (identity) => [{ type: 'report', result: env.report(identity) }])
    }
    const limited = env.createRun(
      coordinatedCreateInput({ children: independent, globalCeilings: { maxConcurrency: 1 } })
    )
    expect((await env.adapter.reconcileRun(limited.runId)).state).toBe('completed')
    expect(env.maxRunning).toBe(1)

    env.maxRunning = 0
    const open = env.createRun(coordinatedCreateInput({ children: independent }))
    expect((await env.adapter.reconcileRun(open.runId)).state).toBe('completed')
    expect(env.maxRunning).toBe(2)
  })

  it('start failures trip the circuit before the retry budget is spent', async () => {
    env.scripts.set('draft', () => {
      throw new CoordinatedWorkerStartError('agent binary missing')
    })
    const { runId } = env.createRun(
      pipeline({
        children: [draft({ launchConfig: { maxRetries: 5 } }), review()],
        globalCeilings: { maxDispatchStartFailures: 2 }
      })
    )
    const outcome = await env.adapter.reconcileRun(runId)
    expect(outcome.state).toBe('blocked')
    expect(env.dispatchIds(runId, 'draft')).toHaveLength(2)
    expect(env.adapter.inspectProgress(runId)!.dispatchStartFailures).toBe(2)
    expect(env.adapter.inspectProgress(runId)!.escalations.map((e) => e.code)).toEqual([
      'start_failure_ceiling'
    ])
  })

  it('lock unavailable: waits without bypassing or stealing an apparently expired lock', async () => {
    const held = new Map([['content', { holder: 'other-run', expiresAt: 1 }]])
    const attempts: string[] = []
    env.laneLocks = {
      tryAcquire: (lane, owner) => {
        attempts.push(owner)
        const current = held.get(lane)
        if (current) {
          return { acquired: false, holder: current.holder, expiresAt: current.expiresAt }
        }
        held.set(lane, { holder: owner, expiresAt: Number.MAX_SAFE_INTEGER })
        return { acquired: true, release: () => held.delete(lane) }
      }
    }
    await env.reopen()
    const { runId } = env.createRun(pipeline())

    const waiting = await env.adapter.reconcileRun(runId)
    expect(waiting.state).toBe('waiting')
    expect(waiting.reason).toContain('other-run')
    expect(env.dispatchIds(runId, 'draft')).toHaveLength(0)
    expect(held.get('content')?.holder).toBe('other-run')
    expect((await env.adapter.reconcileRun(runId)).state).toBe('waiting')
    expect(env.adapter.inspectProgress(runId)!.escalations.map((e) => e.code)).toEqual([
      'lock_unavailable'
    ])

    held.delete('content')
    expect((await env.adapter.reconcileRun(runId)).state).toBe('completed')
    expect(held.size).toBe(0)
    expect(attempts.length).toBeGreaterThanOrEqual(3)
  })

  it('definition edited mid-run: frozen snapshot, digest, and launch inputs are unchanged', async () => {
    const { automationId, runId } = env.createRun(pipeline())
    const frozen = structuredClone(env.run(runId).resolvedSnapshot!)
    env.scripts.set('draft', (identity) => {
      env.store.updateCoordinatedAutomation(automationId, {
        expectedDefinitionRevision: 1,
        children: [
          draft(),
          review({ launchConfig: { maxRetries: 0, model: 'edited-model' }, name: 'Edited' })
        ]
      })
      return env.artifactReport(identity, 'draft during edit')
    })
    const outcome = await env.adapter.reconcileRun(runId)

    expect(outcome.state).toBe('completed')
    expect(env.store.listAutomations().find((a) => a.id === automationId)!.definitionRevision).toBe(
      2
    )
    expect(env.run(runId).resolvedSnapshot).toEqual(frozen)
    expect(outcome.run.completionReceipt!.frozenConfigDigest).toBe(frozen.canonicalDigest)
    const [reviewDispatch] = env.dispatchIds(runId, 'review')
    const startOptions = JSON.parse(env.db.getWorkerDispatch(reviewDispatch)!.start_options!)
    const frozenReview = frozen.resolvedChildren.find((c) => c.childDefinitionId === 'review')!
    expect(startOptions.model).toBe(frozenReview.launchConfig.model)
    expect(startOptions.model).not.toBe('edited-model')
  })
})
