import { translate } from '@/i18n/i18n'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import {
  COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY,
  COORDINATED_AUTOMATION_NATIVE_RUNS_RUNTIME_CAPABILITY
} from '../../../../shared/automation-runtime-capabilities'

export type CoordinatedRunExecutionKind = 'fake' | 'native'

export function coordinatedRunHostKind(status: RuntimeStatus): CoordinatedRunExecutionKind {
  const native = status.capabilities?.includes(
    COORDINATED_AUTOMATION_NATIVE_RUNS_RUNTIME_CAPABILITY
  )
  const fake = status.capabilities?.includes(COORDINATED_AUTOMATION_FAKE_RUNS_RUNTIME_CAPABILITY)
  if (Boolean(native) === Boolean(fake)) {
    throw new Error(
      translate(
        'auto.components.automations.coordinatedRuns.hostKindUnavailable',
        'The host has not identified one supported coordinated worker execution mode.'
      )
    )
  }
  return native ? 'native' : 'fake'
}

export function coordinatedRunHostAvailability(status: RuntimeStatus) {
  return coordinatedRunHostKind(status) === 'native'
    ? status.coordinatedNativeRuns
    : status.coordinatedFakeRuns
}
