import { describe, expect, it } from 'vitest'
import type { Automation } from './automations-types'
import { CoordinatedAutomationChildDefinitionSchema } from './coordinated-automation-schemas'
import type {
  CoordinatedAutomationChildDefinition,
  CoordinatedAutomationDefinition
} from './coordinated-automation-types'
import { validateCoordinatedAutomationDefinition } from './coordinated-automation-validation'

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

describe('Coordinated Automation Validation', () => {
  describe('Graph cycles and missing dependencies', () => {
    it('detects direct dependency cycles', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children!.find((c) => c.id === 'child-research')!
      research.dependencies = [{ childId: 'child-editor' }]

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const cycleError = validation.errors.find((e) => e.code === 'DEPENDENCY_CYCLE')
      expect(cycleError).toBeDefined()
      expect(cycleError?.message).toContain('Circular dependency detected')
    })

    it('detects self dependency cycle', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children!.find((c) => c.id === 'child-research')!
      research.dependencies = [{ childId: 'child-research' }]

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const cycleError = validation.errors.find((e) => e.code === 'DEPENDENCY_CYCLE')
      expect(cycleError).toBeDefined()
    })

    it('detects missing dependencies', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const writer = coordinated.children!.find((c) => c.id === 'child-writer')!
      writer.dependencies = [{ childId: 'ghost-worker-99' }]

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const missingError = validation.errors.find((e) => e.code === 'MISSING_DEPENDENCY')
      expect(missingError).toBeDefined()
      expect(missingError?.message).toContain('unknown child ID "ghost-worker-99"')
    })

    it('detects duplicate child IDs', () => {
      const coordinated = createSampleCoordinatedAutomation()
      coordinated.children![2].id = 'child-writer'

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const dupError = validation.errors.find((e) => e.code === 'DUPLICATE_CHILD_ID')
      expect(dupError).toBeDefined()
      expect(dupError?.message).toContain('Duplicate child definition ID "child-writer"')
    })
  })

  describe('Incompatible settings, ceilings, disabled deps, and forbidden child schedules', () => {
    it('rejects independent child schedules in validation and Zod schema', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const rawChild = { ...coordinated.children[0], rrule: 'FREQ=HOURLY' }
      // @ts-expect-error test forbidden child schedule
      coordinated.children[0] = rawChild

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const schedError = validation.errors.find((e) => e.code === 'FORBIDDEN_CHILD_SCHEDULE')
      expect(schedError).toBeDefined()
      expect(schedError?.message).toContain('cannot have independent schedules')

      const zodCheck = CoordinatedAutomationChildDefinitionSchema.safeParse(rawChild)
      expect(zodCheck.success).toBe(false)
    })

    it('rejects unsupported agentId on child launch configuration', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children![0]
      // @ts-expect-error test invalid agent
      research.launchConfig.agentId = 'nonexistent-agent'

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const agentError = validation.errors.find((e) => e.code === 'INCOMPATIBLE_LAUNCH_SETTINGS')
      expect(agentError).toBeDefined()
      expect(agentError?.message).toContain('unknown or unsupported agent')
    })

    it('rejects child timeout exceeding parent wall-clock ceiling', () => {
      const coordinated = createSampleCoordinatedAutomation()
      coordinated.globalCeilings = { maxWallClockSeconds: 1200 }
      coordinated.children![0].launchConfig.timeoutSeconds = 2400

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const ceilingError = validation.errors.find((e) => e.code === 'LIMIT_EXCEEDS_CEILING')
      expect(ceilingError).toBeDefined()
      expect(ceilingError?.message).toContain('timeout (2400s) exceeds parent ceiling')
    })

    it('rejects child review iterations exceeding parent ceiling', () => {
      const coordinated = createSampleCoordinatedAutomation()
      coordinated.globalCeilings = { maxReviewIterations: 2 }
      coordinated.children![0].launchConfig.maxReviewIterations = 5

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const ceilingError = validation.errors.find((e) => e.code === 'LIMIT_EXCEEDS_CEILING')
      expect(ceilingError).toBeDefined()
      expect(ceilingError?.message).toContain('maxReviewIterations (5) exceeds parent ceiling')
    })

    it('rejects an enabled child depending on a disabled child', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children!.find((c) => c.id === 'child-research')!
      research.enabled = false

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const disabledDepError = validation.errors.find((e) => e.code === 'DISABLED_DEPENDENCY')
      expect(disabledDepError).toBeDefined()
      expect(disabledDepError?.message).toContain('depends on disabled child "child-research"')
    })
  })

  describe('Unsafe writer lanes validation', () => {
    it('flags an error when two exclusive writers share a lane without dependency sequencing', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children!.find((c) => c.id === 'child-research')!
      research.mutationClass = 'exclusive_writer'
      research.mutationLane = 'content'

      const writer = coordinated.children!.find((c) => c.id === 'child-writer')!
      writer.mutationClass = 'exclusive_writer'
      writer.mutationLane = 'content'
      writer.dependencies = []

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const writerLaneError = validation.errors.find((e) => e.code === 'UNSAFE_WRITER_LANE')
      expect(writerLaneError).toBeDefined()
      expect(writerLaneError?.message).toContain(
        'both declare exclusive writes to mutation lane "content"'
      )
    })

    it('passes when two exclusive writers in the same lane have a sequential dependency edge', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(true)
      expect(validation.errors.filter((e) => e.code === 'UNSAFE_WRITER_LANE')).toHaveLength(0)
    })

    it('allows concurrent read-only workers on the same lane', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children!.find((c) => c.id === 'child-research')!
      const writer = coordinated.children!.find((c) => c.id === 'child-writer')!

      research.mutationClass = 'read_only'
      research.mutationLane = 'content'
      writer.mutationClass = 'read_only'
      writer.mutationLane = 'content'
      writer.dependencies = []

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.errors.filter((e) => e.code === 'UNSAFE_WRITER_LANE')).toHaveLength(0)
    })

    it('allows exclusive writers on different mutation lanes without dependency edges', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children!.find((c) => c.id === 'child-research')!
      const writer = coordinated.children!.find((c) => c.id === 'child-writer')!

      research.mutationClass = 'exclusive_writer'
      research.mutationLane = 'media'
      writer.mutationClass = 'exclusive_writer'
      writer.mutationLane = 'content'
      writer.dependencies = []

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.errors.filter((e) => e.code === 'UNSAFE_WRITER_LANE')).toHaveLength(0)
    })

    it('flags an error when exclusive_writer and shared_writer share a lane without dependency sequencing', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children!.find((c) => c.id === 'child-research')!
      const writer = coordinated.children!.find((c) => c.id === 'child-writer')!

      research.mutationClass = 'exclusive_writer'
      research.mutationLane = 'content'
      writer.mutationClass = 'shared_writer'
      writer.mutationLane = 'content'
      writer.dependencies = []

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const laneError = validation.errors.find((e) => e.code === 'UNSAFE_WRITER_LANE')
      expect(laneError).toBeDefined()
      expect(laneError?.message).toContain('unsafe concurrency conflict')
    })

    it('allows concurrent shared_writers on the same lane without dependency edges', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children!.find((c) => c.id === 'child-research')!
      const writer = coordinated.children!.find((c) => c.id === 'child-writer')!
      const editor = coordinated.children!.find((c) => c.id === 'child-editor')!

      research.mutationClass = 'shared_writer'
      research.mutationLane = 'content'
      writer.mutationClass = 'shared_writer'
      writer.mutationLane = 'content'
      writer.dependencies = []
      editor.mutationLane = 'editorial'

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.errors.filter((e) => e.code === 'UNSAFE_WRITER_LANE')).toHaveLength(0)
    })

    it('rejects user-specified mutation lane using internal default sentinel name', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const writer = coordinated.children!.find((c) => c.id === 'child-writer')!
      writer.mutationLane = '@@orca_internal_default_writer_lane@@'

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const sentinelError = validation.errors.find((e) => e.code === 'UNSAFE_WRITER_LANE')
      expect(sentinelError).toBeDefined()
      expect(sentinelError?.message).toContain('reserved internal lane identifier')
    })
  })

  describe('Launch config coherence and unattainable acceptance criteria', () => {
    it('rejects new_per_run workspace mode combined with reuseSession', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children![0]
      research.launchConfig.workspaceMode = 'new_per_run'
      research.launchConfig.reuseSession = true

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const err = validation.errors.find((e) => e.code === 'INCOMPATIBLE_LAUNCH_SETTINGS')
      expect(err).toBeDefined()
      expect(err?.message).toContain('New per-run workspaces cannot reuse sessions')
    })

    it('rejects existing workspace mode combined with baseBranch', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children![0]
      research.launchConfig.workspaceMode = 'existing'
      research.launchConfig.baseBranch = 'feature/branch'

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const err = validation.errors.find((e) => e.code === 'INCOMPATIBLE_LAUNCH_SETTINGS')
      expect(err).toBeDefined()
      expect(err?.message).toContain('baseBranch is only valid for new workspaces')
    })

    it('rejects inherited default timeout exceeding ceiling', () => {
      const coordinated = createSampleCoordinatedAutomation()
      coordinated.globalCeilings = { maxWallClockSeconds: 1000 }
      coordinated.inheritedDefaults = { timeoutSeconds: 1500 }

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const err = validation.errors.find((e) => e.code === 'LIMIT_EXCEEDS_CEILING')
      expect(err).toBeDefined()
      expect(err?.message).toContain('Inherited default timeout (1500s) exceeds parent ceiling')
    })

    it('rejects read_only child declaring requiredEffects in stageAcceptance', () => {
      const coordinated = createSampleCoordinatedAutomation()
      const research = coordinated.children![0]
      research.mutationClass = 'read_only'
      research.stageAcceptance = {
        requiredEffects: [{ kind: 'git-commit', allowedStatuses: ['applied'], required: true }]
      }

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const err = validation.errors.find((e) => e.code === 'UNATTAINABLE_ACCEPTANCE_CRITERIA')
      expect(err).toBeDefined()
      expect(err?.message).toContain('declared as read_only but defines requiredEffects')
    })

    it('rejects published_verified final state when allowExternalMutation is false', () => {
      const coordinated = createSampleCoordinatedAutomation()
      coordinated.publicationPolicy = {
        allowExternalMutation: false,
        allowedFinalStates: ['ready_to_publish'],
        requireHumanDecisionForProduction: true
      }
      coordinated.outcomeContract.allowedFinalStates = ['published_verified']

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const err = validation.errors.find((e) => e.code === 'UNATTAINABLE_ACCEPTANCE_CRITERIA')
      expect(err).toBeDefined()
      expect(err?.message).toContain('allowExternalMutation is false')
    })

    it('rejects publication policy with no overlapping final states with outcome contract', () => {
      const coordinated = createSampleCoordinatedAutomation()
      coordinated.outcomeContract.allowedFinalStates = ['failed']
      coordinated.publicationPolicy = {
        allowExternalMutation: false,
        allowedFinalStates: ['ready_to_publish'],
        requireHumanDecisionForProduction: true
      }

      const validation = validateCoordinatedAutomationDefinition(coordinated)
      expect(validation.valid).toBe(false)
      const err = validation.errors.find((e) => e.code === 'INVALID_OUTCOME_CONTRACT')
      expect(err).toBeDefined()
      expect(err?.message).toContain('has no overlapping states')
    })

    it('reports exactly one error when a forbidden schedule property is provided on child', () => {
      const rawChild = {
        id: 'child-1',
        role: 'worker',
        name: 'Worker',
        promptSource: { kind: 'inline', text: 'prompt' },
        dependencies: [],
        mutationClass: 'read_only',
        launchConfig: {},
        enabled: true,
        schedule: 'hourly'
      }
      const parsed = CoordinatedAutomationChildDefinitionSchema.safeParse(rawChild)
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        const scheduleErrors = parsed.error.issues.filter(
          (i) => i.path[0] === 'schedule' || i.message.includes('independent schedules')
        )
        expect(scheduleErrors).toHaveLength(1)
      }
    })
  })
})
