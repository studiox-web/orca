import { defineFixture } from '../../component-fixtures/component-fixture'
import {
  CoordinatedHostRunControls,
  type CoordinatedHostRunControlBindings
} from './AutomationCoordinatedHostRunControls'
import { sampleCoordinatedFrozenSnapshotRev2 } from './coordinated-automation-run-fixture-data'
import { coordinatedHostActiveViewFixture } from './coordinated-host-active-run-view-fixture'
import { describePendingGates } from './coordinated-run-operator-client'

const view = coordinatedHostActiveViewFixture()
const stoppedView = {
  ...view,
  inspection: { ...view.inspection, operatorStop: { at: 1762712000000, reason: null } },
  actions: {
    ...view.actions,
    stop: {
      available: false as const,
      state: 'refused',
      reason: 'Operator stop is already recorded; awaiting exit evidence.'
    }
  }
}
const controls: CoordinatedHostRunControlBindings = {
  busy: false,
  scopeUnavailable: null,
  pendingGates: describePendingGates(view, sampleCoordinatedFrozenSnapshotRev2),
  onRequest: () => {},
  onOpenSession: () => {}
}
function renderControls(shown: typeof view) {
  return (
    <div className="bg-background p-3">
      <CoordinatedHostRunControls view={shown} controls={controls} />
    </div>
  )
}
export const run_controls = defineFixture({ width: 1280, render: () => renderControls(view) })
export const run_controls_mobile = defineFixture({
  width: 375,
  render: () => renderControls(view)
})
export const run_controls_stop_recorded_mobile = defineFixture({
  width: 375,
  render: () => renderControls(stoppedView)
})
