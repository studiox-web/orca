import { z } from 'zod'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AutomationRun } from '../../shared/automations-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { Store } from '../persistence/loading-store/store'
import { coordinatedMappingProblem } from './coordinated-automation-native-validation'
import { toCanonicalJson } from '../../shared/coordinated-automation-canonical-digest'
import { LOCAL_SELF_OWNER, runScopeRefusal } from './coordinated-automation-run-host-gate'

export const NATIVE_STUB_ATTEMPT = 'native_stub_session_test' as const
const Binding = z
  .object({
    kind: z.literal(NATIVE_STUB_ATTEMPT),
    version: z.literal(1),
    automationId: z.string(),
    automationRunId: z.string(),
    orchestrationRunId: z.string(),
    childDefinitionId: z.string(),
    taskId: z.string(),
    snapshotDigest: z.string(),
    definitionRevision: z.number().int(),
    profile: z.string(),
    runtimeGeneration: z.string(),
    workspaceId: z.string(),
    retryOfDispatchId: z.string().nullable()
  })
  .strict()
export type CoordinatedNativeAttemptBinding = z.infer<typeof Binding>

function startOptions(db: OrchestrationDb, dispatchId: string): unknown {
  try {
    return JSON.parse(db.getWorkerDispatch(dispatchId)?.start_options ?? 'null')
  } catch {
    return null
  }
}

export function isCoordinatedNativeAttempt(db: OrchestrationDb, dispatchId: string): boolean {
  const options = startOptions(db, dispatchId)
  return !!options && typeof options === 'object' && 'coordinatedNativeStub' in options
}

export function readCoordinatedNativeBinding(
  db: OrchestrationDb,
  dispatchId: string
): CoordinatedNativeAttemptBinding | null {
  const options = startOptions(db, dispatchId)
  const parsed = Binding.safeParse(
    options && typeof options === 'object' && 'coordinatedNativeStub' in options
      ? options.coordinatedNativeStub
      : null
  )
  return parsed.success ? parsed.data : null
}

/** A stored marker selects recovery policy; it never grants fresh launch or attachment authority. */
export function nativeAttemptBindingProblem(
  db: OrchestrationDb,
  run: AutomationRun,
  dispatchId: string
): string | null {
  const binding = readCoordinatedNativeBinding(db, dispatchId)
  const snapshot = run.resolvedSnapshot
  const dispatch = db.getDispatchContextById(dispatchId)
  const worker = db.getWorkerDispatch(dispatchId)
  if (!binding || !snapshot || !dispatch || !worker) {
    return 'Native attempt identity is incomplete.'
  }
  const mapping = run.childMappings?.find((m) => m.dispatchId === dispatchId)
  const child = snapshot.resolvedChildren.find(
    (c) => c.childDefinitionId === mapping?.childDefinitionId
  )
  if (
    !mapping ||
    !child ||
    binding.workspaceId !== child.launchConfig.workspaceId ||
    binding.automationId !== run.automationId ||
    binding.automationRunId !== run.id ||
    binding.orchestrationRunId !== run.orchestrationRunId ||
    binding.snapshotDigest !== snapshot.canonicalDigest ||
    binding.definitionRevision !== snapshot.definitionRevision ||
    binding.taskId !== mapping?.taskId ||
    binding.childDefinitionId !== mapping.childDefinitionId ||
    worker.runtime_epoch !== binding.runtimeGeneration ||
    dispatch.retry_of_dispatch_id !== binding.retryOfDispatchId ||
    dispatch.consumer_generation > 1
  ) {
    return 'Native attempt binding changed or was rebound.'
  }
  return coordinatedMappingProblem(db, run, snapshot)
}

/** Consume the native ingestion owner's durable accepted fact, never an untrusted provider return. */
export function nativeAttemptSettlementProblem(
  db: OrchestrationDb,
  run: AutomationRun,
  dispatchId: string
): string | null {
  const problem = nativeAttemptBindingProblem(db, run, dispatchId)
  if (problem) {
    return problem
  }
  const dispatch = db.getDispatchContextById(dispatchId)!
  const worker = db.getWorkerDispatch(dispatchId)!
  const task = db.getTask(dispatch.task_id)
  if (
    !['completed', 'failed'].includes(dispatch.status) ||
    worker.stage !== 'settled' ||
    !['succeeded', 'failed'].includes(worker.state) ||
    !dispatch.launch_token_hash ||
    !dispatch.assignee_handle ||
    !dispatch.assignee_pane_key ||
    !dispatch.process_incarnation ||
    dispatch.consumer_generation !== 1
  ) {
    return 'Native attempt has no authenticated terminal settlement.'
  }
  const Result = z
    .object({
      provenance: z.literal('worker_report'),
      messageId: z.string(),
      reportedBy: z.string(),
      body: z.string(),
      outcome: z.enum(['succeeded', 'failed'])
    })
    .passthrough()
  let raw: unknown
  try {
    raw = JSON.parse(task?.result ?? 'null')
  } catch {
    raw = null
  }
  const result = Result.safeParse(raw)
  if (!result.success) {
    return 'Native attempt result is not a worker_done receipt.'
  }
  const message = db.getMessageById(result.data.messageId)
  if (
    !message ||
    message.type !== 'worker_done' ||
    message.run_id !== run.orchestrationRunId ||
    message.from_handle !== dispatch.assignee_handle ||
    message.sender_pane_key !== dispatch.assignee_pane_key ||
    result.data.reportedBy !== message.from_handle ||
    result.data.body !== message.body
  ) {
    return 'Native report provenance does not match its Dispatch.'
  }
  let payload: unknown
  try {
    payload = JSON.parse(message.payload ?? 'null')
  } catch {
    payload = null
  }
  const Payload = z.object({
    taskId: z.string(),
    dispatchId: z.string(),
    outcome: z.enum(['succeeded', 'failed']),
    structuredResult: z.unknown().optional()
  })
  const parsed = Payload.safeParse(payload)
  if (
    !parsed.success ||
    parsed.data.taskId !== task?.id ||
    parsed.data.dispatchId !== dispatchId ||
    result.data.outcome !== parsed.data.outcome ||
    worker.state !== parsed.data.outcome ||
    dispatch.status !== (parsed.data.outcome === 'succeeded' ? 'completed' : 'failed') ||
    toCanonicalJson(parsed.data.structuredResult ?? null) !==
      toCanonicalJson(result.data.structuredResult ?? null)
  ) {
    return 'Native report payload changed after settlement.'
  }
  const reportId = `worker_report:${message.id}`
  const fact = db.getAttemptObservationFacts(dispatchId).find((f) => f.id === reportId)
  return fact?.facet === 'worker_report' &&
    fact.authorityId === `run_home:${run.orchestrationRunId}` &&
    fact.payload.status === 'accepted' &&
    fact.payload.reportId === reportId &&
    fact.payload.outcome === parsed.data.outcome
    ? null
    : 'Native report has no accepted atomic ingestion fact.'
}

/** Any mapped native attempt binds the whole Run to the native protocol. */
export function runHasCoordinatedNativeAttempt(
  db: OrchestrationDb,
  orchestrationRunId: string
): boolean {
  return db.listTasks({ runId: orchestrationRunId }).some((task) => {
    const dispatch = db.getDispatchContext(task.id)
    return dispatch !== undefined && isCoordinatedNativeAttempt(db, dispatch.id)
  })
}

function canonicalProfilePath(path: string | null | undefined): string | null {
  if (!path) {
    return null
  }
  try {
    return realpathSync(resolve(path))
  } catch {
    return null
  }
}

/**
 * Actual Store identity and the run's frozen owner scope, revalidated at admission and recovery
 * boundaries; the DB-only binding check cannot see profile or owner revocation.
 */
export function nativeAttemptHostScopeProblem(
  store: Store,
  db: OrchestrationDb,
  run: AutomationRun,
  dispatchId: string
): string | null {
  const binding = readCoordinatedNativeBinding(db, dispatchId)
  if (!binding) {
    return 'Native attempt binding is missing.'
  }
  if (canonicalProfilePath(store.getProfileStorageDirectory()) !== binding.profile) {
    return 'Native attempt profile no longer matches the Store profile.'
  }
  return runScopeRefusal(store, {
    automationId: run.automationId,
    automationRunId: run.id,
    expectedOwner: LOCAL_SELF_OWNER
  })
}

/** The full semantic gate: durable authenticated settlement plus live host/owner scope. */
export function nativeAttemptSemanticAdmissionProblem(
  store: Store,
  db: OrchestrationDb,
  run: AutomationRun,
  dispatchId: string
): string | null {
  return (
    nativeAttemptSettlementProblem(db, run, dispatchId) ??
    nativeAttemptHostScopeProblem(store, db, run, dispatchId)
  )
}
