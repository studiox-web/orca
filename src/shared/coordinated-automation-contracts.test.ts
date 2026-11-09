import { describe, expect, it } from 'vitest'
import type { Automation } from './automations-types'
import { isCoordinatedAutomation, isSingleAutomation } from './automations-types'
import {
  AutomationOutcomeContractSchema,
  CoordinatedAutomationDefinitionSchema,
  CoordinatedHostCapabilitiesSchema,
  CoordinatedRunMaterializationRecordSchema,
  SemanticCompletionReceiptSchema,
  StageAcceptanceRecordSchema,
  StructuredWorkerResultSchema
} from './coordinated-automation-schemas'
import { resolveAutomationSnapshot } from './coordinated-automation-snapshot'
import type { CoordinatedAutomationChildDefinition } from './coordinated-automation-types'
import { AutomationCreate, AutomationUpdateFields } from './rpc-contract/automation-params'

function createSampleSingleAutomation(): Automation {
  return {
    id: 'auto-single-1',
    name: 'Daily Summary',
    prompt: 'Summarize today git commits',
    precheck: null,
    agentId: 'claude',
    projectId: 'repo-1',
    executionTargetType: 'local',
    executionTargetId: 'local',
    schedulerOwner: 'local_host_service',
    workspaceMode: 'existing',
    workspaceId: 'ws-1',
    baseBranch: 'main',
    reuseSession: false,
    timezone: 'UTC',
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    dtstart: 1700000000000,
    enabled: true,
    nextRunAt: 1700003600000,
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: 60,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  }
}

function createSampleCoordinatedAutomation(): Automation {
  const children: CoordinatedAutomationChildDefinition[] = [
    {
      id: 'child-research',
      role: 'content-researcher',
      name: 'Trend Researcher',
      promptSource: {
        kind: 'inline',
        text: 'Research latest trends and produce candidate briefs.'
      },
      dependencies: [],
      mutationClass: 'read_only',
      mutationLane: 'research',
      launchConfig: {
        agentId: 'claude',
        model: 'claude-3-5-sonnet',
        surface: 'terminal',
        provenance: {
          agentId: 'inherited',
          model: 'overridden',
          surface: 'inherited'
        }
      },
      stageAcceptance: {
        requiredArtifacts: [
          { kind: 'research-packet', pathPattern: 'research/*.json', required: true }
        ]
      },
      enabled: true
    },
    {
      id: 'child-writer',
      role: 'content-writer',
      name: 'Article Writer',
      promptSource: {
        kind: 'source_reference',
        path: 'automations/goals/content-writer/GOAL.md',
        digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      },
      dependencies: [{ childId: 'child-research', condition: 'accepted' }],
      mutationClass: 'exclusive_writer',
      mutationLane: 'content',
      launchConfig: {
        model: 'claude-3-7-sonnet',
        provenance: {
          model: 'overridden'
        }
      },
      stageAcceptance: {
        requiredArtifacts: [{ kind: 'draft', pathPattern: 'content/drafts/*.md', required: true }]
      },
      enabled: true
    },
    {
      id: 'child-editor',
      role: 'content-editor',
      name: 'Editorial Gate',
      promptSource: {
        kind: 'inline',
        text: 'Review draft for factual accuracy, style, and completeness.'
      },
      dependencies: [{ childId: 'child-writer', condition: 'accepted' }],
      mutationClass: 'exclusive_writer',
      mutationLane: 'content',
      launchConfig: {
        surface: 'terminal',
        timeoutSeconds: 600,
        provenance: {
          surface: 'inherited',
          timeoutSeconds: 'overridden'
        }
      },
      stageAcceptance: {
        requiredApprovals: [
          { id: 'editor-approval', role: 'content-editor', disallowAuthorApproval: true }
        ]
      },
      enabled: true
    }
  ]

  return {
    id: 'auto-coord-1',
    kind: 'coordinated',
    definitionRevision: 1,
    name: 'DJVibe Editorial Pipeline',
    prompt: 'Coordinator orchestration policy for article generation',
    precheck: null,
    agentId: 'claude',
    projectId: 'djvibe-repo',
    executionTargetType: 'local',
    executionTargetId: 'local',
    schedulerOwner: 'local_host_service',
    workspaceMode: 'existing',
    workspaceId: 'ws-djvibe',
    baseBranch: 'main',
    reuseSession: false,
    timezone: 'America/Denver',
    rrule: 'FREQ=DAILY;BYHOUR=6;BYMINUTE=0',
    dtstart: 1700000000000,
    enabled: true,
    nextRunAt: 1700003600000,
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: 120,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    outcomeContract: {
      humanStatement: 'Produce an editor-approved, source-audited article ready for local staging.',
      acceptanceCriteria: [
        {
          id: 'crit-research',
          description: 'Research packet generated',
          required: true,
          targetChildId: 'child-research',
          kind: 'artifact'
        },
        {
          id: 'crit-draft',
          description: 'Article draft complete',
          required: true,
          targetChildId: 'child-writer',
          kind: 'artifact'
        },
        {
          id: 'crit-editorial',
          description: 'Editorial gate approved',
          required: true,
          targetChildId: 'child-editor',
          kind: 'approval'
        }
      ],
      requiredApprovals: [
        {
          id: 'approval-editor',
          role: 'content-editor',
          disallowAuthorApproval: true,
          targetChildId: 'child-editor'
        }
      ],
      allowedFinalStates: ['ready_to_publish', 'failed', 'blocked']
    },
    children,
    inheritedDefaults: {
      agentId: 'claude',
      model: 'claude-3-5-sonnet',
      surface: 'terminal',
      timeoutSeconds: 1800,
      maxRetries: 2,
      maxReviewIterations: 2
    },
    globalCeilings: {
      maxConcurrency: 3,
      maxActiveFixersPerArtifact: 1,
      maxReviewIterations: 2,
      maxWallClockSeconds: 3600,
      maxDispatchStartFailures: 3
    },
    publicationPolicy: {
      allowExternalMutation: false,
      allowedFinalStates: ['ready_to_publish'],
      requireHumanDecisionForProduction: true
    },
    retentionPolicy: {
      preserveCompletionReceipt: true,
      artifactRetentionDays: 30
    }
  }
}

describe('Coordinated Automation Shared Contracts', () => {
  describe('Preserving existing single Automation JSON/API behavior', () => {
    it('parses and serializes an existing single Automation unchanged', () => {
      const single = createSampleSingleAutomation()
      expect(isSingleAutomation(single)).toBe(true)
      expect(isCoordinatedAutomation(single)).toBe(false)

      const json = JSON.stringify(single)
      const parsed: Automation = JSON.parse(json)

      expect(parsed.id).toBe('auto-single-1')
      expect(parsed.name).toBe('Daily Summary')
      expect(parsed.kind).toBeUndefined()
      expect(isSingleAutomation(parsed)).toBe(true)
      expect(isCoordinatedAutomation(parsed)).toBe(false)
    })

    it('passes existing single Automation inputs through RPC AutomationCreate and AutomationUpdateFields', () => {
      const single = createSampleSingleAutomation()
      const createInput = {
        name: single.name,
        prompt: single.prompt,
        agentId: single.agentId,
        rrule: single.rrule,
        dtstart: single.dtstart
      }

      const parsedCreate = AutomationCreate.parse(createInput)
      expect(parsedCreate.name).toBe('Daily Summary')
      expect(parsedCreate.kind).toBeUndefined()
      expect(parsedCreate.children).toBeUndefined()

      const updateInput = {
        name: 'Updated Name',
        prompt: 'Updated Prompt'
      }
      const parsedUpdate = AutomationUpdateFields.parse(updateInput)
      expect(parsedUpdate.name).toBe('Updated Name')
      expect(parsedUpdate.prompt).toBe('Updated Prompt')
    })
  })

  describe('Coordinated Automation round-trip without losing IDs or provenance', () => {
    it('serializes and deserializes a coordinated automation preserving all fields', () => {
      const coordinated = createSampleCoordinatedAutomation()
      expect(isCoordinatedAutomation(coordinated)).toBe(true)
      expect(isSingleAutomation(coordinated)).toBe(false)

      const json = JSON.stringify(coordinated)
      const restored: Automation = JSON.parse(json)

      expect(restored.kind).toBe('coordinated')
      expect(restored.definitionRevision).toBe(1)
      expect(restored.children).toHaveLength(3)

      const researchChild = restored.children?.find((c) => c.id === 'child-research')
      expect(researchChild).toBeDefined()
      expect(researchChild?.launchConfig.provenance?.model).toBe('overridden')
      expect(researchChild?.launchConfig.provenance?.agentId).toBe('inherited')

      const writerChild = restored.children?.find((c) => c.id === 'child-writer')
      expect(writerChild).toBeDefined()
      expect(writerChild?.promptSource.kind).toBe('source_reference')
      expect(writerChild?.dependencies[0]).toEqual({
        childId: 'child-research',
        condition: 'accepted'
      })

      const zodParsed = CoordinatedAutomationDefinitionSchema.parse({
        kind: 'coordinated',
        definitionRevision: restored.definitionRevision!,
        outcomeContract: restored.outcomeContract!,
        children: restored.children!,
        inheritedDefaults: restored.inheritedDefaults,
        globalCeilings: restored.globalCeilings,
        publicationPolicy: restored.publicationPolicy,
        retentionPolicy: restored.retentionPolicy
      })
      expect(zodParsed.kind).toBe('coordinated')
      expect(zodParsed.children).toHaveLength(3)
    })

    it('validates coordinated creation parameters via RPC AutomationCreate schema', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const rpcPayload = {
        name: coordinated.name,
        prompt: coordinated.prompt,
        agentId: coordinated.agentId,
        rrule: coordinated.rrule,
        dtstart: coordinated.dtstart,
        kind: 'coordinated',
        definitionRevision: coordinated.definitionRevision,
        outcomeContract: coordinated.outcomeContract,
        children: coordinated.children,
        inheritedDefaults: coordinated.inheritedDefaults,
        globalCeilings: coordinated.globalCeilings,
        publicationPolicy: coordinated.publicationPolicy,
        retentionPolicy: coordinated.retentionPolicy
      }

      const parsed = AutomationCreate.parse(rpcPayload)
      expect(parsed.kind).toBe('coordinated')
      expect(parsed.definitionRevision).toBe(1)
      expect(parsed.children).toHaveLength(3)
    })
  })

  describe('Child IDs surviving rename and reorder', () => {
    it('preserves stable child IDs when name and role are changed', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const writerChild = coordinated.children![1]
      expect(writerChild.id).toBe('child-writer')

      writerChild.name = 'Senior Investigative Journalist'
      writerChild.role = 'lead-writer'

      expect(writerChild.id).toBe('child-writer')
      expect(writerChild.name).toBe('Senior Investigative Journalist')
      expect(writerChild.role).toBe('lead-writer')
    })

    it('preserves child identities and dependency integrity when child array is reordered', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const originalChildren = coordinated.children!
      const reordered = [originalChildren[2], originalChildren[0], originalChildren[1]]
      coordinated.children = reordered

      expect(coordinated.children.map((c) => c.id)).toEqual([
        'child-editor',
        'child-research',
        'child-writer'
      ])
    })
  })

  describe('Deterministic snapshot resolution and canonical digest', () => {
    it('produces the exact same canonical digest across multiple resolutions of the same revision', () => {
      const coordinated = createSampleCoordinatedAutomation()

      const snapshot1 = resolveAutomationSnapshot({ automation: coordinated, createdAt: 1000 })
      const snapshot2 = resolveAutomationSnapshot({ automation: coordinated, createdAt: 2000 })

      expect(snapshot1.canonicalDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(snapshot1.canonicalDigest).toBe(snapshot2.canonicalDigest)
    })

    it('produces identical digest regardless of child array ordering in definition', () => {
      const coord1 = createSampleCoordinatedAutomation()
      const coord2 = createSampleCoordinatedAutomation()

      const [c0, c1, c2] = coord2.children!
      coord2.children = [c2, c0, c1]

      const snap1 = resolveAutomationSnapshot({ automation: coord1 })
      const snap2 = resolveAutomationSnapshot({ automation: coord2 })

      expect(snap1.canonicalDigest).toBe(snap2.canonicalDigest)
    })
  })

  describe('Inheritance and explicit override provenance', () => {
    it('resolves inherited vs overridden values and maintains provenance records', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const snapshot = resolveAutomationSnapshot({ automation: coordinated })

      const research = snapshot.resolvedChildren.find(
        (c) => c.childDefinitionId === 'child-research'
      )!
      expect(research.provenance.agentId).toBe('inherited')
      expect(research.launchConfig.agentId).toBe('claude')
      expect(research.provenance.model).toBe('overridden')
      expect(research.launchConfig.model).toBe('claude-3-5-sonnet')

      const editor = snapshot.resolvedChildren.find((c) => c.childDefinitionId === 'child-editor')!
      expect(editor.provenance.timeoutSeconds).toBe('overridden')
      expect(editor.launchConfig.timeoutSeconds).toBe(600)
      expect(editor.provenance.agentId).toBe('inherited')
      expect(editor.launchConfig.agentId).toBe('claude')
    })

    it('preserves explicit null/empty overrides without falling back to parent default', () => {
      const coordinated = createSampleCoordinatedAutomation()
      coordinated.inheritedDefaults = {
        ...coordinated.inheritedDefaults,
        extraAgentArgs: '--verbose',
        baseBranch: 'main'
      }

      const writer = coordinated.children!.find((c) => c.id === 'child-writer')!
      writer.launchConfig.baseBranch = null
      writer.launchConfig.extraAgentArgs = ''
      writer.launchConfig.provenance = {
        baseBranch: 'overridden',
        extraAgentArgs: 'overridden'
      }

      const snapshot = resolveAutomationSnapshot({ automation: coordinated })
      const resolvedWriter = snapshot.resolvedChildren.find(
        (c) => c.childDefinitionId === 'child-writer'
      )!

      expect(resolvedWriter.provenance.baseBranch).toBe('overridden')
      expect(resolvedWriter.launchConfig.baseBranch).toBeNull()
      expect(resolvedWriter.provenance.extraAgentArgs).toBe('overridden')
      expect(resolvedWriter.launchConfig.extraAgentArgs).toBe('')
    })

    it('updating a parent default in next revision affects only inheriting children', () => {
      const rev1 = createSampleCoordinatedAutomation()
      const snapRev1 = resolveAutomationSnapshot({ automation: rev1 })

      const rev2 = createSampleCoordinatedAutomation()
      rev2.definitionRevision = 2
      rev2.inheritedDefaults!.agentId = 'codex'

      const editor = rev2.children!.find((c) => c.id === 'child-editor')!
      editor.launchConfig.agentId = 'claude'
      editor.launchConfig.provenance = {
        ...editor.launchConfig.provenance,
        agentId: 'overridden'
      }

      const snapRev2 = resolveAutomationSnapshot({ automation: rev2 })

      const resResearchRev1 = snapRev1.resolvedChildren.find(
        (c) => c.childDefinitionId === 'child-research'
      )!
      const resResearchRev2 = snapRev2.resolvedChildren.find(
        (c) => c.childDefinitionId === 'child-research'
      )!
      expect(resResearchRev1.launchConfig.agentId).toBe('claude')
      expect(resResearchRev2.launchConfig.agentId).toBe('codex')

      const resEditorRev2 = snapRev2.resolvedChildren.find(
        (c) => c.childDefinitionId === 'child-editor'
      )!
      expect(resEditorRev2.launchConfig.agentId).toBe('claude')
      expect(resEditorRev2.provenance.agentId).toBe('overridden')

      expect(snapRev1.canonicalDigest).not.toBe(snapRev2.canonicalDigest)
    })
  })

  describe('Frozen snapshots (immutability)', () => {
    it('leaves already-created snapshot unchanged when definition objects are mutated', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const snapshot = resolveAutomationSnapshot({ automation: coordinated })

      const originalResearchPromptText = snapshot.resolvedChildren[0].prompt.text
      const originalDigest = snapshot.canonicalDigest

      coordinated.name = 'Totally Mutated Name'
      coordinated.children![0].name = 'Mutated Child'
      coordinated.children![0].promptSource = { kind: 'inline', text: 'Brand new prompt text' }
      coordinated.children!.push({
        id: 'child-unwanted',
        role: 'intruder',
        name: 'Intruder',
        promptSource: { kind: 'inline', text: 'malicious' },
        dependencies: [],
        mutationClass: 'read_only',
        launchConfig: {},
        enabled: true
      })

      expect(snapshot.resolvedChildren).toHaveLength(3)
      expect(snapshot.resolvedChildren[0].prompt.text).toBe(originalResearchPromptText)
      expect(snapshot.canonicalDigest).toBe(originalDigest)
    })

    it('snapshot object is deeply frozen', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const snapshot = resolveAutomationSnapshot({ automation: coordinated })

      expect(Object.isFrozen(snapshot)).toBe(true)
      expect(Object.isFrozen(snapshot.resolvedChildren)).toBe(true)
      expect(Object.isFrozen(snapshot.resolvedChildren[0])).toBe(true)
      expect(Object.isFrozen(snapshot.resolvedChildren[0].launchConfig)).toBe(true)
    })
  })

  describe('Structured worker result and Semantic completion receipt schemas', () => {
    it('validates a correct structured worker result envelope', () => {
      const validResult = {
        schemaVersion: 1,
        automationRunId: 'run-123',
        orchestrationRunId: 'orch-456',
        childDefinitionId: 'child-writer',
        taskId: 'task-789',
        dispatchId: 'disp-abc',
        definitionRevision: 1,
        resolvedConfigDigest:
          'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        outcome: 'succeeded',
        summary: 'Drafted DJVibe article on music tech advancements',
        artifacts: [
          {
            kind: 'draft',
            uri: 'content/drafts/music-tech.md',
            sha256: 'sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
          }
        ],
        checks: [
          {
            id: 'word-count',
            outcome: 'passed',
            evidence: ['1250 words drafted (min 800 required)']
          }
        ],
        effects: [
          {
            kind: 'local-stage',
            status: 'verified',
            receipt: 'row_id:9912'
          }
        ],
        blockers: [],
        reportMarkdown: '# Article Draft Ready\n\nDraft completed successfully.'
      }

      const parsed = StructuredWorkerResultSchema.parse(validResult)
      expect(parsed.schemaVersion).toBe(1)
      expect(parsed.outcome).toBe('succeeded')
      expect(parsed.artifacts).toHaveLength(1)
    })

    it('rejects structured worker result with invalid outcome or missing identities', () => {
      const invalidResult = {
        schemaVersion: 1,
        automationRunId: 'run-123',
        childDefinitionId: 'child-writer',
        taskId: 'task-789',
        dispatchId: 'disp-abc',
        definitionRevision: 1,
        resolvedConfigDigest: 'not-a-sha256',
        outcome: 'invalid_outcome_status',
        summary: 'test',
        artifacts: [],
        checks: [],
        effects: [],
        blockers: [],
        reportMarkdown: ''
      }

      const check = StructuredWorkerResultSchema.safeParse(invalidResult)
      expect(check.success).toBe(false)
    })

    it('validates a complete semantic completion receipt', () => {
      const receipt = {
        schemaVersion: 1,
        identityChain: {
          automationId: 'auto-coord-1',
          definitionRevision: 1,
          automationRunId: 'run-123',
          orchestrationRunId: 'orch-456'
        },
        frozenConfigDigest:
          'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        finalState: 'ready_to_publish',
        completedAt: 1700000000000,
        selectedOutcomeItemIdentity: 'article-tech-advance-2026',
        acceptanceResults: [
          {
            criterionId: 'crit-editorial',
            status: 'satisfied',
            evidence: ['Editor approval granted by @amethyst on draft hash abc'],
            evaluatedAt: 1700000000000
          }
        ],
        approvals: [
          {
            approvalId: 'approval-editor',
            role: 'content-editor',
            approverIdentity: 'term_editor_1',
            authorIdentity: 'term_writer_1',
            approvedAt: 1700000000000,
            evidence: 'approved with zero critical findings'
          }
        ],
        effectReceipts: [
          {
            kind: 'local-stage',
            status: 'verified',
            receipt: 'DJVIBE_LOCAL_STAGE_RESULT:post_id=42',
            verifiedAt: 1700000000000
          }
        ],
        unresolvedWarnings: []
      }

      const parsed = SemanticCompletionReceiptSchema.parse(receipt)
      expect(parsed.schemaVersion).toBe(1)
      expect(parsed.finalState).toBe('ready_to_publish')
      expect(parsed.approvals).toHaveLength(1)
    })

    it('validates outcome contract acceptance criteria and approval targets', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const contractParsed = AutomationOutcomeContractSchema.parse(coordinated.outcomeContract)
      expect(contractParsed.humanStatement).toContain('Produce an editor-approved')
    })

    it('supports authority-qualified source references in prompt and snapshot', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const writer = coordinated.children!.find((c) => c.id === 'child-writer')!
      writer.promptSource = {
        kind: 'source_reference',
        authority: 'local-workspace',
        path: 'automations/goals/content-writer/GOAL.md',
        digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      }

      const snapshot = resolveAutomationSnapshot({ automation: coordinated })
      const resolvedWriter = snapshot.resolvedChildren.find(
        (c) => c.childDefinitionId === 'child-writer'
      )!
      expect(resolvedWriter.prompt.kind).toBe('source_reference')
      expect(resolvedWriter.prompt.path).toBe('automations/goals/content-writer/GOAL.md')
    })

    it('validates fail-closed host capability negotiation', () => {
      const validHostCapabilities = {
        contractVersion: 1,
        supportedCapabilities: [
          'coordinated_v1',
          'structured_worker_result_v1',
          'semantic_completion_receipt_v1',
          'stage_acceptance_v1'
        ]
      }
      expect(CoordinatedHostCapabilitiesSchema.parse(validHostCapabilities).contractVersion).toBe(1)

      const invalidVersion = {
        contractVersion: 2,
        supportedCapabilities: ['coordinated_v1']
      }
      expect(CoordinatedHostCapabilitiesSchema.safeParse(invalidVersion).success).toBe(false)
    })

    it('validates separate stage acceptance and cross-store saga materialization records', () => {
      const stageRecord = {
        childDefinitionId: 'child-writer',
        taskId: 'task-100',
        dispatchId: 'disp-100',
        status: 'accepted',
        workerReportOutcome: 'succeeded',
        evaluatedAt: 1700000000000,
        acceptanceEvidence: ['Draft verified against editorial gate sha256'],
        unmetCriteria: []
      }
      const parsedStage = StageAcceptanceRecordSchema.parse(stageRecord)
      expect(parsedStage.status).toBe('accepted')

      const sagaRecord = {
        automationId: 'auto-coord-1',
        automationRunId: 'run-1',
        definitionRevision: 1,
        idempotencyKey: 'idemp-12345',
        orchestrationRunId: 'orch-run-1',
        phase: 'mappings_persisted',
        childMappings: [{ childDefinitionId: 'child-writer', taskId: 'task-100' }],
        updatedAt: 1700000000000
      }
      const parsedSaga = CoordinatedRunMaterializationRecordSchema.parse(sagaRecord)
      expect(parsedSaga.phase).toBe('mappings_persisted')
    })
  })
})
