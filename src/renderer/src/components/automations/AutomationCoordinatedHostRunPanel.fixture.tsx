import { defineFixture } from '../../component-fixtures/component-fixture'
import { AutomationCoordinatedHostRunPanel } from './AutomationCoordinatedHostRunPanel'
import {
  coordinatedHostFixtureEntry,
  coordinatedHostViewFixture
} from './coordinated-host-run-view-fixture'
import {
  sampleActiveCoordinatedRun,
  sampleCoordinatedArticleAutomation
} from './coordinated-automation-run-fixture-data'
import { COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY as FAKE } from '../../../../shared/automation-runtime-capabilities'

const view = coordinatedHostViewFixture()
const run = { ...sampleActiveCoordinatedRun, id: view.inspection.automationRunId }
function installReadOnlyHost(): void {
  window.api.runtime.call = async ({ method }) => {
    if (method === 'status.get') {
      return {
        id: method,
        _meta: { runtimeId: view.runtimeId },
        ok: true,
        result: {
          runtimeId: view.runtimeId,
          capabilities: [FAKE],
          coordinatedFakeRuns: { available: true }
        }
      }
    }
    if (method === 'automation.inspectCoordinatedRun') {
      return {
        id: method,
        _meta: { runtimeId: view.runtimeId },
        ok: true,
        result: {
          view: {
            ...view,
            actions: {
              ...view.actions,
              start: { available: false, reason: 'This fixture only inspects saved evidence.' },
              reconcile: { available: false, reason: 'This fixture only inspects saved evidence.' }
            }
          }
        }
      }
    }
    return {
      id: method,
      ok: false,
      error: { code: 'fixture_read_only', message: 'This fixture does not execute operations.' }
    }
  }
}
function renderPanel() {
  return (
    <div className="bg-background p-3">
      <AutomationCoordinatedHostRunPanel
        automation={{ ...sampleCoordinatedArticleAutomation, enabled: false }}
        runs={[run]}
        hostEntry={coordinatedHostFixtureEntry}
        capturedOwner={{ owner: coordinatedHostFixtureEntry.owner, selector: { kind: 'self' } }}
        requests={new Map()}
        enabled
      />
    </div>
  )
}
export const host_receipt = defineFixture({
  width: 1280,
  setup: installReadOnlyHost,
  render: renderPanel
})
export const host_receipt_mobile = defineFixture({
  width: 375,
  setup: installReadOnlyHost,
  render: renderPanel
})
