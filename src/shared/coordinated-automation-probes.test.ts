import { describe, expect, it } from 'vitest'
import type { Automation } from './automations-types'
import {
  CoordinatedAutomationDefinitionSchema,
  StructuredWorkerArtifactSchema
} from './coordinated-automation-schemas'
import { resolveAutomationSnapshot } from './coordinated-automation-snapshot'
import type {
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationDefinition
} from './coordinated-automation-types'
import { validateReceiptAgainstSnapshot } from './coordinated-automation-validation'
import type { ReceiptValidationContext } from './coordinated-automation-receipt-types'
import { AutomationCreate, AutomationUpdateFields } from './rpc-contract/automation-params'
import {
  CoordinatedAutomationCreate,
  CoordinatedAutomationUpdateFields
} from './rpc-contract/coordinated-automation-params'

type CoordinatedTestAutomation = Automation & CoordinatedAutomationDefinition

function createBaseAutomation(): CoordinatedTestAutomation {
  return {
    id: 'a1',
    kind: 'coordinated',
    definitionRevision: 1,
    name: 'Base Pipeline',
    prompt: 'Base pipeline prompt',
    precheck: null,
    agentId: 'claude',
    projectId: 'repo-1',
    executionTargetType: 'local',
    executionTargetId: 'local-1',
    schedulerOwner: 'local_host_service',
    workspaceMode: 'existing',
    workspaceId: 'ws-1',
    baseBranch: 'main',
    reuseSession: false,
    timezone: 'UTC',
    rrule: 'FREQ=DAILY',
    dtstart: 1,
    enabled: true,
    nextRunAt: 2,
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: 60,
    createdAt: 1,
    updatedAt: 1,
    outcomeContract: {
      humanStatement: 'Base outcome human statement',
      acceptanceCriteria: [{ id: 'c1', description: 'Criterion 1', required: true, kind: 'check' }],
      requiredApprovals: [
        { id: 'ap1', role: 'editor', disallowAuthorApproval: true },
        { id: 'ap2', role: 'legal', disallowAuthorApproval: true }
      ],
      allowedFinalStates: ['completed']
    },
    children: [
      {
        id: 'child-1',
        role: 'worker',
        name: 'Worker 1',
        promptSource: { kind: 'inline', text: 'Prompt content' },
        dependencies: [],
        mutationClass: 'read_only',
        launchConfig: {},
        enabled: true
      }
    ]
  }
}

const PROBE_MAPPINGS = [{ childDefinitionId: 'child-1', taskId: 't1', dispatchId: 'd1' }]
const PROBE_ATTEMPT = { taskId: 'tc', dispatchId: 'dc' }

function probeContext(trustedAuthorIdentity: string): ReceiptValidationContext {
  return {
    trustedAuthorIdentity,
    trustedHostId: 'local-1',
    trustedExecutionAuthority: 'local:local-1',
    automationRunId: 'r',
    orchestrationRunId: 'o',
    activeAttempt: { ...PROBE_ATTEMPT },
    trustedTaskMappings: PROBE_MAPPINGS.map((m) => ({ ...m }))
  }
}

describe('Re-review Behavioral Probes R*, S*, A*, G*', () => {
  describe('Receipt Probes R1 - R4', () => {
    it('R1: fails closed when author is omitted with disallowAuthorApproval, same approver is used, and hostId/authority mismatches', () => {
      const auto = createBaseAutomation()
      const snap = resolveAutomationSnapshot({ automation: auto, createdAt: 1 })
      const rcpt = {
        schemaVersion: 1 as const,
        identityChain: {
          automationId: 'a1',
          definitionRevision: 1,
          automationRunId: 'r',
          orchestrationRunId: 'o',
          hostId: 'some-other-host',
          targetExecutionAuthority: 'ssh:evil',
          activeAttempt: { ...PROBE_ATTEMPT },
          taskMappings: PROBE_MAPPINGS.map((m) => ({ ...m }))
        },
        frozenConfigDigest: snap.canonicalDigest,
        finalState: 'completed' as const,
        completedAt: 1,
        acceptanceResults: [
          { criterionId: 'c1', status: 'satisfied' as const, evidence: ['e'], evaluatedAt: 1 }
        ],
        approvals: [
          { approvalId: 'ap1', role: 'editor', approverIdentity: 'alice', approvedAt: 1 },
          { approvalId: 'ap2', role: 'legal', approverIdentity: 'alice', approvedAt: 1 }
        ],
        effectReceipts: [],
        unresolvedWarnings: []
      }

      const res = validateReceiptAgainstSnapshot(rcpt, snap, probeContext('alice'))
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.includes('hostId') && e.includes('does not match'))).toBe(
        true
      )
      expect(
        res.errors.some(
          (e) => e.includes('targetExecutionAuthority') && e.includes('does not match')
        )
      ).toBe(true)
      expect(res.errors.some((e) => e.includes('cannot satisfy multiple required approvals'))).toBe(
        true
      )
      expect(res.errors.some((e) => e.includes('disallows author approval'))).toBe(true)
    })

    it('R2: fails when required criterion is waived without waiver authority and evidence', () => {
      const auto = createBaseAutomation()
      const snap = resolveAutomationSnapshot({ automation: auto, createdAt: 1 })
      const rcpt = {
        schemaVersion: 1 as const,
        identityChain: {
          automationId: 'a1',
          definitionRevision: 1,
          automationRunId: 'r',
          orchestrationRunId: 'o',
          hostId: 'local-1',
          targetExecutionAuthority: 'local:local-1',
          activeAttempt: { ...PROBE_ATTEMPT },
          taskMappings: PROBE_MAPPINGS.map((m) => ({ ...m }))
        },
        frozenConfigDigest: snap.canonicalDigest,
        finalState: 'completed' as const,
        completedAt: 1,
        acceptanceResults: [
          { criterionId: 'c1', status: 'waived' as const, evidence: [], evaluatedAt: 1 }
        ],
        approvals: [
          {
            approvalId: 'ap1',
            role: 'editor',
            approverIdentity: 'alice',
            authorIdentity: 'charlie',
            approvedAt: 1
          },
          {
            approvalId: 'ap2',
            role: 'legal',
            approverIdentity: 'bob',
            authorIdentity: 'charlie',
            approvedAt: 1
          }
        ],
        effectReceipts: [],
        unresolvedWarnings: []
      }

      const res = validateReceiptAgainstSnapshot(rcpt, snap, probeContext('charlie'))
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.includes('requires waiver authority'))).toBe(true)
      expect(res.errors.some((e) => e.includes('must include non-empty evidence references'))).toBe(
        true
      )
    })

    it('R3: fails when duplicate acceptance results are reported for the same criterion', () => {
      const auto = createBaseAutomation()
      const snap = resolveAutomationSnapshot({ automation: auto, createdAt: 1 })
      const rcpt = {
        schemaVersion: 1 as const,
        identityChain: {
          automationId: 'a1',
          definitionRevision: 1,
          automationRunId: 'r',
          orchestrationRunId: 'o',
          hostId: 'local-1',
          targetExecutionAuthority: 'local:local-1',
          activeAttempt: { ...PROBE_ATTEMPT },
          taskMappings: PROBE_MAPPINGS.map((m) => ({ ...m }))
        },
        frozenConfigDigest: snap.canonicalDigest,
        finalState: 'completed' as const,
        completedAt: 1,
        acceptanceResults: [
          { criterionId: 'c1', status: 'failed' as const, evidence: [], evaluatedAt: 1 },
          { criterionId: 'c1', status: 'satisfied' as const, evidence: ['e'], evaluatedAt: 1 }
        ],
        approvals: [
          {
            approvalId: 'ap1',
            role: 'editor',
            approverIdentity: 'alice',
            authorIdentity: 'charlie',
            approvedAt: 1
          },
          {
            approvalId: 'ap2',
            role: 'legal',
            approverIdentity: 'bob',
            authorIdentity: 'charlie',
            approvedAt: 1
          }
        ],
        effectReceipts: [],
        unresolvedWarnings: []
      }

      const res = validateReceiptAgainstSnapshot(rcpt, snap, probeContext('charlie'))
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.includes('Duplicate acceptance result'))).toBe(true)
    })

    it('R4: fails when approval role does not match requirement role', () => {
      const auto = createBaseAutomation()
      const snap = resolveAutomationSnapshot({ automation: auto, createdAt: 1 })
      const rcpt = {
        schemaVersion: 1 as const,
        identityChain: {
          automationId: 'a1',
          definitionRevision: 1,
          automationRunId: 'r',
          orchestrationRunId: 'o',
          hostId: 'local-1',
          targetExecutionAuthority: 'local:local-1',
          activeAttempt: { ...PROBE_ATTEMPT },
          taskMappings: PROBE_MAPPINGS.map((m) => ({ ...m }))
        },
        frozenConfigDigest: snap.canonicalDigest,
        finalState: 'completed' as const,
        completedAt: 1,
        acceptanceResults: [
          { criterionId: 'c1', status: 'satisfied' as const, evidence: ['e'], evaluatedAt: 1 }
        ],
        approvals: [
          {
            approvalId: 'ap1',
            role: 'intern',
            approverIdentity: 'bob',
            authorIdentity: 'charlie',
            approvedAt: 1
          },
          {
            approvalId: 'ap2',
            role: 'intern',
            approverIdentity: 'carol',
            authorIdentity: 'charlie',
            approvedAt: 1
          }
        ],
        effectReceipts: [],
        unresolvedWarnings: []
      }

      const res = validateReceiptAgainstSnapshot(rcpt, snap, probeContext('charlie'))
      expect(res.valid).toBe(false)
      expect(
        res.errors.some((e) =>
          e.includes('expects role "editor", but was approved with role "intern"')
        )
      ).toBe(true)
    })
  })

  describe('Snapshot Probes S1 - S6', () => {
    it('S1: rejects unattainable contract when publicationPolicy is omitted and contract states do not intersect with default', () => {
      const b2 = createBaseAutomation()
      b2.outcomeContract.allowedFinalStates = ['ready_for_review']
      expect(() => resolveAutomationSnapshot({ automation: b2 })).toThrow(
        /has no overlapping states with default publication allowed states/
      )
    })

    it('S2 & S2b: schema-invalid child is rejected by CoordinatedAutomationDefinitionSchema and fails snapshot resolution', () => {
      const b3 = createBaseAutomation()
      b3.children[0].id = '../bad id'
      b3.children[0].promptSource = { kind: 'inline', text: '' }
      b3.children[0].launchConfig = { timeoutSeconds: -5, agentId: 'claude' }

      expect(CoordinatedAutomationDefinitionSchema.safeParse(b3).success).toBe(false)
      expect(() => resolveAutomationSnapshot({ automation: b3 })).toThrow(
        /definition schema validation failed/
      )
    })

    it('S3: throws when promptResolver-supplied digest disagrees with resolved text', () => {
      const b4 = createBaseAutomation()
      b4.children[0].promptSource = { kind: 'source_reference', path: 'g.md' }

      expect(() =>
        resolveAutomationSnapshot({
          automation: b4,
          promptResolver: () => ({ text: 'abc', digest: `sha256:${'0'.repeat(64)}` })
        })
      ).toThrow(/Resolver-supplied digest .* does not match computed digest/)
    })

    it('S4 & S5: deep clones arrays and contract objects so caller objects remain unfrozen', () => {
      const b5 = createBaseAutomation()
      b5.publicationPolicy = {
        allowExternalMutation: false,
        allowedFinalStates: ['completed'],
        requireHumanDecisionForProduction: true
      }
      b5.retentionPolicy = {
        preserveCompletionReceipt: true,
        minimumEvidenceReferences: ['ref-1']
      }

      const snap = resolveAutomationSnapshot({ automation: b5 })
      expect(snap.canonicalDigest).toBeDefined()
      // Caller's objects must NOT be frozen
      expect(Object.isFrozen(b5.publicationPolicy.allowedFinalStates)).toBe(false)
      expect(Object.isFrozen(b5.retentionPolicy.minimumEvidenceReferences)).toBe(false)
      expect(Object.isFrozen(b5.outcomeContract)).toBe(false)

      // Snapshot's objects MUST be frozen
      expect(Object.isFrozen(snap.publicationPolicy.allowedFinalStates)).toBe(true)
      expect(Object.isFrozen(snap.outcomeContract)).toBe(true)
    })

    it('S6: rejects published_verified when child mutations are read_only and no effect criterion exists', () => {
      const b6 = createBaseAutomation()
      b6.publicationPolicy = {
        allowExternalMutation: true,
        allowedFinalStates: ['published_verified'],
        requireHumanDecisionForProduction: false
      }
      b6.outcomeContract.allowedFinalStates = ['published_verified']

      expect(() => resolveAutomationSnapshot({ automation: b6 })).toThrow(
        /Final state "published_verified" requires at least one active writer child/
      )
    })
  })

  describe('Artifact URI Probes A1 & A2', () => {
    it('A1: rejects file:///etc/passwd absolute file URI', () => {
      expect(
        StructuredWorkerArtifactSchema.safeParse({ kind: 'k', uri: 'file:///etc/passwd' }).success
      ).toBe(false)
    })

    it('A2: permits benign double dots in artifact file names such as notes..v2.md', () => {
      expect(
        StructuredWorkerArtifactSchema.safeParse({ kind: 'k', uri: 'notes..v2.md' }).success
      ).toBe(true)
    })
  })

  describe('Generic RPC Probes G1 - G5 & Strict Coordinated RPC', () => {
    it('G1 - G5: verifies generic RPC fail-closed behavior', () => {
      const cr = { name: 'n', prompt: 'p', agentId: 'claude', rrule: 'FREQ=DAILY', dtstart: 1 }
      expect(AutomationCreate.safeParse({ ...cr, kind: 'coordinated' }).success).toBe(false)
      expect(AutomationCreate.safeParse({ ...cr, children: [] }).success).toBe(false)
      expect(AutomationUpdateFields.safeParse({ definitionRevision: 9 }).success).toBe(false)
      expect(AutomationUpdateFields.safeParse({ kind: 'single' }).success).toBe(true)
      const g5 = AutomationCreate.safeParse({ ...cr, childMappings: [1] })
      expect(g5.success).toBe(true)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: checking stripped key
      expect((g5 as { data: Record<string, unknown> }).data.childMappings).toBeUndefined()
    })

    it('enforces strict and bounded schemas on CoordinatedAutomationCreate', () => {
      const auto = createBaseAutomation()
      const validPayload = {
        name: auto.name,
        prompt: auto.prompt,
        agentId: auto.agentId,
        rrule: auto.rrule,
        dtstart: auto.dtstart,
        kind: 'coordinated',
        outcomeContract: auto.outcomeContract,
        children: auto.children
      }

      expect(CoordinatedAutomationCreate.safeParse(validPayload).success).toBe(true)

      // Strict rejection of unknown keys
      expect(
        CoordinatedAutomationCreate.safeParse({ ...validPayload, unknownExtra: 'bad' }).success
      ).toBe(false)

      // Strict rejection of cycle in children
      const cyclicChildren: CoordinatedAutomationChildDefinition[] = [
        {
          id: 'c1',
          role: 'r',
          name: 'C1',
          promptSource: { kind: 'inline', text: 'p' },
          dependencies: [{ childId: 'c2', condition: 'accepted' }],
          mutationClass: 'read_only',
          launchConfig: {},
          enabled: true
        },
        {
          id: 'c2',
          role: 'r',
          name: 'C2',
          promptSource: { kind: 'inline', text: 'p' },
          dependencies: [{ childId: 'c1', condition: 'accepted' }],
          mutationClass: 'read_only',
          launchConfig: {},
          enabled: true
        }
      ]
      expect(
        CoordinatedAutomationCreate.safeParse({
          ...validPayload,
          children: cyclicChildren
        }).success
      ).toBe(false)
    })

    it('enforces strict and bounded schemas on CoordinatedAutomationUpdateFields', () => {
      expect(CoordinatedAutomationUpdateFields.safeParse({ name: 'Updated Name' }).success).toBe(
        true
      )
      expect(
        CoordinatedAutomationUpdateFields.safeParse({ unknownField: 'not-allowed' }).success
      ).toBe(false)
    })
  })
})
