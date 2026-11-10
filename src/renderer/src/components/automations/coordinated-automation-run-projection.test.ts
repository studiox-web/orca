import { describe, expect, it, vi } from 'vitest'
import {
  sampleCompletedVerifiedRun,
  sampleRemoteFolderHistoricalRun
} from './AutomationCoordinatedRunPanel.fixture'
import {
  sampleActiveCoordinatedRun,
  sampleCoordinatedArticleAutomation
} from './coordinated-automation-run-fixture-data'
import {
  sampleActiveRunObservation,
  sampleBlockedUncertainObservation
} from './coordinated-automation-run-fixture-scenarios'
import { projectCoordinatedAutomationRun } from './coordinated-automation-run-projection'

describe('projectCoordinatedAutomationRun', () => {
  it('separates technical status, semantic acceptance, parent outcome, lifecycle, and schedule', () => {
    const projected = projectCoordinatedAutomationRun({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleActiveCoordinatedRun,
      observation: sampleActiveRunObservation
    })

    expect(projected.technicalRunStatus).toBe('dispatched')
    expect(projected.materializationPhase).toBe('ready_for_dispatch')
    expect(projected.semanticOutcomeState).toBe('waiting_for_approval')
    expect(projected.lifecycleState).toBe('enabled')
    expect(projected.definitionRevision).toBe(2)
    expect(projected.currentAutomationRevision).toBe(3)

    const researcher = projected.stages.find((s) => s.childDefinitionId === 'child-researcher')
    const writer = projected.stages.find((s) => s.childDefinitionId === 'child-writer')
    const reviewer = projected.stages.find((s) => s.childDefinitionId === 'child-reviewer')
    const publisher = projected.stages.find((s) => s.childDefinitionId === 'child-publisher')

    expect(researcher?.stageExecutionStatus).toBe('accepted')
    expect(researcher?.semanticAcceptanceStatus).toBe('accepted')

    expect(writer?.stageExecutionStatus).toBe('active')
    expect(writer?.attempts).toHaveLength(2)
    expect(writer?.supersededAttemptsCount).toBe(1)
    expect(writer?.activeAttempt?.dispatchId).toBe('ctx_writer_2')
    expect(writer?.activeAttempt?.retryOfDispatchId).toBe('ctx_writer_1')
    expect(writer?.pendingQuestion?.preview).toContain('latency percentile chart')

    // Technical completion without semantic acceptance stays distinct
    expect(reviewer?.activeAttempt?.technicalStatus).toBe('completed')
    expect(reviewer?.semanticAcceptanceStatus).toBe('evaluating')
    expect(reviewer?.stageExecutionStatus).toBe('waiting_for_approval')

    expect(publisher?.stageExecutionStatus).toBe('queued')
  })

  it('tracks child definition rename and tombstone drift against frozen run snapshot', () => {
    const projected = projectCoordinatedAutomationRun({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleActiveCoordinatedRun,
      observation: sampleActiveRunObservation
    })

    const researcher = projected.stages.find((s) => s.childDefinitionId === 'child-researcher')
    const writer = projected.stages.find((s) => s.childDefinitionId === 'child-writer')
    const publisher = projected.stages.find((s) => s.childDefinitionId === 'child-publisher')

    expect(researcher?.name).toBe('Topic Researcher')
    expect(researcher?.definitionDrift).toBe('renamed')
    expect(researcher?.currentDefinitionName).toBe('News & Signal Scout')

    expect(writer?.definitionDrift).toBe('unchanged')

    expect(publisher?.name).toBe('CMS Staging Publisher')
    expect(publisher?.definitionDrift).toBe('tombstoned')
    expect(publisher?.tombstonedInRevision).toBe(3)
  })

  it('treats technical completion without SemanticCompletionReceipt as unaccepted, never completed', () => {
    const projected = projectCoordinatedAutomationRun({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleRemoteFolderHistoricalRun
    })

    expect(projected.technicalRunStatus).toBe('completed')
    expect(projected.completionReceipt).toBeNull()
    expect(projected.semanticOutcomeState).toBe('unaccepted')
    expect(projected.semanticOutcomeReason).toContain(
      'no verified semantic completion receipt is persisted'
    )
    expect(projected.isRemoteAuthority).toBe(true)
    expect(projected.targetExecutionAuthority).toBe('ssh:prod-editorial')
    expect(projected.isFolderWorkspace).toBe(true)
  })

  it('projects verified SemanticCompletionReceipt and replan lineage', () => {
    const projected = projectCoordinatedAutomationRun({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleCompletedVerifiedRun,
      observation: sampleActiveRunObservation
    })

    expect(projected.semanticOutcomeState).toBe('ready_to_publish')
    expect(projected.selectedOutcomeItemIdentity).toBe('article:2026-w45-agentic-workflows')
    expect(projected.replanOfAutomationRunId).toBe('run-coord-active-101')
    expect(projected.completionTrust?.authorIdentity).toBe('coordinator:term_coord_root')
  })

  it('fails closed when run is quarantined and disables all operator controls', () => {
    const quarantinedRun = {
      ...sampleActiveCoordinatedRun,
      coordinatedQuarantine: {
        reason: 'Receipt taskMappings mismatch persisted childMappings',
        payloadDigest: 'sha256:badbeef',
        payloadRetained: true
      }
    }

    const projected = projectCoordinatedAutomationRun({
      automation: sampleCoordinatedArticleAutomation,
      run: quarantinedRun,
      observation: sampleActiveRunObservation,
      operatorActions: {
        stopRun: { availability: { supported: true, reason: null }, onStopRun: vi.fn() },
        retryStage: { availability: { supported: true, reason: null }, onRetryStage: vi.fn() },
        resolveGate: { availability: { supported: true, reason: null }, onResolveGate: vi.fn() }
      }
    })

    expect(projected.semanticOutcomeState).toBe('quarantined')
    expect(projected.stopEligibility.canStop).toBe(false)
    expect(projected.stopEligibility.reason).toContain('quarantined')
    for (const stage of projected.stages) {
      expect(stage.retryEligibility.canRetry).toBe(false)
      expect(stage.gateResolutionEligibility.canResolve).toBe(false)
    }
  })

  it('blocks stage retry when an uncertain external effect is present even if host retry is bound', () => {
    const projected = projectCoordinatedAutomationRun({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleActiveCoordinatedRun,
      observation: sampleBlockedUncertainObservation,
      operatorActions: {
        retryStage: { availability: { supported: true, reason: null }, onRetryStage: vi.fn() }
      }
    })

    expect(projected.semanticOutcomeState).toBe('outcome_uncertain')
    expect(projected.hasUncertainEffects).toBe(true)
    expect(projected.budgetsAndCeilings.wallClockExceeded).toBe(true)
    expect(projected.budgetsAndCeilings.reviewLimitReached).toBe(true)
    expect(projected.budgetsAndCeilings.circuitBreakerTripped).toBe(true)

    const publisher = projected.stages.find((s) => s.childDefinitionId === 'child-publisher')
    expect(publisher?.stageExecutionStatus).toBe('uncertain')
    expect(publisher?.hasUncertainEffect).toBe(true)
    expect(publisher?.retryEligibility.canRetry).toBe(false)
    expect(publisher?.retryEligibility.reason).toContain('uncertain')
  })

  it('disables all run controls when experimentalCoordinatedAutomations flag is off', () => {
    const projected = projectCoordinatedAutomationRun({
      automation: sampleCoordinatedArticleAutomation,
      run: sampleActiveCoordinatedRun,
      observation: sampleActiveRunObservation,
      operatorActions: {
        stopRun: { availability: { supported: true, reason: null }, onStopRun: vi.fn() }
      },
      options: { isFeatureFlagEnabled: false }
    })

    expect(projected.stopEligibility.canStop).toBe(false)
    expect(projected.stopEligibility.reason).toContain('feature flag is disabled')
  })
})
