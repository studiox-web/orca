import { expect } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'
import type { AutomationRun } from '../../shared/automations-types'
import type { RuntimeTerminalCreate } from '../../shared/runtime-terminal-create-contract'
import type { StructuredWorkerResult } from '../../shared/coordinated-automation-receipt-types'
import type { ChildLaunchConfig } from '../../shared/coordinated-automation-types'
import {
  child,
  coordinatedCreateInput
} from '../persistence/scheduling-automations/coordinated-automation-persistence.test-support'
import type { NativeStubAttemptFixture as Fixture } from './coordinated-native-stub-attempt.test-support'

let rpcRequests = 0

export function nativeLaunchConfig(workspaceId: string, timeoutSeconds = 30): ChildLaunchConfig {
  return {
    agentId: 'codex',
    model: null,
    reasoningEffort: null,
    surface: 'terminal' as const,
    extraAgentArgs: '',
    reuseSession: false,
    workspaceMode: 'existing' as const,
    workspaceId,
    baseBranch: null,
    setupDecision: 'skip' as const,
    timeoutSeconds,
    maxRetries: 0,
    maxReviewIterations: 0
  }
}

export async function createNativeRun(
  f: Fixture,
  children = [child('writer')],
  timeoutSeconds = 30,
  overrides: Parameters<typeof coordinatedCreateInput>[0] = {}
) {
  const automation = f.store.createCoordinatedAutomation(
    coordinatedCreateInput({
      ...overrides,
      children: children.map((c) =>
        c.id === 'writer' || c.id === 'reviewer'
          ? { ...c, launchConfig: nativeLaunchConfig(f.workspaceId, timeoutSeconds) }
          : c
      )
    })
  )
  const { run } = f.store.createCoordinatedAutomationRun({
    automationId: automation.id,
    scheduledFor: 1000
  })
  const materialized = await f.adapter.materializeRun(run!.id)
  const writerTaskId = materialized.childMappings!.find(
    (m) => m.childDefinitionId === 'writer'
  )!.taskId
  return { automation, run: materialized, writerTaskId }
}

export function structuredReport(
  run: AutomationRun,
  identity: { childDefinitionId: string; taskId: string; dispatchId: string },
  overrides: Partial<StructuredWorkerResult> = {}
): StructuredWorkerResult {
  return {
    schemaVersion: 1,
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId!,
    childDefinitionId: identity.childDefinitionId,
    taskId: identity.taskId,
    dispatchId: identity.dispatchId,
    definitionRevision: run.resolvedSnapshot!.definitionRevision,
    resolvedConfigDigest: run.resolvedSnapshot!.canonicalDigest,
    outcome: 'succeeded',
    summary: `${identity.childDefinitionId} done`,
    reportMarkdown: `${identity.childDefinitionId} report`,
    artifacts: [],
    checks: run.resolvedSnapshot!.outcomeContract.acceptanceCriteria.map((c) => ({
      id: c.id,
      outcome: 'passed' as const,
      evidence: [`Criterion ${c.id} verified`]
    })),
    effects: [],
    blockers: [],
    ...overrides
  }
}

export function evidenceFor(created: RuntimeTerminalCreate) {
  return {
    terminalHandle: created.handle,
    paneKey: created.paneKey,
    launchToken: created.launchToken
  }
}

export async function sendWorkerDone(
  f: Fixture,
  input: {
    handle: string
    dispatchId: string
    taskId: string
    outcome: 'succeeded' | 'failed'
    structuredResult?: unknown
    evidence?: unknown
  }
) {
  rpcRequests += 1
  const response = await f.dispatcher.dispatch({
    id: `rpc-${rpcRequests}`,
    authToken: 'test',
    method: 'orchestration.send',
    params: {
      from: input.handle,
      type: 'worker_done',
      subject: 'Done',
      payload: JSON.stringify({
        taskId: input.taskId,
        dispatchId: input.dispatchId,
        outcome: input.outcome,
        ...(input.structuredResult !== undefined
          ? { structuredResult: input.structuredResult }
          : {})
      })
    },
    orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
    orchestrationRequestId: `req-${rpcRequests}`,
    ...(input.evidence ? { orchestrationCompatibilityEvidence: input.evidence } : {})
  })
  return response
}

export async function dispatchWriter(f: Fixture, runId: string): Promise<string> {
  const first = await f.adapter.reconcileRun(runId)
  expect(first.state).toBe('outcome_uncertain')
  const run = f.store.listAutomationRuns().find((r) => r.id === runId)!
  return run.childMappings!.find((m) => m.childDefinitionId === 'writer')!.dispatchId!
}

export function operatorScope(run: AutomationRun) {
  return {
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId ?? null,
    definitionRevision: run.resolvedSnapshot!.definitionRevision,
    targetExecutionAuthority: `${run.resolvedSnapshot!.executionTarget.type}:${run.resolvedSnapshot!.executionTarget.id}`
  }
}
