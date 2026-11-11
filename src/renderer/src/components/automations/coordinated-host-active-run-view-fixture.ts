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
    pendingGateId: null,
    pendingGateIds: [],
    approvableDispatchId: null
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
        activeDispatchId: stage.mappedDispatchId,
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
        retryEligibility: { canRetry: true, reason: null, retryOfDispatchId: 'ctx_writer_2' },
        evidence: {
          kind: 'available',
          dispatchId: 'ctx_writer_2',
          reportDigest: 'sha256:5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
          disposition: 'rejected',
          dispositionReason: 'Required check draft-quality did not pass.',
          outcome: 'succeeded',
          summary: 'Draft written to the staging path.\n<b>Ready to publish</b>',
          artifacts: [
            {
              kind: 'article-draft',
              uri: 'file:///workspace/article-pilot/drafts/draft-4.md',
              sha256: 'sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae'
            },
            { kind: 'outline', uri: 'file:///workspace/article-pilot/outline.md', sha256: null }
          ],
          checks: [
            { id: 'draft-quality', outcome: 'failed', evidence: ['Two sources lack citations'] }
          ],
          blockers: [
            {
              code: 'missing_citations',
              message: 'Two claims have no source.',
              resolvableBy: 'retry'
            }
          ]
        }
      }
    }
    if (stage.childDefinitionId === 'child-reviewer') {
      return {
        ...pending,
        semantic: {
          ...pending.semantic,
          attempts: 0,
          lineage: pending.semantic.lineage.map((attempt) => ({
            ...attempt,
            status: 'active' as const
          }))
        },
        native: {
          kind: 'available',
          taskStatus: 'completed',
          latestDispatchId: 'ctx_rev_1',
          latestDispatchStatus: 'completed'
        },
        gateResolutionEligibility: {
          canResolve: true,
          reason: null,
          pendingGateId: 'gate-editorial-signoff',
          pendingGateIds: ['gate-editorial-signoff'],
          approvableDispatchId: 'ctx_rev_1'
        },
        evidence: { kind: 'absent', reason: 'This report has not been semantically admitted.' },
        pendingApproval: {
          dispatchId: 'ctx_rev_1',
          reportDigest: 'sha256:fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
          gateIds: ['gate-editorial-signoff'],
          since: 1762712000000,
          report: {
            kind: 'available',
            outcome: 'succeeded',
            summary: 'Review complete; awaiting editorial sign-off.',
            artifacts: [{ kind: 'review', uri: 'file:///workspace/review.md', sha256: null }],
            checks: [{ id: 'style-guide', outcome: 'passed' }],
            blockers: []
          }
        }
      }
    }
    return {
      ...pending,
      evidence: {
        kind: 'unavailable',
        reason: 'The native Task result no longer matches the admitted report digest.'
      }
    }
  })
  return {
    ...settled,
    inspection: {
      ...settled.inspection,
      runStatus: 'dispatched',
      activeStageIds: ['child-researcher'],
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
        pendingDecisionKeys: ['gate-editorial-signoff', 'escalation:uncertain-effect'],
        // Why: one id is both a stage and a parent requirement, so scope must travel with it.
        pendingDecisions: [
          { gateId: 'gate-editorial-signoff', scope: 'stage', childDefinitionId: 'child-reviewer' },
          { gateId: 'gate-editorial-signoff', scope: 'parent', childDefinitionId: null },
          { gateId: 'escalation:uncertain-effect', scope: 'escalation', childDefinitionId: null }
        ]
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
