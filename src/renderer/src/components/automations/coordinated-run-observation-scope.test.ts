import { describe, expect, it } from 'vitest'
import { projectCoordinatedAutomationRun } from './coordinated-automation-run-projection'
import {
  sampleActiveCoordinatedRun,
  sampleCoordinatedArticleAutomation
} from './coordinated-automation-run-fixture-data'
import { sampleActiveRunObservation } from './coordinated-automation-run-fixture-scenarios'
import { sampleCompletedVerifiedRun } from './AutomationCoordinatedRunPanel.fixture'
import { coordinatedHostViewFixture } from './coordinated-host-run-view-fixture'
import { validateCoordinatedRunView } from './coordinated-run-api-client'

const project = (observation = sampleActiveRunObservation, run = sampleActiveCoordinatedRun) =>
  projectCoordinatedAutomationRun({
    automation: sampleCoordinatedArticleAutomation,
    run,
    observation
  })

describe('coordinated projection evidence scope', () => {
  it.each([
    'automationId',
    'automationRunId',
    'orchestrationRunId',
    'executionAuthority',
    'canonicalDigest'
  ] as const)(
    'rejects all observations from a different %s before deriving counts or navigation',
    (field) => {
      const value = project({
        ...sampleActiveRunObservation,
        scope: { ...sampleActiveRunObservation.scope, [field]: 'foreign' }
      })
      expect(value.hasPendingQuestions).toBe(false)
      expect(value.stages.every((stage) => stage.artifacts.length === 0)).toBe(true)
      expect(
        value.stages.every((stage) => stage.attempts.every((attempt) => !attempt.canOpenWorker))
      ).toBe(true)
      expect(value.stages.some((stage) => stage.semanticAcceptanceStatus === 'accepted')).toBe(
        false
      )
    }
  )
  it('rejects a different definition revision and missing scope', () => {
    expect(
      project({
        ...sampleActiveRunObservation,
        scope: { ...sampleActiveRunObservation.scope, definitionRevision: 99 }
      }).hasPendingQuestions
    ).toBe(false)
    expect(project({ ...sampleActiveRunObservation, scope: undefined! }).hasPendingQuestions).toBe(
      false
    )
  })
  it('does not satisfy dependencies using another run’s acceptance with the same child id', () => {
    const run = {
      ...sampleActiveCoordinatedRun,
      childMappings: sampleActiveCoordinatedRun.childMappings?.map((mapping) =>
        mapping.childDefinitionId === 'child-writer' ? { ...mapping, dispatchId: null } : mapping
      )
    }
    const accepted = sampleActiveRunObservation.stageAcceptances![0]
    const observation = {
      scope: sampleActiveRunObservation.scope,
      stageAcceptances: [accepted],
      attempts: []
    }
    expect(
      project(observation, run).stages.find((stage) => stage.childDefinitionId === 'child-writer')
        ?.stageExecutionStatus
    ).toBe('ready')
    expect(
      project(
        { ...observation, stageAcceptances: [{ ...accepted, automationRunId: 'older-run' }] },
        run
      ).stages.find((stage) => stage.childDefinitionId === 'child-writer')?.stageExecutionStatus
    ).toBe('queued')
  })
  it('drops mismatched attempt reports, direct crew targets and foreign approvals', () => {
    const observation = structuredClone(sampleActiveRunObservation)
    observation.crewSnapshot = null
    const attempt = observation.attempts![0]
    attempt.structuredResult = { ...attempt.structuredResult!, automationRunId: 'foreign-run' }
    attempt.crewRow = {
      partyKey: attempt.dispatchId,
      role: 'worker',
      label: 'Wrong worker',
      agentKind: 'codex',
      status: 'working',
      openTarget: { kind: 'terminal', handle: 'unbound' }
    }
    attempt.openTarget = { kind: 'terminal', handle: 'unbound' }
    observation.parentApprovals = [
      {
        approvalId: 'gate-editorial-signoff',
        role: 'reviewer',
        status: 'approved',
        scope: { automationRunId: 'foreign-run', orchestrationRunId: 'foreign-orch' }
      }
    ]
    const value = project(observation)
    expect(value.stages[0].artifacts).toEqual([])
    expect(value.stages[0].activeAttempt?.canOpenWorker).toBe(false)
    expect(value.parentApprovals[0].status).toBe('pending')
  })
  it('shows a frozen receipt without stale active questions and ignores a receipt from another authority', () => {
    const completed = project(sampleActiveRunObservation, sampleCompletedVerifiedRun)
    expect(completed.completionReceipt).not.toBeNull()
    expect(completed.hasPendingQuestions).toBe(false)
    expect(
      completed.stages.every((stage) => stage.attempts.every((attempt) => !attempt.canOpenWorker))
    ).toBe(true)
    const run = structuredClone(sampleCompletedVerifiedRun)
    run.completionReceipt!.identityChain.targetExecutionAuthority = 'ssh:other'
    const value = project(sampleActiveRunObservation, run)
    expect(value.completionReceipt).toBeNull()
    expect(value.completionTrust).toBeNull()
    expect(value.targetExecutionAuthority).toBe('local:local-host')
  })
})

describe('host view binding', () => {
  const selection = {
    runtimeId: 'isolated-runtime',
    automationId: sampleCoordinatedArticleAutomation.id,
    automationRunId: sampleCompletedVerifiedRun.id,
    expectedOwner: { selector: { kind: 'self' as const } }
  }
  it.each(['automationId', 'automationRunId'] as const)(
    'rejects an inspection for another %s',
    (field) => {
      const view = coordinatedHostViewFixture()
      view.inspection[field] = 'foreign'
      expect(() => validateCoordinatedRunView(view, selection)).toThrow('different runtime')
    }
  )
  it('binds runtime, revision, request identity and nested receipt mappings', () => {
    const view = coordinatedHostViewFixture()
    expect(() =>
      validateCoordinatedRunView({ ...view, runtimeId: 'new-runtime' }, selection)
    ).toThrow()
    expect(() => validateCoordinatedRunView(view, selection, 99)).toThrow()
    expect(() => validateCoordinatedRunView(view, selection, 2, 'foreign-key')).toThrow()
    if (view.inspection.receipt.kind === 'available') {
      view.inspection.receipt.receipt = {
        ...view.inspection.receipt.receipt,
        identityChain: {
          ...view.inspection.receipt.receipt.identityChain,
          taskMappings: [
            {
              childDefinitionId: 'child-researcher',
              taskId: 'foreign-task',
              dispatchId: 'ctx_res_1'
            }
          ]
        }
      }
    }
    expect(() => validateCoordinatedRunView(view, selection)).toThrow('receipt identity')
  })
})
