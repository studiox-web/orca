import { parseCoordinatedReportContract } from './coordinated-automation-report-contract'
import {
  readOrchestrationCompatibilityEvidence,
  type OrchestrationCompatibilityEvidence
} from './orchestration-compatibility-evidence'

/**
 * Fixture-side half of the pinned stub's completion report. It runs with exactly what the stub
 * process has: the brief it received on its own stdin and its own environment. Credentials are
 * read from that environment the same way the real CLI reads them and travel only in the RPC
 * envelope — never in argv, the message body or anything this module returns for display.
 */
export type NativeStubCompletionRequest = Readonly<{
  method: 'orchestration.send'
  params: Readonly<{ from: string; type: 'worker_done'; subject: string; payload: string }>
  /** The authenticated envelope part; a transport sends it, nothing logs it. */
  orchestrationCompatibilityEvidence: OrchestrationCompatibilityEvidence
}>

export type NativeStubCompletionRefusal =
  | 'brief_has_no_report_contract'
  | 'environment_has_no_launch_identity'
  | 'brief_addressed_to_another_terminal'

export function buildNativeStubCompletionReport(input: {
  /** The submission the stub received, i.e. the dispatch brief typed into its composer. */
  brief: string
  env: Readonly<Record<string, string | undefined>>
}):
  | { kind: 'request'; request: NativeStubCompletionRequest }
  | { kind: 'refused'; reason: NativeStubCompletionRefusal } {
  const contract = parseCoordinatedReportContract(input.brief)
  if (!contract) {
    return { kind: 'refused', reason: 'brief_has_no_report_contract' }
  }
  const evidence = readOrchestrationCompatibilityEvidence(input.env)
  if (!evidence?.terminalHandle || !evidence.paneKey || !evidence.launchToken) {
    return { kind: 'refused', reason: 'environment_has_no_launch_identity' }
  }
  // The brief names the worker it was written for; a stub never reports for someone else's.
  if (!input.brief.includes(`--from ${evidence.terminalHandle} `)) {
    return { kind: 'refused', reason: 'brief_addressed_to_another_terminal' }
  }
  const { requiredCheckIds, ...identity } = contract
  return {
    kind: 'request',
    request: Object.freeze({
      method: 'orchestration.send',
      params: Object.freeze({
        from: evidence.terminalHandle,
        type: 'worker_done',
        subject: 'Golden stub completed',
        payload: JSON.stringify({
          taskId: contract.taskId,
          dispatchId: contract.dispatchId,
          outcome: 'succeeded',
          structuredResult: {
            ...identity,
            outcome: 'succeeded',
            summary: 'Golden stub echoed its brief.',
            reportMarkdown: 'The pinned golden stub received its brief and performed no work.',
            artifacts: [],
            checks: requiredCheckIds.map((id) => ({
              id,
              outcome: 'passed',
              evidence: ['Golden stub fixture: no work is performed, nothing can fail.']
            })),
            effects: [],
            blockers: []
          }
        })
      }),
      orchestrationCompatibilityEvidence: evidence
    })
  }
}
