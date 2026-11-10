import type {
  Automation,
  AutomationRun,
  ChildLaunchConfigField,
  OverrideProvenance,
  ResolvedAutomationRunSnapshot,
  ResolvedChildSnapshot
} from '../../../../shared/automations-types'
import type { OrchestrationCrewRow } from '../../../../shared/orchestration-crew'
import { makeAutomation, makeRun } from './automations-page-fixtures'

export function makeCrewRowFixture(
  id: string,
  title: string,
  openTarget: OrchestrationCrewRow['openTarget']
): OrchestrationCrewRow {
  return {
    partyKey: id,
    role: 'worker',
    label: title,
    agentKind: 'claude',
    status: 'working',
    openTarget,
    latest: {
      preview: `Working on ${title}`,
      at: '2026-11-09T18:10:00.000Z',
      direction: 'from',
      sequence: 1
    }
  }
}

const DEFAULT_PROVENANCE: Record<ChildLaunchConfigField, OverrideProvenance> = {
  agentId: 'inherited',
  model: 'inherited',
  reasoningEffort: 'inherited',
  surface: 'inherited',
  extraAgentArgs: 'inherited',
  reuseSession: 'inherited',
  workspaceMode: 'inherited',
  workspaceId: 'inherited',
  baseBranch: 'inherited',
  setupDecision: 'inherited',
  timeoutSeconds: 'inherited',
  maxRetries: 'inherited',
  maxReviewIterations: 'inherited'
}

const DEFAULT_LAUNCH = {
  agentId: 'claude' as const,
  model: 'claude-sonnet-4-5',
  reasoningEffort: 'high',
  surface: 'chat' as const,
  extraAgentArgs: '',
  reuseSession: false,
  workspaceMode: 'existing' as const,
  workspaceId: 'ws-article',
  baseBranch: 'main',
  setupDecision: 'inherit' as const,
  timeoutSeconds: 600,
  maxRetries: 2,
  maxReviewIterations: 3
}

function makeResolvedChild(
  input: Pick<ResolvedChildSnapshot, 'childDefinitionId' | 'role' | 'name' | 'prompt'> &
    Partial<ResolvedChildSnapshot>
): ResolvedChildSnapshot {
  return {
    childDefinitionId: input.childDefinitionId,
    role: input.role,
    name: input.name,
    prompt: input.prompt,
    launchConfig: { ...DEFAULT_LAUNCH, ...input.launchConfig },
    provenance: { ...DEFAULT_PROVENANCE, ...input.provenance },
    dependencies: input.dependencies ?? [],
    mutationClass: input.mutationClass ?? 'read_only',
    mutationLane: input.mutationLane,
    stageAcceptance: input.stageAcceptance,
    enabled: input.enabled ?? true
  }
}

export const sampleCoordinatedFrozenSnapshotRev2: ResolvedAutomationRunSnapshot = {
  automationId: 'auto-article-coord',
  definitionRevision: 2,
  createdAt: 1_762_710_000_000,
  outcomeContract: {
    humanStatement: 'Research, draft, review, and stage weekly deep-dive article',
    acceptanceCriteria: [
      {
        id: 'crit-brief',
        description: 'Research brief with 3+ primary sources',
        required: true,
        kind: 'artifact',
        targetChildId: 'child-researcher'
      },
      {
        id: 'crit-quality',
        description: 'Editorial quality check passed',
        required: true,
        kind: 'check',
        targetChildId: 'child-reviewer'
      }
    ],
    requiredApprovals: [
      {
        id: 'gate-editorial-signoff',
        role: 'reviewer',
        description: 'Non-author reviewer signoff before staging',
        disallowAuthorApproval: true,
        targetChildId: 'child-reviewer'
      }
    ],
    allowedFinalStates: ['ready_to_publish', 'completed', 'blocked', 'outcome_uncertain']
  },
  resolvedChildren: [
    makeResolvedChild({
      childDefinitionId: 'child-researcher',
      role: 'researcher',
      name: 'Topic Researcher',
      prompt: {
        kind: 'inline',
        text: 'Gather primary engineering sources and produce research-brief.json.',
        digest: 'sha256:1111aaaa2222bbbb3333cccc'
      },
      stageAcceptance: {
        requiredArtifacts: [{ kind: 'research_brief', pathPattern: 'artifacts/brief.json' }],
        requiredChecks: [{ id: 'source-count', required: true }]
      }
    }),
    makeResolvedChild({
      childDefinitionId: 'child-writer',
      role: 'writer',
      name: 'Article Writer',
      prompt: {
        kind: 'source_reference',
        text: 'Draft the article following the research brief and styleguide.',
        path: 'prompts/article-writer.md',
        digest: 'sha256:4444dddd5555eeee6666ffff'
      },
      launchConfig: {
        ...DEFAULT_LAUNCH,
        agentId: 'codex',
        model: 'gpt-5',
        surface: 'terminal',
        timeoutSeconds: 900
      },
      dependencies: [{ childId: 'child-researcher', condition: 'accepted' }],
      mutationClass: 'exclusive_writer',
      mutationLane: 'article-draft',
      stageAcceptance: {
        requiredArtifacts: [{ kind: 'article_draft', pathPattern: 'posts/draft.md' }]
      }
    }),
    makeResolvedChild({
      childDefinitionId: 'child-reviewer',
      role: 'reviewer',
      name: 'Editorial Quality Reviewer',
      prompt: {
        kind: 'inline',
        text: 'Verify factual accuracy, links, and tone against editorial rubric.',
        digest: 'sha256:7777aaaa8888bbbb9999cccc'
      },
      dependencies: [{ childId: 'child-writer', condition: 'completed' }],
      stageAcceptance: {
        requiredChecks: [{ id: 'rubric-pass', required: true }],
        requiredApprovals: [
          {
            id: 'gate-editorial-signoff',
            role: 'reviewer',
            disallowAuthorApproval: true,
            required: true
          }
        ]
      }
    }),
    makeResolvedChild({
      childDefinitionId: 'child-publisher',
      role: 'publisher',
      name: 'CMS Staging Publisher',
      prompt: {
        kind: 'inline',
        text: 'Upload verified draft to CMS staging environment.',
        digest: 'sha256:9999dddd0000eeee1111ffff'
      },
      dependencies: [{ childId: 'child-reviewer', condition: 'accepted' }],
      mutationClass: 'exclusive_writer',
      mutationLane: 'cms-staging'
    })
  ],
  executionTarget: { type: 'local', id: 'local-host' },
  inheritedDefaults: DEFAULT_LAUNCH,
  globalCeilings: {
    maxConcurrency: 2,
    maxActiveFixersPerArtifact: 1,
    maxReviewIterations: 3,
    maxWallClockSeconds: 1800,
    maxEstimatedCostUsd: 5,
    maxDispatchStartFailures: 3
  },
  publicationPolicy: {
    allowExternalMutation: true,
    allowedFinalStates: ['ready_to_publish', 'completed'],
    requireHumanDecisionForProduction: true
  },
  retentionPolicy: {
    preserveCompletionReceipt: true,
    preserveSnapshot: true,
    preserveMappings: true,
    minimumEvidenceReferences: ['artifacts/brief.json', 'posts/draft.md']
  },
  canonicalDigest: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
}

export const sampleCoordinatedArticleAutomation: Automation = makeAutomation({
  id: 'auto-article-coord',
  name: 'DJVibe Article Coordinator',
  kind: 'coordinated',
  definitionRevision: 3,
  outcomeContract: sampleCoordinatedFrozenSnapshotRev2.outcomeContract,
  globalCeilings: sampleCoordinatedFrozenSnapshotRev2.globalCeilings,
  children: [
    {
      id: 'child-researcher',
      role: 'researcher',
      name: 'News & Signal Scout',
      promptSource: { kind: 'inline', text: 'Gather sources' },
      dependencies: [],
      mutationClass: 'read_only',
      launchConfig: { agentId: 'claude', model: 'claude-sonnet-4-5', surface: 'chat' },
      enabled: true
    },
    {
      id: 'child-writer',
      role: 'writer',
      name: 'Article Writer',
      promptSource: { kind: 'source_reference', path: 'prompts/article-writer.md' },
      dependencies: [{ childId: 'child-researcher', condition: 'accepted' }],
      mutationClass: 'exclusive_writer',
      mutationLane: 'article-draft',
      launchConfig: { agentId: 'codex', model: 'gpt-5', surface: 'terminal' },
      enabled: true
    },
    {
      id: 'child-reviewer',
      role: 'reviewer',
      name: 'Editorial Quality Reviewer',
      promptSource: { kind: 'inline', text: 'Review draft' },
      dependencies: [{ childId: 'child-writer', condition: 'completed' }],
      mutationClass: 'read_only',
      launchConfig: { agentId: 'claude', model: 'claude-opus-4-1', surface: 'chat' },
      enabled: true
    }
  ],
  childTombstones: [
    {
      childDefinitionId: 'child-publisher',
      name: 'CMS Staging Publisher',
      role: 'publisher',
      lastDefinitionRevision: 2,
      removedInRevision: 3,
      removedAt: 1_762_715_000_000
    }
  ]
})

export const sampleActiveCoordinatedRun: AutomationRun = {
  ...makeRun({
    id: 'run-coord-active-101',
    automationId: 'auto-article-coord',
    status: 'dispatched',
    workspaceId: 'ws-article',
    workspaceDisplayName: 'djvibe/article-pilot'
  }),
  automationDefinitionRevision: 2,
  orchestrationRunId: 'orch_run_live_101',
  materializationPhase: 'ready_for_dispatch',
  resolvedSnapshot: sampleCoordinatedFrozenSnapshotRev2,
  completionReceipt: null,
  childMappings: [
    { childDefinitionId: 'child-researcher', taskId: 'task_res_1', dispatchId: 'ctx_res_1' },
    { childDefinitionId: 'child-writer', taskId: 'task_writer_2', dispatchId: 'ctx_writer_2' },
    { childDefinitionId: 'child-reviewer', taskId: 'task_rev_3', dispatchId: 'ctx_rev_1' },
    { childDefinitionId: 'child-publisher', taskId: 'task_pub_4', dispatchId: null }
  ]
}
