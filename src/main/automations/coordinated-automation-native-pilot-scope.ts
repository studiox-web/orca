import type { CoordinatedNativeStartDescriptor } from '../../shared/coordinated-automation-run-view'
import { manualStartRefusal } from './coordinated-automation-run-host-gate'
import type { AutomationRun } from '../../shared/automations-types'
import { resolveAutomationSnapshot } from '../../shared/coordinated-automation-snapshot'
import type { ResolvedAutomationRunSnapshot } from '../../shared/coordinated-automation-types'
import { assertNativeProviderExecutionAdmission } from '../runtime/native-provider-execution-admission'
import type { Store } from '../persistence/loading-store/store'
import { nativeProviderHostFacts } from './coordinated-automation-native-provider-host'
import { planCoordinatedNativeProviderLaunch } from './coordinated-automation-native-provider-plan'
import { resolveActiveNativeProviderHost } from './coordinated-automation-native-provider-worker'
import type {
  CoordinatedManualRunRequest,
  CoordinatedNativeRunHostInjection
} from './coordinated-automation-run-host-types'

function pilotContext(injection: CoordinatedNativeRunHostInjection) {
  const host = resolveActiveNativeProviderHost(injection.nativeProviderWorker)
  const scope = assertNativeProviderExecutionAdmission(
    host.admission,
    host.runtime,
    host.store
  ).pilotScope
  if (!scope) {
    throw new Error('The native manual run host requires an isolated pilot scope.')
  }
  return { host, scope }
}

function snapshotRefusal(
  injection: CoordinatedNativeRunHostInjection,
  snapshot: ResolvedAutomationRunSnapshot
): string | null {
  const { host, scope } = pilotContext(injection)
  const ceilings = snapshot.globalCeilings
  if (
    snapshot.triggerPolicy !== 'manual_only' ||
    snapshot.publicationPolicy.allowExternalMutation ||
    !snapshot.outcomeContract.allowedFinalStates.includes('ready_for_review') ||
    !snapshot.publicationPolicy.allowedFinalStates.includes('ready_for_review') ||
    [
      ...snapshot.outcomeContract.allowedFinalStates,
      ...snapshot.publicationPolicy.allowedFinalStates
    ].some(
      (state) => !['ready_for_review', 'failed', 'blocked', 'outcome_uncertain'].includes(state)
    )
  ) {
    return 'The native pilot requires manual-only, draft-only ready_for_review policy.'
  }
  if (
    ceilings.maxConcurrency !== 1 ||
    ceilings.maxActiveFixersPerArtifact !== 1 ||
    ceilings.maxReviewIterations === undefined ||
    ceilings.maxReviewIterations > 2 ||
    ceilings.maxWallClockSeconds === undefined ||
    ceilings.maxWallClockSeconds > 3600 ||
    ceilings.maxDispatchStartFailures !== 1 ||
    !Number.isFinite(ceilings.maxEstimatedCostUsd) ||
    (ceilings.maxEstimatedCostUsd ?? 0) <= 0
  ) {
    return 'The native pilot requires explicit bounded concurrency, revisions, wall time and start failures.'
  }
  for (const child of snapshot.resolvedChildren.filter((entry) => entry.enabled)) {
    if (
      child.prompt.kind !== 'source_reference' ||
      child.prompt.authority !== scope.promptAuthority
    ) {
      return 'Every native pilot prompt must retain its pinned input authority.'
    }
    if (
      child.launchConfig.agentId !== 'codex' ||
      child.launchConfig.workspaceId !== scope.workspaceId
    ) {
      return 'Every native pilot child must use Codex in the admitted workspace.'
    }
    const plan = planCoordinatedNativeProviderLaunch({
      snapshot,
      child,
      taskId: 'pilot_preflight',
      host: nativeProviderHostFacts(host)
    })
    if (plan.kind === 'refused') {
      return `${plan.code}: ${plan.reason}`
    }
  }
  return null
}

export function nativePilotStartRefusal(
  store: Store,
  injection: CoordinatedNativeRunHostInjection,
  request: CoordinatedManualRunRequest
): string | null {
  const { scope } = pilotContext(injection)
  if (request.idempotencyKey !== scope.idempotencyKey) {
    return 'The native pilot admits only its frozen manual occurrence key.'
  }
  if (
    store
      .listAutomationRuns()
      .some(
        (run) =>
          run.resolvedSnapshot &&
          (run.automationId !== request.automationId ||
            run.idempotencyKey !== request.idempotencyKey)
      )
  ) {
    return 'This isolated profile already contains another coordinated occurrence.'
  }
  const automation = store.listAutomations().find((entry) => entry.id === request.automationId)
  if (
    !automation ||
    automation.triggerPolicy !== 'manual_only' ||
    automation.rrule !== '' ||
    automation.dtstart !== 0 ||
    automation.nextRunAt !== 0
  ) {
    return 'The native pilot definition must have no schedule.'
  }
  const prior = store
    .listAutomationRuns(request.automationId)
    .find((run) => run.idempotencyKey === request.idempotencyKey)
  return snapshotRefusal(
    injection,
    prior?.resolvedSnapshot ??
      resolveAutomationSnapshot({ automation, promptResolver: injection.promptResolver })
  )
}

export function nativePilotRunRefusal(
  store: Store,
  injection: CoordinatedNativeRunHostInjection,
  run: AutomationRun
): string | null {
  const { scope } = pilotContext(injection)
  if (
    run.trigger !== 'manual' ||
    run.idempotencyKey !== scope.idempotencyKey ||
    store.automationOwnerPrecondition(run.automationId)?.selector.kind !== 'self'
  ) {
    return 'The native pilot occurrence or current owner no longer matches its admitted scope.'
  }
  return run.resolvedSnapshot
    ? snapshotRefusal(injection, run.resolvedSnapshot)
    : 'The native pilot snapshot is missing.'
}

export function nativePilotStartDescriptor(
  store: Store,
  injection: CoordinatedNativeRunHostInjection
): CoordinatedNativeStartDescriptor {
  const { scope } = pilotContext(injection)
  const definitions: CoordinatedNativeStartDescriptor['definitions'] = []
  for (const automation of store.listAutomations()) {
    const prior = store
      .listAutomationRuns(automation.id)
      .find((run) => run.idempotencyKey === scope.idempotencyKey)
    const expectedDefinitionRevision =
      prior?.automationDefinitionRevision ?? automation.definitionRevision
    if (!expectedDefinitionRevision) {
      continue
    }
    const request = {
      automationId: automation.id,
      expectedDefinitionRevision,
      expectedOwner: { selector: { kind: 'self' as const } },
      idempotencyKey: scope.idempotencyKey
    }
    try {
      if (
        !manualStartRefusal(store, request) &&
        !nativePilotStartRefusal(store, injection, request)
      ) {
        definitions.push({ automationId: automation.id, expectedDefinitionRevision })
      }
    } catch {
      /* A definition with missing pinned inputs is not an eligible start. */
    }
  }
  return { idempotencyKey: scope.idempotencyKey, workspaceId: scope.workspaceId, definitions }
}
