import type {
  Automation,
  AutomationRun,
  CoordinatedAutomationCreateInput
} from '../../../shared/automations-types'
import type { CoordinatedAutomationChildDefinition } from '../../../shared/coordinated-automation-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { Repo } from '../../../shared/repo-types'
import type { SshTarget } from '../../../shared/ssh-types'
import { getDefaultPersistedState } from '../../../shared/constants'
import type { AutomationDefinitionOperations } from './automation-definition-operations'
import {
  createCoordinatedAutomationRun,
  type CreateCoordinatedAutomationRunInput
} from './coordinated-automation-run-operations'
import type { AutomationStorageAuthority } from './automation-owner-projection'
import type {
  CoordinatedAutomationRunOperations,
  CoordinatedOrchestrationRecordProbe
} from './coordinated-automation-run-records'

export const COORDINATED_REPOS: Repo[] = [
  { id: 'repo-local', path: '/local', displayName: 'Local', badgeColor: '#000', addedAt: 1 },
  {
    id: 'repo-ssh',
    path: '/remote',
    displayName: 'Remote',
    badgeColor: '#000',
    addedAt: 2,
    connectionId: 'ssh-1'
  },
  {
    id: 'repo-folder',
    path: '/notes',
    displayName: 'Notes',
    badgeColor: '#000',
    addedAt: 3,
    kind: 'folder'
  }
]

export const COORDINATED_SSH_TARGETS: SshTarget[] = [
  { id: 'ssh-1', label: 'Box', host: 'box', port: 22, username: 'me', generation: 7 }
]

export function coordinatedTestState(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    ...getDefaultPersistedState('/tmp/coordinated-automation-tests'),
    repos: COORDINATED_REPOS,
    sshTargets: COORDINATED_SSH_TARGETS,
    sshTargetGenerationCounter: 7,
    ...overrides
  }
}

export function child(
  id: string,
  overrides: Partial<CoordinatedAutomationChildDefinition> = {}
): CoordinatedAutomationChildDefinition {
  return {
    id,
    role: `${id}-role`,
    name: `${id} worker`,
    promptSource: { kind: 'inline', text: `Do the ${id} stage.` },
    dependencies: [],
    mutationClass: 'read_only',
    launchConfig: {},
    enabled: true,
    ...overrides
  }
}

export function coordinatedCreateInput(
  overrides: Partial<CoordinatedAutomationCreateInput> = {}
): CoordinatedAutomationCreateInput {
  return {
    kind: 'coordinated',
    name: 'Outcome',
    prompt: 'Coordinate the article pipeline.',
    agentId: 'claude',
    projectId: 'repo-local',
    workspaceMode: 'new_per_run',
    baseBranch: 'main',
    timezone: 'UTC',
    rrule: 'FREQ=DAILY',
    dtstart: 0,
    enabled: false,
    outcomeContract: {
      humanStatement: 'One reviewed article is ready.',
      acceptanceCriteria: [
        { id: 'draft-ready', description: 'Draft accepted', required: true, kind: 'custom' }
      ],
      requiredApprovals: [],
      allowedFinalStates: ['completed', 'failed', 'blocked', 'outcome_uncertain']
    },
    children: [
      child('research'),
      child('writer', {
        dependencies: [{ childId: 'research', condition: 'accepted' }],
        mutationClass: 'exclusive_writer',
        mutationLane: 'content'
      })
    ],
    ...overrides
  }
}

const NO_FAILURE: number | null = null

/** Durable writes copy state to `disk`; `failAt` makes the Nth write throw like a lost commit. */
export function durableHarness(
  initial: PersistedState,
  storageAuthority: AutomationStorageAuthority = 'desktop'
) {
  const harness = {
    state: initial,
    disk: structuredClone(initial),
    writes: 0,
    failAt: NO_FAILURE,
    definitions(): AutomationDefinitionOperations {
      return {
        state: harness.state,
        storageAuthority,
        flush: () => harness.persist(),
        recordCreated: () => {}
      }
    },
    runs(): CoordinatedAutomationRunOperations {
      return {
        state: harness.state,
        storageAuthority,
        flush: () => harness.persist(),
        getWorkspaceDisplayName: (workspaceId) => workspaceId ?? null
      }
    },
    persist(): void {
      harness.writes += 1
      if (harness.failAt === harness.writes) {
        throw new Error(`simulated write failure at write ${harness.writes}`)
      }
      harness.disk = structuredClone(harness.state)
    },
    /** Restart from what last reached disk. */
    restart(): void {
      harness.state = structuredClone(harness.disk)
      harness.failAt = null
    }
  }
  return harness
}

export function fakeOrchestration(): CoordinatedOrchestrationRecordProbe & {
  runs: Map<string, Set<string>>
  createRun: (id: string) => void
  createTask: (runId: string, taskId: string) => void
} {
  const runs = new Map<string, Set<string>>()
  return {
    runs,
    createRun: (id) => void runs.set(id, new Set()),
    createTask: (runId, taskId) => void runs.get(runId)?.add(taskId),
    hasRun: (id) => runs.has(id),
    hasTask: (runId, taskId) => runs.get(runId)?.has(taskId) ?? false
  }
}

export function coordinatedRuns(state: PersistedState, automation: Automation): AutomationRun[] {
  return (state.automationRuns ?? []).filter((run) => run.automationId === automation.id)
}

/** Create (or replay) a run and return the detached run row, failing loudly when absent. */
export function createRun(
  operations: CoordinatedAutomationRunOperations,
  input: CreateCoordinatedAutomationRunInput
): AutomationRun {
  const { run } = createCoordinatedAutomationRun(operations, input)
  if (!run) {
    throw new Error('Expected the occurrence to resolve to a retained run row.')
  }
  return run
}
