import { defineFixture } from '../../component-fixtures/component-fixture'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AutomationRunControlImpactDialog } from './AutomationRunControlImpactDialog'
import { projectCoordinatedAutomationRun } from './coordinated-automation-run-projection'
import {
  sampleActiveCoordinatedRun,
  sampleCoordinatedArticleAutomation
} from './coordinated-automation-run-fixture-data'
import { sampleActiveRunObservation } from './coordinated-automation-run-fixture-scenarios'

const noop = (): void => {}

const boundProjectedRun = projectCoordinatedAutomationRun({
  automation: sampleCoordinatedArticleAutomation,
  run: sampleActiveCoordinatedRun,
  observation: sampleActiveRunObservation,
  operatorActions: {
    stopRun: { availability: { supported: true, reason: null }, onStopRun: noop },
    retryStage: { availability: { supported: true, reason: null }, onRetryStage: noop },
    resolveGate: { availability: { supported: true, reason: null }, onResolveGate: noop }
  },
  options: { isFeatureFlagEnabled: true }
})

const reviewerStage = boundProjectedRun.stages.find(
  (stage) => stage.childDefinitionId === 'child-reviewer'
)!

const storeState = {
  settings: createGlobalSettingsFixture({
    experimentalCoordinatedAutomations: true
  })
}

export const impact_preview_stop = defineFixture({
  width: 920,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-6">
        <AutomationRunControlImpactDialog
          request={{ kind: 'stop' }}
          projectedRun={boundProjectedRun}
          onClose={noop}
          onConfirmStop={noop}
          onConfirmRetry={noop}
          onConfirmResolveGate={noop}
        />
      </div>
    </TooltipProvider>
  )
})

export const impact_preview_stop_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-3">
        <AutomationRunControlImpactDialog
          request={{ kind: 'stop' }}
          projectedRun={boundProjectedRun}
          onClose={noop}
          onConfirmStop={noop}
          onConfirmRetry={noop}
          onConfirmResolveGate={noop}
        />
      </div>
    </TooltipProvider>
  )
})

export const impact_preview_gate = defineFixture({
  width: 920,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-6">
        <AutomationRunControlImpactDialog
          request={{ kind: 'resolve_gate', stage: reviewerStage, gateId: 'gate-editorial-signoff' }}
          projectedRun={boundProjectedRun}
          onClose={noop}
          onConfirmStop={noop}
          onConfirmRetry={noop}
          onConfirmResolveGate={noop}
        />
      </div>
    </TooltipProvider>
  )
})

export const impact_preview_gate_mobile = defineFixture({
  width: 375,
  store: storeState,
  render: () => (
    <TooltipProvider>
      <div className="bg-background p-3">
        <AutomationRunControlImpactDialog
          request={{ kind: 'resolve_gate', stage: reviewerStage, gateId: 'gate-editorial-signoff' }}
          projectedRun={boundProjectedRun}
          onClose={noop}
          onConfirmStop={noop}
          onConfirmRetry={noop}
          onConfirmResolveGate={noop}
        />
      </div>
    </TooltipProvider>
  )
})
