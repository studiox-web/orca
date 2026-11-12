import { assertNativeProviderExecutionAdmission } from '../runtime/native-provider-execution-admission'
import { COORDINATED_NATIVE_PROVIDER_CAPABILITY } from './coordinated-automation-native-provider-plan'
import { resolveActiveNativeProviderHost } from './coordinated-automation-native-provider-worker'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AutomationOwnerPrecondition } from '../../shared/automation-owner-precondition'
import { isCoordinatedAutomation } from '../../shared/coordinated-automation-types'
import type { Store } from '../persistence/loading-store/store'
import { FAKE_EFFECT_ADAPTER_KIND } from './coordinated-automation-recovery-context'
import {
  COORDINATED_FAKE_RUNS_CAPABILITY,
  type CoordinatedManualRunRequest,
  type CoordinatedRunHostEnvironment,
  type CoordinatedRunHostInjection
} from './coordinated-automation-run-host-types'

function canonicalPath(path: string): string | null {
  try {
    return realpathSync(resolve(path))
  } catch {
    return null
  }
}

/** Every refusal is decided from host-owned facts before any Store, DB, or file write. */
export function coordinatedRunHostRefusal(input: {
  injection: CoordinatedRunHostInjection | undefined
  headless: boolean
  environment: CoordinatedRunHostEnvironment | null
}): string | null {
  const { injection, environment } = input
  if (!injection) {
    return 'Coordinated runs are not configured for this host.'
  }
  if (input.headless) {
    return 'Coordinated runs are refused on headless and remote hosts.'
  }
  if (
    injection.capability !== COORDINATED_FAKE_RUNS_CAPABILITY &&
    injection.capability !== COORDINATED_NATIVE_PROVIDER_CAPABILITY
  ) {
    return 'Unknown coordinated run capability.'
  }
  if (!environment) {
    return 'The host environment is unavailable, so local desktop authority cannot be confirmed.'
  }
  if (environment.isPackaged()) {
    return 'Coordinated runs are refused in packaged builds.'
  }
  if (injection.profile.kind !== 'isolated_test' && injection.profile.kind !== 'developer') {
    return 'Coordinated runs need an isolated test or developer profile.'
  }
  const selectedProfile = environment.activeProfileDirectory()
  if (!selectedProfile) {
    return 'The host has no selected active profile authority.'
  }
  const root = canonicalPath(injection.profile.root)
  if (!root || root !== canonicalPath(selectedProfile)) {
    return 'The injected profile root is not this host’s active profile.'
  }
  if (injection.capability === COORDINATED_NATIVE_PROVIDER_CAPABILITY) {
    try {
      const host = resolveActiveNativeProviderHost(injection.nativeProviderWorker)
      const identity = assertNativeProviderExecutionAdmission(
        host.admission,
        host.runtime,
        host.store
      )
      if (
        !identity.pilotScope ||
        canonicalPath(identity.pilotScope.workspacePath) !==
          canonicalPath(injection.workspacePath ?? '')
      ) {
        return 'The native run host requires the admitted isolated workspace scope.'
      }
      if (
        host.db !== injection.orchestrationDb ||
        canonicalPath(host.store.getProfileStorageDirectory()) !== root ||
        injection.effects.policy !== 'deny' ||
        injection.workerProvider
      ) {
        return 'The native run host does not match the admitted database, profile or effect policy.'
      }
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  const provider = injection.workerProvider
  const capabilities = [
    ...(provider?.capability ? [provider.capability] : []),
    ...(provider?.capabilities ?? [])
  ]
  if (
    injection.capability === COORDINATED_FAKE_RUNS_CAPABILITY &&
    (capabilities.length === 0 || capabilities.some((c) => c !== 'fake_no_effects'))
  ) {
    return 'Only the fake_no_effects worker provider is accepted.'
  }
  if (typeof injection.clock.setTimer !== 'function') {
    return 'The coordinator clock must provide setTimer for persisted stage deadlines.'
  }
  if (
    injection.effects.policy !== 'deny' &&
    injection.effects.adapter.kind !== FAKE_EFFECT_ADAPTER_KIND
  ) {
    return 'Only the deny policy or the fake effect adapter is accepted.'
  }
  return null
}

/** Exact owner equality, including SSH target identity and generation. */
export function sameOwner(
  actual: AutomationOwnerPrecondition | null,
  expected: AutomationOwnerPrecondition
): boolean {
  const a = actual?.selector
  const e = expected?.selector
  if (!a || !e || a.kind !== e.kind) {
    return false
  }
  return (
    a.kind !== 'ssh' ||
    (e.kind === 'ssh' && a.targetId === e.targetId && a.targetGeneration === e.targetGeneration)
  )
}

/** The Store facts the definition write gate also requires; re-read on every host call. */
export type CoordinatedRunHostStoreGate = {
  coordinatedAutomationDefinitionAuthority: () => 'desktop' | 'runtime'
  getSettings: () => { experimentalCoordinatedAutomations?: boolean }
  getProfileStorageDirectory: () => string
}

export function coordinatedRunStoreRefusal(
  store: CoordinatedRunHostStoreGate,
  profileRoot: string
): string | null {
  if (store.getSettings().experimentalCoordinatedAutomations !== true) {
    return 'Coordinated automations are not enabled in settings.'
  }
  if (store.coordinatedAutomationDefinitionAuthority() !== 'desktop') {
    return 'This Store does not hold desktop authority for coordinated definitions.'
  }
  const storeProfile = canonicalPath(store.getProfileStorageDirectory())
  if (!storeProfile || storeProfile !== canonicalPath(profileRoot)) {
    return 'The Store profile is not the injected profile.'
  }
  return null
}

/** The Store reads the host's preconditions need; all read-only. */
export type CoordinatedRunHostStoreReads = {
  listAutomations: Store['listAutomations']
  listAutomationRuns: Store['listAutomationRuns']
  automationOwnerPrecondition: Store['automationOwnerPrecondition']
}

export const LOCAL_SELF_OWNER: AutomationOwnerPrecondition = { selector: { kind: 'self' } }

export function manualRequestShapeRefusal(request: CoordinatedManualRunRequest): string | null {
  if (request.expectedOwner?.selector?.kind !== 'self') {
    return 'Manual coordinated runs need exact local desktop owner authority.'
  }
  if (!Number.isInteger(request.expectedDefinitionRevision)) {
    return 'An exact expected definition revision is required.'
  }
  if (
    typeof request.idempotencyKey !== 'string' ||
    request.idempotencyKey.length === 0 ||
    request.idempotencyKey.length > 128
  ) {
    return 'An idempotency key of 1-128 characters is required.'
  }
  return null
}

/**
 * New work is admitted against the CURRENT definition: coordinated, disabled, local target,
 * current owner equal to the request, and current revision equal to the request. A replay of an
 * existing key must name the ORIGINAL frozen revision and still pass current-owner fencing.
 */
export function manualStartRefusal(
  store: CoordinatedRunHostStoreReads,
  request: CoordinatedManualRunRequest
): string | null {
  const shape = manualRequestShapeRefusal(request)
  if (shape) {
    return shape
  }
  const automation = store.listAutomations().find((a) => a.id === request.automationId)
  if (!automation || !isCoordinatedAutomation(automation)) {
    return `Coordinated automation "${request.automationId}" was not found.`
  }
  if (automation.enabled) {
    return 'Manual coordinated runs are limited to disabled coordinated definitions.'
  }
  if (automation.executionTargetType !== 'local') {
    return 'Manual coordinated runs are limited to local desktop execution targets.'
  }
  if (!sameOwner(store.automationOwnerPrecondition(request.automationId), request.expectedOwner)) {
    return 'The automation owner changed.'
  }
  const prior = store
    .listAutomationRuns(request.automationId)
    .find((run) => run.idempotencyKey === request.idempotencyKey)
  if (prior) {
    return prior.automationDefinitionRevision === request.expectedDefinitionRevision
      ? null
      : `Idempotency key "${request.idempotencyKey}" was recorded for revision ${String(prior.automationDefinitionRevision)}, not ${request.expectedDefinitionRevision}.`
  }
  return automation.definitionRevision === request.expectedDefinitionRevision
    ? null
    : `Definition revision changed: expected ${request.expectedDefinitionRevision}, stored ${String(automation.definitionRevision)}.`
}

/**
 * Run-scoped calls bind to the run's FROZEN authority, not the mutable current definition: a
 * later target edit for future runs neither redirects nor strands accepted snapshot work. The
 * parent must still exist (archive revokes), and the caller must name the frozen owner.
 */
export function runScopeRefusal(
  store: CoordinatedRunHostStoreReads,
  scope: {
    automationId: string
    automationRunId: string
    expectedOwner?: AutomationOwnerPrecondition
  }
): string | null {
  const run = store.listAutomationRuns().find((r) => r.id === scope.automationRunId)
  if (!run || run.materializationPhase === undefined || !run.resolvedSnapshot) {
    return `Coordinated run "${scope.automationRunId}" was not found.`
  }
  if (run.automationId !== scope.automationId) {
    return `Run "${scope.automationRunId}" does not belong to automation "${scope.automationId}".`
  }
  const parent = store.listAutomations().find((a) => a.id === scope.automationId)
  if (!parent || !isCoordinatedAutomation(parent)) {
    return `Coordinated automation "${scope.automationId}" was not found.`
  }
  if (run.resolvedSnapshot.executionTarget.type !== 'local') {
    return 'This run was frozen for a non-local execution target.'
  }
  if (scope.expectedOwner && !sameOwner(LOCAL_SELF_OWNER, scope.expectedOwner)) {
    return 'The expected owner does not match this run’s frozen local owner.'
  }
  return null
}
