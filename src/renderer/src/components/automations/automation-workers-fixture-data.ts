import type {
  ChildLaunchConfigField,
  CoordinatedAutomationChildDefinition,
  OverrideProvenance,
  ResolvedAutomationRunSnapshot
} from '../../../../shared/coordinated-automation-types'

const DEFAULT_SNAPSHOT_PROVENANCE = Object.fromEntries(
  [
    'agentId',
    'model',
    'reasoningEffort',
    'surface',
    'extraAgentArgs',
    'reuseSession',
    'workspaceMode',
    'workspaceId',
    'baseBranch',
    'setupDecision',
    'timeoutSeconds',
    'maxRetries',
    'maxReviewIterations'
  ].map((k) => [k, 'inherited'])
) as Record<ChildLaunchConfigField, OverrideProvenance>

const DEFAULT_SNAPSHOT_LAUNCH_CONFIG = {
  agentId: 'claude' as const,
  surface: 'terminal' as const,
  extraAgentArgs: '',
  reuseSession: false,
  workspaceMode: 'existing' as const,
  workspaceId: 'ws-historical',
  baseBranch: 'main',
  setupDecision: 'inherit' as const,
  timeoutSeconds: 1800,
  maxRetries: 3,
  maxReviewIterations: 2
}

export const sampleConfiguredWorkers: CoordinatedAutomationChildDefinition[] = [
  {
    id: 'worker-researcher',
    role: 'researcher',
    name: 'Trend Researcher',
    description: 'Scans RSS and GitHub trends to build candidate topic briefs',
    promptSource: {
      kind: 'inline',
      text: 'Scan the latest repository activities and summarize top candidate topics with factual citations.'
    },
    dependencies: [],
    mutationClass: 'read_only',
    mutationLane: 'research',
    enabled: true,
    launchConfig: {
      agentId: 'claude',
      model: 'claude-3-5-sonnet',
      surface: 'terminal',
      provenance: {
        agentId: 'inherited',
        model: 'overridden'
      }
    },
    stageAcceptance: {
      criteria: [
        { id: 'c-1', description: 'Topic brief matches factual citations', required: true },
        { id: 'c-2', description: 'Zero duplicate references', required: true }
      ],
      requiredChecks: [{ id: 'chk-1', description: 'pnpm test:sources', required: true }],
      requiredArtifacts: [
        { kind: 'research-brief', pathPattern: 'research/*.json', required: true }
      ]
    }
  },
  {
    id: 'worker-writer',
    role: 'writer',
    name: 'Article Writer',
    description: 'Drafts publication-ready markdown articles based on researcher output',
    promptSource: {
      kind: 'source_reference',
      path: 'automations/goals/writer/GOAL.md',
      digest: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    },
    dependencies: [{ childId: 'worker-researcher', condition: 'accepted' }],
    mutationClass: 'exclusive_writer',
    mutationLane: 'content',
    enabled: true,
    launchConfig: {
      agentId: 'claude',
      model: 'claude-3-7-sonnet',
      reasoningEffort: 'high',
      surface: 'terminal',
      provenance: {
        agentId: 'inherited',
        model: 'overridden',
        reasoningEffort: 'overridden'
      }
    },
    stageAcceptance: {
      requiredArtifacts: [
        { kind: 'draft-markdown', pathPattern: 'content/drafts/*.md', required: true }
      ]
    }
  },
  {
    id: 'worker-editor',
    role: 'editor',
    name: 'Editorial Gatekeeper',
    description: 'Reviews draft quality, verifies sources, and issues signed completion approval',
    promptSource: {
      kind: 'inline',
      text: 'Review the drafted article for technical accuracy, formatting compliance, and voice consistency.'
    },
    dependencies: [{ childId: 'worker-writer', condition: 'accepted' }],
    mutationClass: 'shared_writer',
    mutationLane: 'content',
    enabled: true,
    launchConfig: {
      agentId: 'claude',
      model: 'claude-3-5-sonnet',
      surface: 'terminal',
      provenance: {
        agentId: 'inherited',
        model: 'inherited'
      }
    },
    stageAcceptance: {
      requiredApprovals: [
        {
          id: 'approval-editor',
          role: 'content-editor',
          disallowAuthorApproval: true,
          description: 'Requires non-author editorial approval'
        }
      ]
    }
  }
]

export const sampleInvalidWorkers: CoordinatedAutomationChildDefinition[] = [
  {
    id: 'worker-a',
    role: 'stage-a',
    name: 'Worker Alpha',
    promptSource: { kind: 'inline', text: 'Step A' },
    dependencies: [{ childId: 'worker-b' }, { childId: 'missing-worker-z' }],
    mutationClass: 'exclusive_writer',
    mutationLane: 'lane-shared',
    enabled: true,
    launchConfig: {}
  },
  {
    id: 'worker-b',
    role: 'stage-b',
    name: 'Worker Beta',
    promptSource: { kind: 'inline', text: 'Step B' },
    dependencies: [{ childId: 'worker-a' }],
    mutationClass: 'exclusive_writer',
    mutationLane: 'lane-shared',
    enabled: true,
    launchConfig: {}
  }
]

export const sampleBlockedWorkers: CoordinatedAutomationChildDefinition[] = [
  {
    id: 'worker-pre',
    role: 'prerequisite',
    name: 'Prerequisite Stage',
    description: 'Temporarily disabled stage',
    promptSource: { kind: 'inline', text: 'Prerequisite instructions' },
    dependencies: [],
    mutationClass: 'read_only',
    enabled: false,
    launchConfig: {}
  },
  {
    id: 'worker-dependent',
    role: 'consumer',
    name: 'Dependent Consumer',
    description: 'Blocked because its prerequisite worker is disabled',
    promptSource: { kind: 'inline', text: 'Consumer instructions' },
    dependencies: [{ childId: 'worker-pre', condition: 'accepted' }],
    mutationClass: 'exclusive_writer',
    enabled: true,
    launchConfig: {}
  }
]

export const sampleHistoricalSnapshot: ResolvedAutomationRunSnapshot = {
  automationId: 'auto-historical-1',
  definitionRevision: 1,
  createdAt: 1731153600000,
  canonicalDigest: 'sha256:7f48a913bc7520e5e01b34a6ef92193b04c102a98f12458129031dcf982a5214',
  executionTarget: {
    type: 'local',
    id: 'local-desktop'
  },
  outcomeContract: {
    humanStatement: 'Deliver validated weekly technical news digest',
    acceptanceCriteria: [
      {
        id: 'crit-artifact',
        description: 'Digest markdown artifact produced',
        required: true,
        kind: 'artifact'
      }
    ],
    requiredApprovals: [
      {
        id: 'app-editor',
        role: 'editor',
        disallowAuthorApproval: true
      }
    ],
    allowedFinalStates: ['completed', 'failed', 'blocked']
  },
  inheritedDefaults: {
    agentId: 'claude',
    model: null,
    reasoningEffort: null,
    surface: 'terminal',
    extraAgentArgs: '',
    reuseSession: false,
    workspaceMode: 'existing',
    workspaceId: 'ws-historical',
    baseBranch: 'main',
    setupDecision: 'inherit',
    timeoutSeconds: 1800,
    maxRetries: 3,
    maxReviewIterations: 2
  },
  globalCeilings: {
    maxConcurrency: 2,
    maxWallClockSeconds: 3600
  },
  publicationPolicy: {
    allowExternalMutation: false,
    requireHumanDecisionForProduction: true,
    allowedFinalStates: ['completed']
  },
  retentionPolicy: {
    preserveCompletionReceipt: true
  },
  resolvedChildren: [
    {
      childDefinitionId: 'worker-researcher',
      role: 'researcher',
      name: 'Trend Researcher',
      prompt: {
        kind: 'inline',
        text: 'Identify notable release notes across configured repositories.',
        digest: 'sha256:a1b2c3d4e5f60102030405060708090a1b2c3d4e5f60102030405060708090a1'
      },
      launchConfig: {
        ...DEFAULT_SNAPSHOT_LAUNCH_CONFIG,
        model: 'claude-3-5-sonnet',
        reasoningEffort: null
      },
      provenance: {
        ...DEFAULT_SNAPSHOT_PROVENANCE,
        model: 'overridden'
      },
      dependencies: [],
      mutationClass: 'read_only',
      mutationLane: 'research',
      enabled: true
    },
    {
      childDefinitionId: 'worker-writer',
      role: 'writer',
      name: 'Article Writer',
      prompt: {
        kind: 'source_reference',
        text: 'Write full markdown article adhering to length and tone guidelines.',
        path: 'automations/goals/writer/GOAL.md',
        digest: 'sha256:b2c3d4e5f6a10102030405060708090a1b2c3d4e5f60102030405060708090a2'
      },
      launchConfig: {
        ...DEFAULT_SNAPSHOT_LAUNCH_CONFIG,
        model: 'claude-3-7-sonnet',
        reasoningEffort: 'high'
      },
      provenance: {
        ...DEFAULT_SNAPSHOT_PROVENANCE,
        model: 'overridden',
        reasoningEffort: 'overridden'
      },
      dependencies: [{ childId: 'worker-researcher', condition: 'accepted' }],
      mutationClass: 'exclusive_writer',
      mutationLane: 'content',
      enabled: true,
      stageAcceptance: {
        requiredArtifacts: [{ kind: 'draft-article', pathPattern: 'articles/*.md', required: true }]
      }
    }
  ]
}
