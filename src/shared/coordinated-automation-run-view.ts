import type {
  CoordinatedRunInspection,
  CoordinatedRunSemanticState
} from './coordinated-automation-run-inspection'

export type CoordinatedRunActionAvailability =
  | { available: true; state?: string }
  | { available: false; state?: string; reason: string }

type UnavailableEvidence = { kind: 'unavailable'; reason: string }

export type CoordinatedRunView = {
  runtimeId: string
  inspection: CoordinatedRunInspection
  actions: {
    start: CoordinatedRunActionAvailability
    reconcile: CoordinatedRunActionAvailability
    stop: { available: false; reason: string }
    retry: { available: false; reason: string }
    humanResolution: { available: false; reason: string }
  }
  findings: UnavailableEvidence
  limits: UnavailableEvidence
}

export type CoordinatedFakeRunReconcileResponse = {
  state: CoordinatedRunSemanticState
  reason: string | null
  view: CoordinatedRunView
}

export type CoordinatedFakeRunStartResponse = CoordinatedFakeRunReconcileResponse & {
  created: boolean
}
