import type { CoordinatedRunView } from '../../../../shared/coordinated-automation-run-view'
import type { AutomationHostCatalogEntry } from './automation-host-catalog-types'
import {
  sampleActiveCoordinatedRun,
  sampleCoordinatedFrozenSnapshotRev2
} from './coordinated-automation-run-fixture-data'
import type { SemanticCompletionReceipt } from '../../../../shared/automations-types'
const sampleCompletedVerifiedRun = {
  ...sampleActiveCoordinatedRun,
  id: 'run-coord-verified-202',
  orchestrationRunId: 'orch_run_verified_202',
  childMappings: sampleActiveCoordinatedRun.childMappings?.map((mapping) => ({
    ...mapping,
    dispatchId: mapping.dispatchId ?? 'ctx_pub_1'
  }))
}
const sampleCompletionReceipt: SemanticCompletionReceipt = {
  schemaVersion: 1,
  identityChain: {
    automationId: sampleCompletedVerifiedRun.automationId,
    automationRunId: sampleCompletedVerifiedRun.id,
    orchestrationRunId: sampleCompletedVerifiedRun.orchestrationRunId,
    definitionRevision: 2,
    hostId: 'local-host',
    targetExecutionAuthority: 'local:local-host',
    activeAttempt: { taskId: 'task-coordinator', dispatchId: 'dispatch-coordinator' },
    taskMappings: sampleCompletedVerifiedRun.childMappings ?? []
  },
  frozenConfigDigest: sampleCoordinatedFrozenSnapshotRev2.canonicalDigest,
  finalState: 'ready_to_publish',
  completedAt: 1762712000000,
  acceptanceResults: sampleCoordinatedFrozenSnapshotRev2.outcomeContract.acceptanceCriteria.map(
    (criterion) => ({
      criterionId: criterion.id,
      status: 'satisfied',
      evidence: ['Isolated fixture evidence'],
      evaluatedAt: 1762712000000
    })
  ),
  approvals: [
    {
      approvalId: 'gate-editorial-signoff',
      role: 'reviewer',
      approverIdentity: 'fixture-reviewer',
      approvedAt: 1762712000000
    }
  ],
  effectReceipts: [],
  unresolvedWarnings: []
}

export const coordinatedHostFixtureEntry: AutomationHostCatalogEntry = {
  stableRef: { authority: { kind: 'desktop' }, selector: { kind: 'self' } },
  owner: { authority: { kind: 'desktop' }, selector: { kind: 'self' } },
  stableKey: 'desktop:self',
  label: 'This computer',
  authorityLabel: 'This computer',
  kind: 'self',
  catalogState: 'authoritative',
  authorityHealth: 'fresh',
  executionHealth: 'connected',
  querySupport: 'scoped'
}

export function coordinatedHostViewFixture(
  runId = sampleCompletedVerifiedRun.id
): CoordinatedRunView {
  return {
    runtimeId: 'isolated-runtime',
    inspection: {
      automationId: sampleCompletedVerifiedRun.automationId,
      automationRunId: runId,
      runStatus: 'completed',
      runError: null,
      definitionRevision: 2,
      canonicalDigest: sampleCompletionReceipt.frozenConfigDigest,
      idempotencyKey: `request:${runId}`,
      materializationPhase: 'ready_for_dispatch',
      orchestrationRunId: sampleCompletedVerifiedRun.orchestrationRunId ?? null,
      stages: (sampleCompletedVerifiedRun.childMappings ?? []).map((mapping) => ({
        childDefinitionId: mapping.childDefinitionId,
        name:
          sampleCoordinatedFrozenSnapshotRev2.resolvedChildren.find(
            (child) => child.childDefinitionId === mapping.childDefinitionId
          )?.name ?? mapping.childDefinitionId,
        role:
          sampleCoordinatedFrozenSnapshotRev2.resolvedChildren.find(
            (child) => child.childDefinitionId === mapping.childDefinitionId
          )?.role ?? 'worker',
        enabled: true,
        taskId: mapping.taskId,
        mappedDispatchId: mapping.dispatchId ?? null,
        native: {
          kind: 'available',
          taskStatus: 'succeeded',
          latestDispatchId: mapping.dispatchId ?? null,
          latestDispatchStatus: 'succeeded'
        },
        semantic: {
          kind: 'available',
          status: 'accepted',
          attempts: 1,
          acceptedDispatchId: mapping.dispatchId ?? null,
          lastError: null,
          lineage: [
            {
              attemptNumber: 1,
              kind: 'initial',
              dispatchId: mapping.dispatchId ?? null,
              retryOfDispatchId: null,
              previousLatestDispatchId: null,
              startedAt: 1,
              deadlineAt: 2,
              leaseKeys: [],
              status: 'admitted'
            }
          ]
        },
        sessionTarget: { kind: 'unavailable', reason: 'Isolated workers have no live session.' }
      })),
      progress: {
        kind: 'available',
        generation: 1,
        sequence: 7,
        halt: null,
        escalations: [],
        effects: [],
        reportCount: 4
      },
      receipt: {
        kind: 'available',
        receipt: {
          ...sampleCompletionReceipt,
          identityChain: { ...sampleCompletionReceipt.identityChain, automationRunId: runId }
        },
        trust: null
      },
      humanResolution: {
        available: false,
        reason: 'No reviewed human resolution operation is available.'
      }
    },
    actions: {
      start: { available: true },
      reconcile: { available: true },
      stop: { available: false, reason: 'No reviewed stop operation is available.' },
      retry: { available: false, reason: 'No reviewed retry operation is available.' },
      humanResolution: {
        available: false,
        reason: 'No reviewed human resolution operation is available.'
      }
    },
    findings: {
      kind: 'unavailable',
      reason: 'Complete finding records are not exposed by the host.'
    },
    limits: { kind: 'unavailable', reason: 'Resolved limit values are not exposed by the host.' }
  }
}
