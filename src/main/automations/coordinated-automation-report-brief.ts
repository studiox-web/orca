import type { AutomationRun } from '../../shared/automations-types'
import {
  formatCoordinatedReportContract,
  type CoordinatedReportContract
} from '../../shared/coordinated-automation-report-contract'
import type { ResolvedChildSnapshot } from '../../shared/coordinated-automation-types'
import type { OrchestrationDb } from '../runtime/orchestration/db'

type StartedDispatch = ReturnType<OrchestrationDb['createStartingWorkerDispatch']>

/** The identities and checks this exact attempt's report is validated against. */
export function coordinatedReportContractFor(
  run: AutomationRun,
  child: ResolvedChildSnapshot,
  taskId: string,
  dispatchId: string
): CoordinatedReportContract {
  const snapshot = run.resolvedSnapshot!
  const required = <T extends { id: string; required?: boolean }>(items: readonly T[] = []) =>
    items.filter((item) => item.required !== false).map((item) => item.id)
  return {
    schemaVersion: 1,
    automationRunId: run.id,
    orchestrationRunId: run.orchestrationRunId!,
    childDefinitionId: child.childDefinitionId,
    taskId,
    dispatchId,
    definitionRevision: snapshot.definitionRevision,
    resolvedConfigDigest: snapshot.canonicalDigest,
    requiredCheckIds: [
      ...new Set([
        ...required(
          snapshot.outcomeContract.acceptanceCriteria.filter(
            (criterion) =>
              !criterion.targetChildId || criterion.targetChildId === child.childDefinitionId
          )
        ),
        ...required(child.stageAcceptance?.criteria),
        ...required(child.stageAcceptance?.requiredChecks)
      ])
    ]
  }
}

/** The same started Dispatch, with its brief telling the worker how its report is validated. */
export function withCoordinatedReportBrief(
  started: StartedDispatch,
  run: AutomationRun,
  child: ResolvedChildSnapshot
): StartedDispatch {
  const contract = coordinatedReportContractFor(run, child, started.task.id, started.dispatch.id)
  return {
    ...started,
    task: {
      ...started.task,
      spec: [
        started.task.spec,
        formatCoordinatedReportContract(contract),
        'Artifact requirements from the frozen stage configuration follow. Copy each required kind exactly; pathPattern constrains its URI, with {dispatchId} replaced by this exact Dispatch ID. sameDigestAs requires identical bytes to the named artifact kind. Include the actual content digest. These requirements are instructions, not additional structuredResult fields.',
        `Stage artifact requirements: ${JSON.stringify(child.stageAcceptance?.requiredArtifacts ?? [])}`
      ].join('\n\n')
    }
  }
}
