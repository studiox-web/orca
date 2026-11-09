import { defineFixture } from '../../component-fixtures/component-fixture'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'
import { AutomationWorkersSection } from './AutomationWorkersSection'
import {
  sampleConfiguredWorkers,
  sampleInvalidWorkers,
  sampleBlockedWorkers,
  sampleHistoricalSnapshot
} from './automation-workers-fixture-data'

const storeState = {
  settings: createGlobalSettingsFixture({
    experimentalCoordinatedAutomations: true
  })
}

// 1. Empty state
export const empty = defineFixture({
  width: 800,
  store: storeState,
  render: () => (
    <div className="bg-background p-6">
      <AutomationWorkersSection workers={[]} isEditing={true} />
    </div>
  )
})

export const empty_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <div className="bg-background p-4">
      <AutomationWorkersSection workers={[]} isEditing={true} />
    </div>
  )
})

// 2. Configured state
export const configured = defineFixture({
  width: 800,
  store: storeState,
  render: () => (
    <div className="bg-background p-6">
      <AutomationWorkersSection
        workers={sampleConfiguredWorkers}
        definitionRevision={1}
        isEditing={true}
        outcomeContract={{
          humanStatement: 'Publish weekly researched technical summaries',
          acceptanceCriteria: [
            { id: 'c1', description: 'Brief written', required: true, kind: 'artifact' }
          ],
          requiredApprovals: [],
          allowedFinalStates: ['completed']
        }}
      />
    </div>
  )
})

export const configured_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <div className="bg-background p-4">
      <AutomationWorkersSection
        workers={sampleConfiguredWorkers}
        definitionRevision={1}
        isEditing={true}
        outcomeContract={{
          humanStatement: 'Publish weekly researched technical summaries',
          acceptanceCriteria: [
            { id: 'c1', description: 'Brief written', required: true, kind: 'artifact' }
          ],
          requiredApprovals: [],
          allowedFinalStates: ['completed']
        }}
      />
    </div>
  )
})

// 3. Invalid state (validation summary showing cycle, missing dep, lane conflicts)
export const invalid = defineFixture({
  width: 800,
  store: storeState,
  render: () => (
    <div className="bg-background p-6">
      <AutomationWorkersSection
        workers={sampleInvalidWorkers}
        definitionRevision={2}
        isEditing={true}
      />
    </div>
  )
})

export const invalid_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <div className="bg-background p-4">
      <AutomationWorkersSection
        workers={sampleInvalidWorkers}
        definitionRevision={2}
        isEditing={true}
      />
    </div>
  )
})

// 4. Active state (active run executing against frozen revision)
export const active = defineFixture({
  width: 800,
  store: storeState,
  render: () => (
    <div className="bg-background p-6">
      <AutomationWorkersSection
        workers={sampleConfiguredWorkers}
        definitionRevision={2}
        hasModifications={true}
        activeRunId="run-coord-9042"
        activeRunRevision={1}
        activeRunStatus="dispatched"
        isEditing={false}
      />
    </div>
  )
})

export const active_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <div className="bg-background p-4">
      <AutomationWorkersSection
        workers={sampleConfiguredWorkers}
        definitionRevision={2}
        hasModifications={true}
        activeRunId="run-coord-9042"
        activeRunRevision={1}
        activeRunStatus="dispatched"
        isEditing={false}
      />
    </div>
  )
})

// 5. Blocked state (stage blocked by disabled prerequisite)
export const blocked = defineFixture({
  width: 800,
  store: storeState,
  render: () => (
    <div className="bg-background p-6">
      <AutomationWorkersSection
        workers={sampleBlockedWorkers}
        definitionRevision={1}
        isEditing={false}
      />
    </div>
  )
})

export const blocked_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <div className="bg-background p-4">
      <AutomationWorkersSection
        workers={sampleBlockedWorkers}
        definitionRevision={1}
        isEditing={false}
      />
    </div>
  )
})

// 6. Historical state (read-only snapshot viewer)
export const historical = defineFixture({
  width: 800,
  store: storeState,
  render: () => (
    <div className="bg-background p-6">
      <AutomationWorkersSection
        workers={sampleConfiguredWorkers}
        definitionRevision={2}
        snapshotRunId="run-coord-historical-7788"
        historicalSnapshot={sampleHistoricalSnapshot}
        isEditing={false}
      />
    </div>
  )
})

export const historical_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <div className="bg-background p-4">
      <AutomationWorkersSection
        workers={sampleConfiguredWorkers}
        definitionRevision={2}
        snapshotRunId="run-coord-historical-7788"
        historicalSnapshot={sampleHistoricalSnapshot}
        isEditing={false}
      />
    </div>
  )
})
