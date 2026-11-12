import type {
  CoordinatedOperatorActionDisposition,
  CoordinatedRunInspection,
  CoordinatedRunSemanticState
} from './coordinated-automation-run-inspection'

export type CoordinatedNativeStartDescriptor = {
  idempotencyKey: string
  workspaceId: string
  definitions: { automationId: string; expectedDefinitionRevision: number }[]
}

export type CoordinatedRunActionAvailability =
  | { available: true; state?: string; nativeStart?: CoordinatedNativeStartDescriptor }
  | { available: false; state?: string; reason: string }

type UnavailableEvidence = { kind: 'unavailable'; reason: string }

export type CoordinatedRunView = {
  executionKind?: 'fake' | 'native'
  runtimeId: string
  inspection: CoordinatedRunInspection
  actions: {
    start: CoordinatedRunActionAvailability
    reconcile: CoordinatedRunActionAvailability
    stop: CoordinatedRunActionAvailability
    retry: CoordinatedRunActionAvailability
    humanResolution: CoordinatedRunActionAvailability
  }
  findings: UnavailableEvidence
  limits: UnavailableEvidence
}

export type CoordinatedFakeRunReconcileResponse = {
  state: CoordinatedRunSemanticState
  reason: string | null
  view: CoordinatedRunView
}

/** Result of stopCoordinatedRun / retryCoordinatedStage / resolveCoordinatedGate. */
export type CoordinatedOperatorActionResponse = CoordinatedFakeRunReconcileResponse & {
  disposition: CoordinatedOperatorActionDisposition
}

export type CoordinatedFakeRunStartResponse = CoordinatedFakeRunReconcileResponse & {
  created: boolean
}
