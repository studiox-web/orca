import type { AutomationRun } from '../../shared/automations-types'
import type {
  ReceiptValidationContext,
  SemanticCompletionReceipt,
  SemanticReceiptAcceptanceResult,
  SemanticReceiptApproval,
  SemanticReceiptEffect
} from '../../shared/coordinated-automation-receipt-types'
import { validateReceiptAgainstSnapshot } from '../../shared/coordinated-automation-receipt-validation'
import type {
  CoordinatedCompletionTrust,
  ResolvedAutomationRunSnapshot
} from '../../shared/coordinated-automation-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { CoordinatedOrchestrationRecordProbe } from '../persistence/scheduling-automations/coordinated-automation-run-records'

export type ParentOutcomeAcceptanceResult =
  | {
      accepted: true
      receipt: SemanticCompletionReceipt
      trust: CoordinatedCompletionTrust
    }
  | { accepted: false; errors: string[] }

export function evaluateParentOutcomeAcceptance(input: {
  run: AutomationRun
  snapshot: ResolvedAutomationRunSnapshot
  orchestrationDb: OrchestrationDb
  probe: CoordinatedOrchestrationRecordProbe
  trustedAuthorIdentity?: string
  hostApprovals?: readonly SemanticReceiptApproval[]
  hostEffectReceipts?: readonly SemanticReceiptEffect[]
  waiverPolicy?: {
    allowedRoles: string[]
    authorities: { identity: string; role: string }[]
  }
  productionDecision?: { approverIdentity: string; role: string; decidedAt: number }
}): ParentOutcomeAcceptanceResult {
  const { run, snapshot, orchestrationDb, probe } = input
  const orchestrationRunId = run.orchestrationRunId
  if (!orchestrationRunId || !probe.hasRun(orchestrationRunId)) {
    return { accepted: false, errors: ['Run has no linked native orchestration Run.'] }
  }

  const tasks = orchestrationDb.listTasks({ runId: orchestrationRunId })
  if (tasks.length === 0) {
    return { accepted: false, errors: ['Run has no materialized tasks.'] }
  }
  const failedTasks = tasks.filter((t) => t.status === 'failed')
  if (failedTasks.length > 0) {
    return {
      accepted: false,
      errors: [`Native tasks failed: ${failedTasks.map((t) => t.id).join(', ')}`]
    }
  }

  const allChecks: { id: string; outcome: string; evidence?: string[] }[] = []

  for (const task of tasks) {
    if (task.result) {
      try {
        const parsed = JSON.parse(task.result) as Record<string, unknown>
        if (Array.isArray(parsed.checks)) {
          allChecks.push(...parsed.checks)
        }
      } catch {
        // Raw string summary or non-JSON result; ignored
      }
    }
  }

  const acceptanceResults: SemanticReceiptAcceptanceResult[] = []
  for (const criterion of snapshot.outcomeContract.acceptanceCriteria) {
    const matchingCheck = allChecks.find((c) => c.id === criterion.id)
    if (matchingCheck) {
      if (matchingCheck.outcome === 'passed') {
        acceptanceResults.push({
          criterionId: criterion.id,
          status: 'satisfied',
          evidence:
            matchingCheck.evidence && matchingCheck.evidence.length > 0
              ? matchingCheck.evidence
              : [`Criterion "${criterion.id}" verified passed by task execution`],
          evaluatedAt: Date.now()
        })
      } else {
        acceptanceResults.push({
          criterionId: criterion.id,
          status: 'failed',
          evidence: [],
          evaluatedAt: Date.now()
        })
      }
    } else if (criterion.required) {
      acceptanceResults.push({
        criterionId: criterion.id,
        status: 'failed',
        evidence: [],
        evaluatedAt: Date.now()
      })
    }
  }

  const lastTask = tasks.at(-1)!
  const lastMapping = (run.childMappings ?? []).find((m) => m.taskId === lastTask.id)
  const lastDispatchCtx = orchestrationDb.getDispatchContext(lastTask.id)
  const activeAttempt = {
    taskId: lastTask.id,
    dispatchId: lastDispatchCtx?.id ?? lastMapping?.dispatchId ?? 'ctx_final'
  }

  const authorIdentity = input.trustedAuthorIdentity ?? 'host_service'
  const trust: CoordinatedCompletionTrust = {
    authorIdentity,
    activeAttempt,
    ...(input.waiverPolicy ? { waiverPolicy: input.waiverPolicy } : {}),
    ...(input.productionDecision ? { productionDecision: input.productionDecision } : {})
  }

  const trustedContext: ReceiptValidationContext = {
    trustedAuthorIdentity: authorIdentity,
    trustedHostId: snapshot.executionTarget.id,
    trustedExecutionAuthority: `${snapshot.executionTarget.type}:${snapshot.executionTarget.id}`,
    automationRunId: run.id,
    orchestrationRunId,
    activeAttempt,
    trustedTaskMappings: (run.childMappings ?? []).map((m) => ({ ...m })),
    ...(input.waiverPolicy ? { waiverPolicy: input.waiverPolicy } : {}),
    ...(input.productionDecision ? { productionDecision: input.productionDecision } : {})
  }

  const receipt: SemanticCompletionReceipt = {
    schemaVersion: 1,
    identityChain: {
      automationId: snapshot.automationId,
      definitionRevision: snapshot.definitionRevision,
      automationRunId: run.id,
      orchestrationRunId,
      hostId: snapshot.executionTarget.id,
      targetExecutionAuthority: `${snapshot.executionTarget.type}:${snapshot.executionTarget.id}`,
      activeAttempt,
      taskMappings: (run.childMappings ?? []).map((m) => ({ ...m }))
    },
    frozenConfigDigest: snapshot.canonicalDigest,
    finalState: 'completed',
    completedAt: Date.now(),
    acceptanceResults,
    approvals: input.hostApprovals ? input.hostApprovals.map((a) => ({ ...a })) : [],
    effectReceipts: input.hostEffectReceipts ? input.hostEffectReceipts.map((e) => ({ ...e })) : [],
    unresolvedWarnings: []
  }

  const validation = validateReceiptAgainstSnapshot(receipt, snapshot, trustedContext)
  if (!validation.valid) {
    return { accepted: false, errors: validation.errors }
  }

  return { accepted: true, receipt, trust }
}
