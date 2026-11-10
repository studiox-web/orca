import {
  makeCrewRowFixture,
  sampleCoordinatedFrozenSnapshotRev2
} from './coordinated-automation-run-fixture-data'
import type { CoordinatedRunLiveObservation } from './coordinated-automation-run-projection'

export const sampleActiveRunObservation: CoordinatedRunLiveObservation = {
  scope: {
    automationId: 'auto-article-coord',
    automationRunId: 'run-coord-active-101',
    orchestrationRunId: 'orch_run_live_101',
    definitionRevision: 2,
    executionAuthority: 'local:local-host',
    canonicalDigest: sampleCoordinatedFrozenSnapshotRev2.canonicalDigest
  },

  elapsedWallClockSeconds: 420,
  activeFixersCount: 1,
  dispatchStartFailuresCount: 0,
  occupiedMutationLanes: [
    {
      lane: 'article-draft',
      mutationClass: 'exclusive_writer',
      holderTaskId: 'task_writer_2',
      holderChildId: 'child-writer',
      holderChildName: 'Article Writer',
      waitingTaskIds: []
    }
  ],
  attempts: [
    {
      dispatchId: 'ctx_res_1',
      taskId: 'task_res_1',
      childDefinitionId: 'child-researcher',
      attemptNumber: 1,
      technicalStatus: 'completed',
      workerReportOutcome: 'succeeded',
      durationSeconds: 110,
      estimatedCostUsd: 0.34,
      totalTokens: 18400,
      crewRow: makeCrewRowFixture('crew_res_1', 'Topic Researcher', {
        kind: 'chat',
        sessionId: 'chat_session_res_1',
        worktreeId: 'wt-article-pilot'
      }),
      structuredResult: {
        schemaVersion: 1,
        automationRunId: 'run-coord-active-101',
        orchestrationRunId: 'orch_run_live_101',
        childDefinitionId: 'child-researcher',
        taskId: 'task_res_1',
        dispatchId: 'ctx_res_1',
        definitionRevision: 2,
        resolvedConfigDigest: sampleCoordinatedFrozenSnapshotRev2.canonicalDigest,
        outcome: 'succeeded',
        summary: 'Collected 4 primary engineering benchmarks and verified citations.',
        artifacts: [
          {
            kind: 'research_brief',
            uri: 'artifacts/brief.json',
            sha256: 'sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
            retentionClass: 'run'
          }
        ],
        checks: [{ id: 'source-count', outcome: 'passed', evidence: ['4 primary sources'] }],
        effects: [],
        blockers: [],
        reportMarkdown: 'Research brief completed.'
      }
    },
    {
      dispatchId: 'ctx_writer_1',
      taskId: 'task_writer_2',
      childDefinitionId: 'child-writer',
      attemptNumber: 1,
      technicalStatus: 'superseded',
      workerReportOutcome: 'failed',
      durationSeconds: 140,
      estimatedCostUsd: 0.52,
      reviewIteration: 1,
      crewRow: makeCrewRowFixture('crew_writer_1', 'Article Writer #1', {
        kind: 'terminal',
        handle: 'term_writer_1'
      })
    },
    {
      dispatchId: 'ctx_writer_2',
      taskId: 'task_writer_2',
      childDefinitionId: 'child-writer',
      attemptNumber: 2,
      retryOfDispatchId: 'ctx_writer_1',
      technicalStatus: 'working',
      durationSeconds: 95,
      estimatedCostUsd: 0.41,
      reviewIteration: 2,
      pendingQuestion: {
        preview: 'Should we include the latency percentile chart from section 3 in the lead?',
        at: '2026-11-09T18:12:00.000Z'
      },
      crewRow: makeCrewRowFixture('crew_writer_2', 'Article Writer #2', {
        kind: 'terminal',
        handle: 'term_writer_2'
      })
    },
    {
      dispatchId: 'ctx_rev_1',
      taskId: 'task_rev_3',
      childDefinitionId: 'child-reviewer',
      attemptNumber: 1,
      technicalStatus: 'completed',
      workerReportOutcome: 'succeeded',
      durationSeconds: 75,
      estimatedCostUsd: 0.28,
      reviewIteration: 2,
      crewRow: makeCrewRowFixture('crew_rev_1', 'Editorial Quality Reviewer', {
        kind: 'dispatch',
        address: 'dispatch:task_rev_3:ctx_rev_1'
      }),
      structuredResult: {
        schemaVersion: 1,
        automationRunId: 'run-coord-active-101',
        orchestrationRunId: 'orch_run_live_101',
        childDefinitionId: 'child-reviewer',
        taskId: 'task_rev_3',
        dispatchId: 'ctx_rev_1',
        definitionRevision: 2,
        resolvedConfigDigest: sampleCoordinatedFrozenSnapshotRev2.canonicalDigest,
        outcome: 'succeeded',
        summary: 'All factual claims verified; awaiting human editorial signoff.',
        artifacts: [],
        checks: [{ id: 'rubric-pass', outcome: 'passed', evidence: ['Score 94/100'] }],
        effects: [],
        blockers: [],
        reportMarkdown: 'Ready for editorial signoff.'
      }
    }
  ],
  stageAcceptances: [
    {
      automationRunId: 'run-coord-active-101',
      orchestrationRunId: 'orch_run_live_101',
      definitionRevision: 2,
      resolvedConfigDigest: sampleCoordinatedFrozenSnapshotRev2.canonicalDigest,
      childDefinitionId: 'child-researcher',
      taskId: 'task_res_1',
      dispatchId: 'ctx_res_1',
      status: 'accepted',
      workerReportOutcome: 'succeeded',
      evaluatedAt: 1_762_710_200_000,
      acceptanceEvidence: ['artifacts/brief.json verified', 'source-count passed']
    },
    {
      automationRunId: 'run-coord-active-101',
      orchestrationRunId: 'orch_run_live_101',
      definitionRevision: 2,
      resolvedConfigDigest: sampleCoordinatedFrozenSnapshotRev2.canonicalDigest,
      childDefinitionId: 'child-reviewer',
      taskId: 'task_rev_3',
      dispatchId: 'ctx_rev_1',
      status: 'evaluating',
      workerReportOutcome: 'succeeded',
      evaluatedAt: 1_762_710_400_000,
      acceptanceEvidence: ['rubric-pass passed']
    }
  ],
  stageApprovals: [
    {
      approvalId: 'gate-editorial-signoff',
      role: 'reviewer',
      description: 'Distinct non-author editorial signoff before staging',
      disallowAuthorApproval: true,
      status: 'pending',
      scope: {
        automationRunId: 'run-coord-active-101',
        orchestrationRunId: 'orch_run_live_101',
        childDefinitionId: 'child-reviewer',
        taskId: 'task_rev_3',
        dispatchId: 'ctx_rev_1'
      }
    }
  ]
}

export const sampleBlockedUncertainObservation: CoordinatedRunLiveObservation = {
  scope: sampleActiveRunObservation.scope,
  elapsedWallClockSeconds: 1850,
  activeFixersCount: 0,
  dispatchStartFailuresCount: 3,
  attempts: [
    ...(sampleActiveRunObservation.attempts ?? []),
    {
      dispatchId: 'ctx_pub_1',
      taskId: 'task_pub_4',
      childDefinitionId: 'child-publisher',
      attemptNumber: 1,
      technicalStatus: 'outcome_unknown',
      workerReportOutcome: 'uncertain',
      durationSeconds: 300,
      estimatedCostUsd: 0.45,
      reviewIteration: 3,
      structuredResult: {
        schemaVersion: 1,
        automationRunId: 'run-coord-active-101',
        orchestrationRunId: 'orch_run_live_101',
        childDefinitionId: 'child-publisher',
        taskId: 'task_pub_4',
        dispatchId: 'ctx_pub_1',
        definitionRevision: 2,
        resolvedConfigDigest: sampleCoordinatedFrozenSnapshotRev2.canonicalDigest,
        outcome: 'uncertain',
        summary: 'Staging upload timed out after POST /api/v1/articles; remote effect uncertain.',
        artifacts: [],
        checks: [],
        effects: [
          {
            kind: 'publish_staging',
            namespace: 'cms',
            status: 'uncertain',
            error: 'HTTP 504 gateway timeout after request body transmitted'
          }
        ],
        blockers: [
          {
            code: 'CMS_EFFECT_UNCERTAIN',
            message: 'Verify staging CMS idempotency key before retrying publication.',
            resolvableBy: 'human_action'
          }
        ],
        reportMarkdown: 'Uncertain external effect on CMS staging.'
      }
    }
  ],
  stageAcceptances: sampleActiveRunObservation.stageAcceptances
}

for (const observation of [sampleActiveRunObservation, sampleBlockedUncertainObservation]) {
  observation.crewSnapshot = {
    status: 'ok',
    sections: {
      managedBy: [],
      talkingWith: [],
      managing: (observation.attempts ?? []).flatMap((attempt) =>
        attempt.crewRow
          ? [{ ...attempt.crewRow, sendAddress: `dispatch:${attempt.dispatchId}` }]
          : []
      )
    }
  }
}
