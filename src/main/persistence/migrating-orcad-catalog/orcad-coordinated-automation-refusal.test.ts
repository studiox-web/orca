import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SshTarget } from '../../../shared/ssh-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { closeTestStores, createSqliteTestStore } from '../persistence-test-harness'
import { Store } from '../loading-store/store'
import { createOrcadMigrationManifest } from '../../ssh/orcad-migration-manifest-export'
import {
  COORDINATED_REPOS,
  coordinatedCreateInput,
  coordinatedTestState,
  durableHarness
} from '../scheduling-automations/coordinated-automation-persistence.test-support'
import { createCoordinatedAutomation } from '../scheduling-automations/coordinated-automation-definition-operations'
import { subtractOrcadMigrationSourceAutomationState } from './orcad-source-automation-subtraction'
import { prepareOrcadMigrationAutomationState } from './orcad-destination-automation-state'
import {
  coordinatedStateTouchedByOrcadMigration,
  ORCAD_MIGRATION_COORDINATED_STATE_REFUSAL
} from './orcad-coordinated-automation-refusal'
import { collectOrcadMigrationSourceAutomationState } from './orcad-source-automation-state'
import type { CoordinatedAutomationLedger } from '../../../shared/coordinated-automation-ledger-types'
import { emptyCoordinatedAutomationLedger } from '../../../shared/coordinated-automation-ledger-schemas'

const TARGET: SshTarget = {
  id: 'ssh-prod',
  label: 'Production',
  host: 'prod.example.com',
  port: 22,
  username: 'deploy',
  generation: 3
}
const REPO_ID = 'repo-1'
const SSH_OWNER = { selector: { kind: 'ssh', targetId: TARGET.id, targetGeneration: 3 } } as const

const directories: string[] = []
afterEach(async () => {
  await closeTestStores()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function sourceStore(): Store {
  const directory = mkdtempSync(join(tmpdir(), 'orcad-coordinated-refusal-'))
  directories.push(directory)
  const store = createSqliteTestStore(Store, { dataFile: join(directory, 'orca-data.json') })
  store.addSshTarget(TARGET)
  store.addRepo({
    id: REPO_ID,
    path: '/srv/app',
    displayName: 'App',
    badgeColor: '#737373',
    addedAt: 1,
    kind: 'git',
    connectionId: TARGET.id
  })
  return store
}

function singleAutomation(store: Store) {
  return store.createAutomation({
    name: 'Nightly check',
    prompt: 'Check the repo',
    agentId: 'claude',
    projectId: REPO_ID,
    workspaceMode: 'new_per_run',
    timezone: 'UTC',
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    dtstart: 1
  })
}

function coordinatedParent(store: Store) {
  return store.createCoordinatedAutomation(coordinatedCreateInput({ projectId: REPO_ID }))
}

const refusal = new RegExp(`^${ORCAD_MIGRATION_COORDINATED_STATE_REFUSAL}:\\d+$`)

describe('Orcad migration with coordinated automation state', () => {
  it('refuses the manifest and the preflight while a coordinated definition is in scope', () => {
    const store = sourceStore()
    singleAutomation(store)
    const baseline = createOrcadMigrationManifest(store, TARGET)
    expect(baseline.payload.dormantState?.automations).toHaveLength(1)

    coordinatedParent(store)
    expect(() => createOrcadMigrationManifest(store, TARGET)).toThrow(refusal)
    expect(() =>
      store.inspectOrcadMigrationSourceDormantState(baseline.source, baseline.payload)
    ).toThrow(refusal)
    // A re-export after an older move reads a subtracted copy; it must refuse there too.
    expect(() =>
      store
        .createOrcadMigrationDeltaView(baseline)
        .collectOrcadMigrationSourceDormantState(baseline.source, baseline.payload)
    ).toThrow(refusal)
    // "Move anyway" previews and exports through the leave-behind view; it cannot override this.
    expect(() =>
      store
        .createOrcadMigrationLeaveBehindView(TARGET.id)
        .collectOrcadMigrationSourceDormantState(baseline.source, baseline.payload)
    ).toThrow(refusal)
    expect(() =>
      store
        .createOrcadMigrationLeaveBehindView(TARGET.id)
        .inspectOrcadMigrationUntransferredDependencies(baseline)
    ).toThrow(refusal)
    expect(store.listAutomations()).toHaveLength(2)
  })

  it('keeps refusing after the parent is archived, because its runs and ledger remain', () => {
    const store = sourceStore()
    const parent = coordinatedParent(store)
    const { run } = store.createCoordinatedAutomationRun({
      automationId: parent.id,
      scheduledFor: 1,
      expectedOwner: SSH_OWNER
    })
    store.recordCoordinatedMaterializationFailure({
      automationRunId: run!.id,
      phase: 'materialization_failed',
      error: 'settled'
    })
    store.archiveCoordinatedAutomation({ automationId: parent.id, expectedOwner: SSH_OWNER })
    expect(store.listAutomations()).toEqual([])
    expect(() => createOrcadMigrationManifest(store, TARGET)).toThrow(refusal)
    expect(store.listAutomationRuns(parent.id)).toHaveLength(1)
  })

  it('still moves single automations when no coordinated state is in scope', () => {
    const store = sourceStore()
    const automation = singleAutomation(store)
    const manifest = createOrcadMigrationManifest(store, TARGET)
    expect(manifest.payload.dormantState?.automations?.map((a) => a.id)).toEqual([automation.id])
    expect(() => store.createOrcadMigrationDeltaView(manifest)).not.toThrow()
  })

  it('refuses coordinated rows arriving at a destination catalog', () => {
    const store = sourceStore()
    const parent = coordinatedParent(store)
    const run = store.createCoordinatedAutomationRun({
      automationId: parent.id,
      scheduledFor: 1,
      expectedOwner: SSH_OWNER
    }).run!
    const destination: Pick<PersistedState, 'automations' | 'automationRuns'> = {
      automations: [],
      automationRuns: []
    }
    const prepare = (automations: unknown[], runs: unknown[]) =>
      prepareOrcadMigrationAutomationState(
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the guard reads only kind/children/materializationPhase before any other field.
        automations as never,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: as above.
        runs as never,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the guard runs before the state is read.
        destination as PersistedState
      )
    expect(() => prepare([parent], [])).toThrow(
      /orcad_migration_dormant_coordinated_automation_unsupported:1/
    )
    expect(() => prepare([], [run])).toThrow(
      /orcad_migration_dormant_coordinated_automation_unsupported:1/
    )
  })

  it('refuses to subtract coordinated rows, leaving the source state untouched', () => {
    const harness = durableHarness(coordinatedTestState())
    const parent = createCoordinatedAutomation(
      harness.definitions(),
      coordinatedCreateInput({ projectId: 'repo-ssh' })
    )
    const before = structuredClone(harness.state)
    const manifest = {
      source: { sshTargetId: 'ssh-1', sshTargetGeneration: 7, targetLabel: 'Box' },
      payload: { repositories: [{ id: 'repo-ssh' }], folderWorkspaces: [] }
    }
    expect(() =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: subtraction reads only source, repositories and folderWorkspaces.
      subtractOrcadMigrationSourceAutomationState(harness.state, manifest as never)
    ).toThrow(refusal)
    expect(harness.state).toEqual(before)
    expect(harness.state.automations.map((a) => a.id)).toEqual([parent.id])
  })

  describe('unscopable coordinated identity', () => {
    const DIGEST = `sha256:${'a'.repeat(64)}`
    const ledger = (
      overrides: Partial<CoordinatedAutomationLedger>
    ): CoordinatedAutomationLedger => ({
      ...emptyCoordinatedAutomationLedger(),
      ...overrides
    })
    const tombstone = (target: { type: 'local' | 'ssh'; id: string }) => ({
      automationId: 'archived-1',
      name: 'Archived',
      lastDefinitionRevision: 1,
      definitionFingerprint: null,
      executionTarget: target,
      children: [],
      archivedAt: 1
    })
    const occurrence = (automationId: string) => ({
      automationId,
      occurrenceFingerprint: DIGEST,
      idempotencyKey: 'k',
      trigger: 'scheduled' as const,
      scheduledFor: 1,
      executionAuthority: 'local:local',
      automationRunId: 'run-1',
      definitionRevision: 1,
      canonicalDigest: DIGEST,
      recordedAt: 1
    })
    const census = (state: PersistedState, sshTargetId: string | null) =>
      coordinatedStateTouchedByOrcadMigration({ state, automations: [], runs: [], sshTargetId })

    it.each<[string, CoordinatedAutomationLedger]>([
      ['tombstone-only', ledger({ parentTombstones: [tombstone({ type: 'local', id: 'local' })] })],
      ['orphan occurrence-only', ledger({ occurrences: [occurrence('gone')] })],
      ['orphan replay-horizon-only', ledger({ replayHorizons: { gone: 5 } })],
      ['orphan revision-only', ledger({ revisionDigests: { 'gone:1': DIGEST } })],
      ['unreadable', ledger({ unreadable: true })]
    ])('refuses a null-target local WSL move over %s state', (_label, coordinatedLedger) => {
      const state = coordinatedTestState({ coordinatedAutomationLedger: coordinatedLedger })
      expect(census(state, null)).toBeGreaterThan(0)
      expect(() =>
        collectOrcadMigrationSourceAutomationState(
          state,
          {
            kind: 'local-wsl',
            distro: 'Ubuntu',
            scopeRepoIds: ['repo-local'],
            scopeFolderWorkspaceIds: [],
            generation: 1
          },
          { repositories: [COORDINATED_REPOS[0]], projectGroups: [], folderWorkspaces: [] }
        )
      ).toThrow(refusal)
    })

    it('counts only identity it can prove is outside the move', () => {
      const harness = durableHarness(coordinatedTestState())
      const untouched = createCoordinatedAutomation(harness.definitions(), coordinatedCreateInput())
      const state = {
        ...harness.state,
        coordinatedAutomationLedger: ledger({
          occurrences: [occurrence(untouched.id)],
          parentTombstones: [tombstone({ type: 'ssh', id: 'other-host' })]
        })
      }
      // An existing, untouched parent's records and another SSH host's tombstone are provable.
      expect(census(state, 'ssh-1')).toBe(0)
      // A local move cannot attribute an SSH tombstone, so it refuses.
      expect(census(state, null)).toBe(1)
    })
  })
})
