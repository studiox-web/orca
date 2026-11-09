import { describe, expect, it } from 'vitest'
import type { Automation } from './automations-types'
import type {
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationDefinition
} from './coordinated-automation-types'
import {
  resolveAutomationSnapshot,
  type ResolvePromptFunction
} from './coordinated-automation-snapshot'

const SAMPLE_WRITER_PROMPT_TEXT = 'Resolved goal text for content writer'
const SAMPLE_WRITER_PROMPT_DIGEST =
  'sha256:424971906fe1ce08e0a325a835731e6fc8e128c218420e3febe9276d7915052a'

const samplePromptResolver: ResolvePromptFunction = () => ({
  text: SAMPLE_WRITER_PROMPT_TEXT
})

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

describe('Coordinated Automation Snapshot Resolution', () => {
  describe('Pre-Snapshot Kind and Gating Validation', () => {
    it('throws when resolving a snapshot for single automation', () => {
      const single: Automation = {
        id: 'auto-single-1',
        name: 'Single Automation',
        prompt: 'Prompt',
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
        rrule: 'FREQ=DAILY;BYHOUR=0;BYMINUTE=0',
        dtstart: 1700000000000,
        enabled: true,
        nextRunAt: 1700003600000,
        missedRunPolicy: 'run_once_within_grace',
        missedRunGraceMinutes: 60,
        createdAt: 1700000000000,
        updatedAt: 1700000000000
      }
      expect(() => resolveAutomationSnapshot({ automation: single })).toThrow(
        /kind must be "coordinated"/
      )
    })

    it('throws when definitionRevision is missing or invalid', () => {
      const coordinated = createSampleCoordinatedAutomation()
      coordinated.definitionRevision = 0
      expect(() =>
        resolveAutomationSnapshot({
          automation: coordinated,
          promptResolver: samplePromptResolver
        })
      ).toThrow(/definitionRevision must be a positive integer/)
    })

    it('throws when executionTarget is not explicitly qualified', () => {
      const coordinated = createSampleCoordinatedAutomation()
      // @ts-expect-error test missing execution target
      delete coordinated.executionTargetId
      expect(() =>
        resolveAutomationSnapshot({
          automation: coordinated,
          promptResolver: samplePromptResolver
        })
      ).toThrow(/executionTargetType and executionTargetId must be explicitly qualified/)
    })
  })

  describe('Prompt Source Resolution & Digest Verification', () => {
    it('throws when resolving a source_reference prompt without a promptResolver', () => {
      const coordinated = createSampleCoordinatedAutomation()
      expect(() => resolveAutomationSnapshot({ automation: coordinated })).toThrow(
        /promptResolver is required/
      )
    })

    it('computes content sha256 and matches against pinned digest', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const snapshot = resolveAutomationSnapshot({
        automation: coordinated,
        promptResolver: samplePromptResolver
      })
      const writer = snapshot.resolvedChildren.find((c) => c.childDefinitionId === 'child-writer')!
      expect(writer.prompt.kind).toBe('source_reference')
      expect(writer.prompt.text).toBe(SAMPLE_WRITER_PROMPT_TEXT)
      expect(writer.prompt.digest).toBe(SAMPLE_WRITER_PROMPT_DIGEST)
    })

    it('fails closed when pinned digest does not match computed resolved content hash', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const badResolver: ResolvePromptFunction = () => ({
        text: 'Tampered or unexpected content'
      })
      expect(() =>
        resolveAutomationSnapshot({
          automation: coordinated,
          promptResolver: badResolver
        })
      ).toThrow(/Pinned prompt digest mismatch/)
    })

    it('rejects invalid digest format on pinned source reference', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const writer = coordinated.children!.find((c) => c.id === 'child-writer')!
      writer.promptSource = {
        kind: 'source_reference',
        path: 'some/path.md',
        digest: 'not-a-valid-hex-digest'
      }
      expect(() =>
        resolveAutomationSnapshot({
          automation: coordinated,
          promptResolver: samplePromptResolver
        })
      ).toThrow(/Invalid pinned prompt digest format/)
    })
  })

  describe('Deterministic snapshot resolution, canonical ordering, and golden vector', () => {
    it('produces the exact same canonical digest across multiple resolutions of the same revision', () => {
      const coordinated = createSampleCoordinatedAutomation()

      const snapshot1 = resolveAutomationSnapshot({
        automation: coordinated,
        promptResolver: samplePromptResolver,
        createdAt: 1000
      })
      const snapshot2 = resolveAutomationSnapshot({
        automation: coordinated,
        promptResolver: samplePromptResolver,
        createdAt: 2000
      })

      expect(snapshot1.canonicalDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(snapshot1.canonicalDigest).toBe(snapshot2.canonicalDigest)
    })

    it('produces identical digest regardless of child array ordering in definition (code-unit sorting)', () => {
      const coord1 = createSampleCoordinatedAutomation()
      const coord2 = createSampleCoordinatedAutomation()

      const [c0, c1, c2] = coord2.children!
      coord2.children = [c2, c0, c1]

      const snap1 = resolveAutomationSnapshot({
        automation: coord1,
        promptResolver: samplePromptResolver
      })
      const snap2 = resolveAutomationSnapshot({
        automation: coord2,
        promptResolver: samplePromptResolver
      })

      expect(snap1.canonicalDigest).toBe(snap2.canonicalDigest)
    })

    it('verifies canonical digest against fixed golden vector', () => {
      const goldenAutomation: Automation & CoordinatedAutomationDefinition = {
        id: 'auto-golden-1',
        kind: 'coordinated',
        definitionRevision: 1,
        name: 'Golden Automation',
        prompt: 'Golden prompt',
        precheck: null,
        agentId: 'claude',
        projectId: 'repo-golden',
        executionTargetType: 'local',
        executionTargetId: 'local-1',
        schedulerOwner: 'local_host_service',
        workspaceMode: 'existing',
        workspaceId: 'ws-golden',
        baseBranch: 'main',
        reuseSession: false,
        timezone: 'UTC',
        rrule: 'FREQ=DAILY;BYHOUR=0;BYMINUTE=0',
        dtstart: 1700000000000,
        enabled: true,
        nextRunAt: 1700003600000,
        missedRunPolicy: 'run_once_within_grace',
        missedRunGraceMinutes: 60,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        outcomeContract: {
          humanStatement: 'Deliver golden vector verification',
          acceptanceCriteria: [
            {
              id: 'crit-1',
              description: 'Criterion 1',
              required: true,
              kind: 'check'
            }
          ],
          requiredApprovals: [],
          allowedFinalStates: ['completed']
        },
        children: [
          {
            id: 'child-1',
            role: 'worker',
            name: 'Worker 1',
            promptSource: {
              kind: 'inline',
              text: 'Do golden work'
            },
            dependencies: [],
            mutationClass: 'read_only',
            launchConfig: {},
            enabled: true
          }
        ]
      }

      const snap = resolveAutomationSnapshot({
        automation: goldenAutomation,
        createdAt: 1700000000000
      })
      expect(snap.canonicalDigest).toBe(
        'sha256:23d3991f077a38e4e47fc68b9e60b30b70422dca2e4ff29b9a1b127066c79b56'
      )
    })
  })

  describe('Inheritance and explicit override provenance', () => {
    it('resolves inherited vs overridden values and maintains provenance records', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const snapshot = resolveAutomationSnapshot({
        automation: coordinated,
        promptResolver: samplePromptResolver
      })

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

    it('does not record provenance as overridden when childValue is undefined', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const child = coordinated.children![0]
      delete child.launchConfig.model
      child.launchConfig.provenance = { model: 'overridden' }

      const snapshot = resolveAutomationSnapshot({
        automation: coordinated,
        promptResolver: samplePromptResolver
      })
      const resolvedResearch = snapshot.resolvedChildren.find(
        (c) => c.childDefinitionId === 'child-research'
      )!
      expect(resolvedResearch.provenance.model).toBe('inherited')
    })

    it('updating a parent default in next revision affects only inheriting children', () => {
      const rev1 = createSampleCoordinatedAutomation()
      const snapRev1 = resolveAutomationSnapshot({
        automation: rev1,
        promptResolver: samplePromptResolver
      })

      const rev2 = createSampleCoordinatedAutomation()
      rev2.definitionRevision = 2
      rev2.inheritedDefaults!.agentId = 'codex'

      const editor = rev2.children!.find((c) => c.id === 'child-editor')!
      editor.launchConfig.agentId = 'claude'
      editor.launchConfig.provenance = {
        ...editor.launchConfig.provenance,
        agentId: 'overridden'
      }

      const snapRev2 = resolveAutomationSnapshot({
        automation: rev2,
        promptResolver: samplePromptResolver
      })

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
      const snapshot = resolveAutomationSnapshot({
        automation: coordinated,
        promptResolver: samplePromptResolver
      })

      const originalResearchPromptText = snapshot.resolvedChildren[0].prompt.text
      const originalDigest = snapshot.canonicalDigest

      coordinated.name = 'Totally Mutated Name'
      coordinated.children![0].name = 'Mutated Child'
      coordinated.children![0].promptSource = { kind: 'inline', text: 'Brand new prompt text' }

      expect(snapshot.resolvedChildren).toHaveLength(3)
      expect(snapshot.resolvedChildren[0].prompt.text).toBe(originalResearchPromptText)
      expect(snapshot.canonicalDigest).toBe(originalDigest)
    })

    it('snapshot object is deeply frozen', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const snapshot = resolveAutomationSnapshot({
        automation: coordinated,
        promptResolver: samplePromptResolver
      })

      expect(Object.isFrozen(snapshot)).toBe(true)
      expect(Object.isFrozen(snapshot.resolvedChildren)).toBe(true)
      expect(Object.isFrozen(snapshot.outcomeContract)).toBe(true)

      expect(() => {
        Object.assign(snapshot, { automationId: 'hacked' })
      }).toThrow()
    })
  })
})
