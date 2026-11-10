import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import { coordinatedHostViewFixture } from './coordinated-host-run-view-fixture'

const awaitingStage = {
  semanticStatus: 'pending' as const,
  retry: {
    canRetry: false,
    reason: 'This stage has no attempt to retry.',
    retryOfDispatchId: null
  },
  gate: {
    canResolve: false,
    reason: 'No pending gate awaits a decision for this stage.',
    pendingGateId: null
  }
}

/** A run still in flight: host-admitted stop, one retryable stage, one pending gate, one escalation, one live worker terminal. */
export function coordinatedHostActiveViewFixture(runId?: string): CoordinatedRunView {
  const settled = coordinatedHostViewFixture(runId)
  const stages = settled.inspection.stages.map((stage): (typeof settled.inspection.stages)[0] => {
    const pending = {
      ...stage,
      semantic: {
        kind: 'available' as const,
        status: awaitingStage.semanticStatus,
        attempts: 1,
        acceptedDispatchId: null,
        lastError: null,
        lineage: stage.semantic.kind === 'available' ? stage.semantic.lineage : []
      },
      retryEligibility: awaitingStage.retry,
      gateResolutionEligibility: awaitingStage.gate
    }
    if (stage.childDefinitionId === 'child-researcher') {
      return {
        ...pending,
        native: {
          ...stage.native,
          kind: 'available',
          taskStatus: 'in_progress',
          latestDispatchId: 'ctx_res_1',
          latestDispatchStatus: 'dispatched'
        },
        sessionTarget: {
          kind: 'terminal',
          handle: 'term_res_1',
          paneKey: 'pane:research:1',
          dispatchId: 'ctx_res_1',
          taskId: 'task_res_1',
          childDefinitionId: 'child-researcher'
        },
        retryEligibility: {
          canRetry: false,
          reason: 'Attempt ctx_res_1 is still open.',
          retryOfDispatchId: null
        },
        gateResolutionEligibility: awaitingStage.gate
      }
    }
    if (stage.childDefinitionId === 'child-writer') {
      return {
        ...pending,
        semantic: { ...pending.semantic, lastError: 'Worker reported a failed draft check.' },
        retryEligibility: { canRetry: true, reason: null, retryOfDispatchId: 'ctx_writer_2' }
      }
    }
    if (stage.childDefinitionId === 'child-reviewer') {
      return {
        ...pending,
        gateResolutionEligibility: {
          canResolve: true,
          reason: null,
          pendingGateId: 'gate-editorial-signoff'
        }
      }
    }
    return pending
  })
  return {
    ...settled,
    inspection: {
      ...settled.inspection,
      runStatus: 'dispatched',
      stages,
      progress: {
        kind: 'available',
        generation: 1,
        sequence: 5,
        halt: null,
        escalations: [
          {
            key: 'escalation:uncertain-effect',
            code: 'uncertain_effect',
            childDefinitionId: null,
            detail: 'A publish effect has no receipt.',
            requiresHumanDecision: true,
            at: 1762712000000
          }
        ],
        effects: [],
        reportCount: 2
      },
      receipt: { kind: 'absent', reason: 'The run has not settled.' },
      approvals: {
        stage: [
          {
            approvalId: 'gate-editorial-signoff',
            role: 'reviewer',
            status: 'pending',
            scope: {
              automationRunId: settled.inspection.automationRunId,
              orchestrationRunId: settled.inspection.orchestrationRunId,
              childDefinitionId: 'child-reviewer',
              taskId: 'task_rev_3'
            }
          }
        ],
        parent: []
      },
      humanResolution: {
        available: true,
        reason: null,
        pendingDecisionKeys: ['gate-editorial-signoff', 'escalation:uncertain-effect']
      }
    },
    actions: {
      start: { available: true },
      reconcile: { available: true },
      stop: { available: true },
      retry: { available: true, state: 'child-writer' },
      humanResolution: { available: true, state: 'pending_decisions' }
    }
  }
}
