import { defineFixture } from '../../component-fixtures/component-fixture'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'
import type { AutomationRun, SemanticCompletionReceipt } from '../../../../shared/automations-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { makeRun } from './automations-page-fixtures'
import { AutomationCoordinatedRunPanel } from './AutomationCoordinatedRunPanel'
import {
  sampleActiveCoordinatedRun,
  sampleCoordinatedArticleAutomation,
  sampleCoordinatedFrozenSnapshotRev2
} from './coordinated-automation-run-fixture-data'
import {
  sampleActiveRunObservation,
  sampleBlockedUncertainObservation
} from './coordinated-automation-run-fixture-scenarios'

export const sampleCompletionReceipt: SemanticCompletionReceipt = {
  schemaVersion: 1,
  identityChain: {
    automationId: 'auto-article-coord',
    definitionRevision: 2,
    automationRunId: 'run-coord-verified-202',
    orchestrationRunId: 'orch_run_verified_202',
    hostId: 'local-host',
    targetExecutionAuthority: 'local:local-host',
    activeAttempt: { taskId: 'task_coord_root', dispatchId: 'ctx_coord_root_1' },
    taskMappings: sampleActiveCoordinatedRun.childMappings ?? []
  },
  frozenConfigDigest: sampleCoordinatedFrozenSnapshotRev2.canonicalDigest,
  finalState: 'ready_to_publish',
  completedAt: 1_762_712_000_000,
  selectedOutcomeItemIdentity: 'article:2026-w45-agentic-workflows',
  acceptanceResults: [
    {
      criterionId: 'crit-brief',
      status: 'satisfied',
      evidence: ['artifacts/brief.json (sha256:a1b2c3d4)'],
      evaluatedAt: 1_762_711_500_000
    },
    {
      criterionId: 'crit-quality',
      status: 'satisfied',
      evidence: ['rubric-pass score 94/100'],
      evaluatedAt: 1_762_711_800_000
    }
  ],
  approvals: [
    {
      approvalId: 'gate-editorial-signoff',
      role: 'reviewer',
      approverIdentity: 'user:djvibe',
      authorIdentity: 'worker:child-writer',
      approvedAt: 1_762_711_900_000,
      evidence: 'Editorial review approved for staging'
    }
  ],
  effectReceipts: [
    {
      kind: 'publish_staging',
      namespace: 'cms',
      status: 'verified',
      receipt: 'cms_draft_id:99412',
      verifiedAt: 1_762_711_950_000
    }
  ],
  unresolvedWarnings: []
}

export const sampleCompletedVerifiedRun: AutomationRun = {
  ...sampleActiveCoordinatedRun,
  id: 'run-coord-verified-202',
  orchestrationRunId: 'orch_run_verified_202',
  status: 'completed',
  replanOfAutomationRunId: 'run-coord-active-101',
  replanOfDefinitionRevision: 2,
  replanReason: 'Reconciled staging CMS draft and verified completion',
  completionReceipt: sampleCompletionReceipt,
  completionTrust: {
    authorIdentity: 'coordinator:term_coord_root',
    activeAttempt: { taskId: 'task_coord_root', dispatchId: 'ctx_coord_root_1' },
    productionDecision: {
      approverIdentity: 'user:djvibe',
      role: 'reviewer',
      decidedAt: 1_762_711_900_000
    }
  },
  retainedEvidence: {
    definitionRevision: 2,
    canonicalDigest: sampleCoordinatedFrozenSnapshotRev2.canonicalDigest,
    executionAuthority: 'local:local-host',
    children: [
      { childDefinitionId: 'child-researcher', name: 'Topic Researcher', role: 'researcher' },
      { childDefinitionId: 'child-writer', name: 'Article Writer', role: 'writer' },
      {
        childDefinitionId: 'child-reviewer',
        name: 'Editorial Quality Reviewer',
        role: 'reviewer'
      },
      { childDefinitionId: 'child-publisher', name: 'CMS Staging Publisher', role: 'publisher' }
    ],
    minimumEvidenceReferences: ['artifacts/brief.json', 'posts/draft.md']
  }
}

export const sampleRemoteFolderHistoricalRun: AutomationRun = {
  ...makeRun({
    id: 'run-coord-remote-folder-303',
    automationId: 'auto-article-coord',
    status: 'completed',
    workspaceId: 'folder:/srv/editorial/weekly-digest',
    workspaceDisplayName: '/srv/editorial/weekly-digest'
  }),
  automationDefinitionRevision: 2,
  orchestrationRunId: 'orch_run_remote_303',
  materializationPhase: 'ready_for_dispatch',
  resolvedSnapshot: {
    ...sampleCoordinatedFrozenSnapshotRev2,
    executionTarget: { type: 'ssh', id: 'prod-editorial' }
  },
  completionReceipt: null,
  childMappings: sampleActiveCoordinatedRun.childMappings
}

const storeState = {
  settings: createGlobalSettingsFixture({
    experimentalCoordinatedAutomations: true
  })
}

export const active_run = defineFixture({
  width: 920,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-6">
        <AutomationCoordinatedRunPanel
          automation={sampleCoordinatedArticleAutomation}
          run={sampleActiveCoordinatedRun}
          observation={sampleActiveRunObservation}
          hostLabel="Local Orca Host"
          workspaceLabel="djvibe/article-pilot"
        />
      </div>
    </TooltipProvider>
  )
})

export const active_run_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-3">
        <AutomationCoordinatedRunPanel
          automation={sampleCoordinatedArticleAutomation}
          run={sampleActiveCoordinatedRun}
          observation={sampleActiveRunObservation}
          hostLabel="Local Orca Host"
          workspaceLabel="djvibe/article-pilot"
        />
      </div>
    </TooltipProvider>
  )
})

export const active_run_graph = defineFixture({
  width: 920,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-6">
        <AutomationCoordinatedRunPanel
          automation={sampleCoordinatedArticleAutomation}
          run={sampleActiveCoordinatedRun}
          observation={sampleActiveRunObservation}
          defaultViewMode="graph"
          hostLabel="Local Orca Host"
          workspaceLabel="djvibe/article-pilot"
        />
      </div>
    </TooltipProvider>
  )
})

export const active_run_graph_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-3">
        <AutomationCoordinatedRunPanel
          automation={sampleCoordinatedArticleAutomation}
          run={sampleActiveCoordinatedRun}
          observation={sampleActiveRunObservation}
          defaultViewMode="graph"
          hostLabel="Local Orca Host"
          workspaceLabel="djvibe/article-pilot"
        />
      </div>
    </TooltipProvider>
  )
})

export const blocked_uncertain = defineFixture({
  width: 920,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-6">
        <AutomationCoordinatedRunPanel
          automation={sampleCoordinatedArticleAutomation}
          run={sampleActiveCoordinatedRun}
          observation={sampleBlockedUncertainObservation}
          hostLabel="Local Orca Host"
          workspaceLabel="djvibe/article-pilot"
        />
      </div>
    </TooltipProvider>
  )
})

export const blocked_uncertain_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-3">
        <AutomationCoordinatedRunPanel
          automation={sampleCoordinatedArticleAutomation}
          run={sampleActiveCoordinatedRun}
          observation={sampleBlockedUncertainObservation}
          hostLabel="Local Orca Host"
          workspaceLabel="djvibe/article-pilot"
        />
      </div>
    </TooltipProvider>
  )
})

export const completed_receipt = defineFixture({
  width: 920,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-6">
        <AutomationCoordinatedRunPanel
          automation={sampleCoordinatedArticleAutomation}
          run={sampleCompletedVerifiedRun}
          observation={sampleActiveRunObservation}
          defaultViewMode="receipt"
          hostLabel="Local Orca Host"
          workspaceLabel="djvibe/article-pilot"
        />
      </div>
    </TooltipProvider>
  )
})

export const completed_receipt_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-3">
        <AutomationCoordinatedRunPanel
          automation={sampleCoordinatedArticleAutomation}
          run={sampleCompletedVerifiedRun}
          observation={sampleActiveRunObservation}
          defaultViewMode="receipt"
          hostLabel="Local Orca Host"
          workspaceLabel="djvibe/article-pilot"
        />
      </div>
    </TooltipProvider>
  )
})

export const remote_folder_snapshot = defineFixture({
  width: 920,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-6">
        <AutomationCoordinatedRunPanel
          automation={sampleCoordinatedArticleAutomation}
          run={sampleRemoteFolderHistoricalRun}
          hostLabel="SSH: prod-editorial"
          workspaceLabel="/srv/editorial/weekly-digest"
          isFolderWorkspace
        />
      </div>
    </TooltipProvider>
  )
})

export const remote_folder_snapshot_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-3">
        <AutomationCoordinatedRunPanel
          automation={sampleCoordinatedArticleAutomation}
          run={sampleRemoteFolderHistoricalRun}
          hostLabel="SSH: prod-editorial"
          workspaceLabel="/srv/editorial/weekly-digest"
          isFolderWorkspace
        />
      </div>
    </TooltipProvider>
  )
})
