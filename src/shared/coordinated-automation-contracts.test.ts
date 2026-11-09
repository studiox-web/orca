import { describe, expect, it } from 'vitest'
import type { Automation } from './automations-types'
import { isCoordinatedAutomation, isSingleAutomation } from './automations-types'
import {
  CoordinatedAutomationChildDefinitionSchema,
  CoordinatedHostCapabilitiesSchema,
  CoordinatedRunMaterializationRecordSchema,
  StageAcceptanceRecordSchema,
  StructuredWorkerArtifactSchema
} from './coordinated-automation-schemas'
import { CoordinatedRunFieldsSchema } from './coordinated-automation-snapshot-schemas'
import {
  resolveAutomationSnapshot,
  type ResolvePromptFunction
} from './coordinated-automation-snapshot'
import type {
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationDefinition
} from './coordinated-automation-types'
import { AutomationCreate, AutomationUpdateFields } from './rpc-contract/automation-params'
import {
  assertHostSupportsCoordinatedAutomations,
  CoordinatedAutomationCreate
} from './rpc-contract/coordinated-automation-params'
import {
  canDispatchCoordinatedTask,
  isTerminalMaterializationPhase
} from './coordinated-automation-saga-types'
import { validateReceiptAgainstSnapshot } from './coordinated-automation-validation'

const SAMPLE_WRITER_PROMPT_TEXT = 'Resolved goal text for content writer'
const SAMPLE_WRITER_PROMPT_DIGEST =
  'sha256:424971906fe1ce08e0a325a835731e6fc8e128c218420e3febe9276d7915052a'

const samplePromptResolver: ResolvePromptFunction = () => ({
  text: SAMPLE_WRITER_PROMPT_TEXT
})

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

function createSampleCoordinatedAutomation(): Automation & CoordinatedAutomationDefinition {
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
        digest: SAMPLE_WRITER_PROMPT_DIGEST
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
      preserveSnapshot: true,
      preserveMappings: true,
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
      const parsed = JSON.parse(json)
      expect(parsed.id).toBe('auto-single-1')
      expect(parsed.kind).toBeUndefined()
      expect(parsed.children).toBeUndefined()
      expect(parsed.outcomeContract).toBeUndefined()
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

  describe('RPC Fail-Closed Protection for Generic vs Coordinated Methods', () => {
    it('explicitly refuses coordinated writes on generic AutomationCreate RPC', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const rpcPayload = {
        name: coordinated.name,
        prompt: coordinated.prompt,
        agentId: coordinated.agentId,
        rrule: coordinated.rrule,
        dtstart: coordinated.dtstart,
        kind: 'coordinated',
        children: coordinated.children
      }

      const check = AutomationCreate.safeParse(rpcPayload)
      expect(check.success).toBe(false)
      if (!check.success) {
        expect(
          check.error.issues.some((i) =>
            i.message.includes('cannot be created or updated via generic automation RPC')
          )
        ).toBe(true)
      }
    })

    it('explicitly refuses coordinated writes on generic AutomationUpdateFields RPC', () => {
      const updatePayload = {
        kind: 'coordinated',
        definitionRevision: 999
      }
      const check = AutomationUpdateFields.safeParse(updatePayload)
      expect(check.success).toBe(false)
      if (!check.success) {
        expect(
          check.error.issues.some((i) =>
            i.message.includes('cannot be created or updated via generic automation RPC')
          )
        ).toBe(true)
      }
    })

    it('validates coordinated creation parameters via dedicated CoordinatedAutomationCreate schema', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const rpcPayload = {
        name: coordinated.name,
        prompt: coordinated.prompt,
        agentId: coordinated.agentId,
        rrule: coordinated.rrule,
        dtstart: coordinated.dtstart,
        kind: 'coordinated',
        outcomeContract: coordinated.outcomeContract,
        children: coordinated.children,
        inheritedDefaults: coordinated.inheritedDefaults,
        globalCeilings: coordinated.globalCeilings,
        publicationPolicy: coordinated.publicationPolicy,
        retentionPolicy: coordinated.retentionPolicy
      }

      const parsed = CoordinatedAutomationCreate.parse(rpcPayload)
      expect(parsed.kind).toBe('coordinated')
      expect(parsed.children).toHaveLength(3)
    })

    it('forbids client-supplied definitionRevision on creation in CoordinatedAutomationCreate', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const rpcPayload = {
        name: coordinated.name,
        prompt: coordinated.prompt,
        agentId: coordinated.agentId,
        rrule: coordinated.rrule,
        dtstart: coordinated.dtstart,
        kind: 'coordinated',
        definitionRevision: 10,
        outcomeContract: coordinated.outcomeContract,
        children: coordinated.children
      }

      const check = CoordinatedAutomationCreate.safeParse(rpcPayload)
      expect(check.success).toBe(false)
      if (!check.success) {
        expect(
          check.error.issues.some((i) => i.message.includes('managed monotonically by the host'))
        ).toBe(true)
      }
    })

    it('validates host capability check fails closed for old/unsupported hosts', () => {
      expect(() => assertHostSupportsCoordinatedAutomations(null)).toThrow(
        /missing or unconfirmed capability "coordinated_v1"/
      )

      expect(() =>
        assertHostSupportsCoordinatedAutomations({
          contractVersion: 1,
          supportedCapabilities: ['structured_worker_result_v1']
        })
      ).toThrow(/missing or unconfirmed capability "coordinated_v1"/)

      expect(() =>
        assertHostSupportsCoordinatedAutomations({
          contractVersion: 1,
          supportedCapabilities: ['coordinated_v1']
        })
      ).not.toThrow()
    })

    it('verifies generic RPC fail-closed behavior on probes G1-G5', () => {
      const cr = { name: 'n', prompt: 'p', agentId: 'claude', rrule: 'FREQ=DAILY', dtstart: 1 }
      expect(AutomationCreate.safeParse({ ...cr, kind: 'coordinated' }).success).toBe(false)
      expect(AutomationCreate.safeParse({ ...cr, children: [] }).success).toBe(false)
      expect(AutomationUpdateFields.safeParse({ definitionRevision: 9 }).success).toBe(false)
      expect(AutomationUpdateFields.safeParse({ kind: 'single' }).success).toBe(true)
      const g5 = AutomationCreate.safeParse({ ...cr, childMappings: [1] })
      expect(g5.success).toBe(true)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: checking stripped keys
      expect((g5 as { data: Record<string, unknown> }).data.childMappings).toBeUndefined()
    })
  })

  describe('Receipt against Snapshot Validation', () => {
    it('validates a complete, compliant semantic completion receipt against snapshot', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const snapshot = resolveAutomationSnapshot({
        automation: coordinated,
        promptResolver: samplePromptResolver
      })

      const validReceipt = {
        schemaVersion: 1 as const,
        identityChain: {
          automationId: snapshot.automationId,
          definitionRevision: snapshot.definitionRevision,
          automationRunId: 'run-123',
          orchestrationRunId: 'orch-456',
          hostId: 'local'
        },
        frozenConfigDigest: snapshot.canonicalDigest,
        finalState: 'ready_to_publish' as const,
        completedAt: 1700000000000,
        acceptanceResults: [
          {
            criterionId: 'crit-research',
            status: 'satisfied' as const,
            evidence: ['Research packet verified at research/packet.json'],
            evaluatedAt: 1700000000000
          },
          {
            criterionId: 'crit-draft',
            status: 'satisfied' as const,
            evidence: ['Draft article verified at content/drafts/tech.md'],
            evaluatedAt: 1700000000000
          },
          {
            criterionId: 'crit-editorial',
            status: 'satisfied' as const,
            evidence: ['Editorial approval token granted'],
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
        effectReceipts: [],
        unresolvedWarnings: []
      }

      const receiptValidation = validateReceiptAgainstSnapshot(validReceipt, snapshot)
      expect(receiptValidation.valid).toBe(true)
      expect(receiptValidation.errors).toHaveLength(0)
    })

    it('rejects receipt with mismatched config digest or identity chain', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const snapshot = resolveAutomationSnapshot({
        automation: coordinated,
        promptResolver: samplePromptResolver
      })

      const receipt = {
        schemaVersion: 1 as const,
        identityChain: {
          automationId: 'wrong-id',
          definitionRevision: 999,
          automationRunId: 'run-123',
          orchestrationRunId: 'orch-456',
          hostId: 'host-local-1'
        },
        frozenConfigDigest:
          'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        finalState: 'ready_to_publish' as const,
        completedAt: 1700000000000,
        acceptanceResults: [],
        approvals: [],
        effectReceipts: [],
        unresolvedWarnings: []
      }

      const res = validateReceiptAgainstSnapshot(receipt, snapshot)
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.includes('does not match snapshot canonicalDigest'))).toBe(
        true
      )
      expect(res.errors.some((e) => e.includes('does not match snapshot automationId'))).toBe(true)
    })

    it('rejects author self-approval when disallowAuthorApproval is true', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const snapshot = resolveAutomationSnapshot({
        automation: coordinated,
        promptResolver: samplePromptResolver
      })

      const selfApprovalReceipt = {
        schemaVersion: 1 as const,
        identityChain: {
          automationId: snapshot.automationId,
          definitionRevision: snapshot.definitionRevision,
          automationRunId: 'run-123',
          orchestrationRunId: 'orch-456',
          hostId: 'local'
        },
        frozenConfigDigest: snapshot.canonicalDigest,
        finalState: 'ready_to_publish' as const,
        completedAt: 1700000000000,
        acceptanceResults: [
          {
            criterionId: 'crit-research',
            status: 'satisfied' as const,
            evidence: ['ev'],
            evaluatedAt: 1700000000000
          },
          {
            criterionId: 'crit-draft',
            status: 'satisfied' as const,
            evidence: ['ev'],
            evaluatedAt: 1700000000000
          },
          {
            criterionId: 'crit-editorial',
            status: 'satisfied' as const,
            evidence: ['ev'],
            evaluatedAt: 1700000000000
          }
        ],
        approvals: [
          {
            approvalId: 'approval-editor',
            role: 'content-editor',
            approverIdentity: 'term_same_user',
            authorIdentity: 'term_same_user',
            approvedAt: 1700000000000
          }
        ],
        effectReceipts: [],
        unresolvedWarnings: []
      }

      const res = validateReceiptAgainstSnapshot(selfApprovalReceipt, snapshot)
      expect(res.valid).toBe(false)
      expect(
        res.errors.some((e) => e.includes('disallows author approval, but was approved by author'))
      ).toBe(true)
    })

    it('rejects receipt if final state is not permitted by snapshot outcome contract', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const snapshot = resolveAutomationSnapshot({
        automation: coordinated,
        promptResolver: samplePromptResolver
      })

      const receipt = {
        schemaVersion: 1 as const,
        identityChain: {
          automationId: snapshot.automationId,
          definitionRevision: snapshot.definitionRevision,
          automationRunId: 'run-123',
          orchestrationRunId: 'orch-456',
          hostId: 'local'
        },
        frozenConfigDigest: snapshot.canonicalDigest,
        finalState: 'published_verified' as const,
        completedAt: 1700000000000,
        acceptanceResults: [],
        approvals: [],
        effectReceipts: [],
        unresolvedWarnings: []
      }

      const res = validateReceiptAgainstSnapshot(receipt, snapshot)
      expect(res.valid).toBe(false)
      expect(
        res.errors.some((e) => e.includes('is not permitted by snapshot outcomeContract'))
      ).toBe(true)
    })
  })

  describe('Saga Technical Phases, Replan Schema, and Bounds', () => {
    it('verifies dispatch is forbidden before mappings_persisted', () => {
      expect(canDispatchCoordinatedTask('intent_persisted')).toBe(false)
      expect(canDispatchCoordinatedTask('orchestration_run_created')).toBe(false)
      expect(canDispatchCoordinatedTask('tasks_created')).toBe(false)
      expect(canDispatchCoordinatedTask('mappings_persisted')).toBe(false)
      expect(canDispatchCoordinatedTask('ready_for_dispatch')).toBe(true)
      expect(canDispatchCoordinatedTask('orphaned_reconciling')).toBe(false)
      expect(canDispatchCoordinatedTask('compensation_failed')).toBe(false)
      expect(canDispatchCoordinatedTask('materialization_failed')).toBe(false)

      expect(isTerminalMaterializationPhase('compensation_failed')).toBe(true)
      expect(isTerminalMaterializationPhase('materialization_failed')).toBe(true)
      expect(isTerminalMaterializationPhase('ready_for_dispatch')).toBe(false)
    })

    it('validates bounded replan fields via CoordinatedRunFieldsSchema', () => {
      const validRun = {
        automationDefinitionRevision: 2,
        orchestrationRunId: 'orch-2',
        resolvedSnapshot: null,
        completionReceipt: null,
        replanOfAutomationRunId: 'run-1',
        replanOfDefinitionRevision: 1,
        replanReason: 'Previous child failed linting and requested revision',
        materializationPhase: 'ready_for_dispatch' as const,
        childMappings: [{ childDefinitionId: 'child-1', taskId: 't-1' }]
      }
      expect(CoordinatedRunFieldsSchema.parse(validRun).replanReason).toContain('failed linting')

      const invalidReplan = {
        ...validRun,
        replanOfAutomationRunId: 'run-1',
        replanOfDefinitionRevision: null,
        replanReason: null
      }
      expect(CoordinatedRunFieldsSchema.safeParse(invalidReplan).success).toBe(false)
    })

    it('enforces bounds on strings, arrays, artifact URIs, and sha256 digests', () => {
      expect(
        StructuredWorkerArtifactSchema.safeParse({
          kind: 'artifact',
          uri: '../../etc/passwd'
        }).success
      ).toBe(false)

      expect(
        StructuredWorkerArtifactSchema.safeParse({
          kind: 'artifact',
          uri: '/root/private/file'
        }).success
      ).toBe(false)

      expect(
        StructuredWorkerArtifactSchema.safeParse({
          kind: 'artifact',
          uri: 'valid/repo/relative/path.json',
          sha256: 'nope'
        }).success
      ).toBe(false)

      expect(
        StructuredWorkerArtifactSchema.safeParse({
          kind: 'artifact',
          uri: 'valid/repo/relative/path.json',
          sha256: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        }).success
      ).toBe(true)

      expect(
        CoordinatedAutomationChildDefinitionSchema.safeParse({
          id: 'invalid child id with spaces!',
          role: 'role',
          name: 'name',
          promptSource: { kind: 'inline', text: 'prompt' },
          dependencies: [],
          mutationClass: 'read_only',
          launchConfig: {},
          enabled: true
        }).success
      ).toBe(false)
    })

    it('validates separate stage acceptance and cross-store saga materialization records', () => {
      const stageRecord = {
        automationRunId: 'run-1',
        orchestrationRunId: 'orch-run-1',
        definitionRevision: 1,
        resolvedConfigDigest:
          'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        childDefinitionId: 'child-writer',
        taskId: 'task-100',
        dispatchId: 'disp-100',
        status: 'accepted' as const,
        workerReportOutcome: 'succeeded' as const,
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
        phase: 'mappings_persisted' as const,
        childMappings: [{ childDefinitionId: 'child-writer', taskId: 'task-100' }],
        updatedAt: 1700000000000
      }
      const parsedSaga = CoordinatedRunMaterializationRecordSchema.parse(sagaRecord)
      expect(parsedSaga.phase).toBe('mappings_persisted')

      expect(
        CoordinatedHostCapabilitiesSchema.safeParse({
          contractVersion: 1,
          supportedCapabilities: ['coordinated_v1']
        }).success
      ).toBe(true)
    })
  })
})
