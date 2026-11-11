import { parseCoordinatedReportContract } from './coordinated-automation-report-contract'
import {
  readOrchestrationCompatibilityEvidence,
  type OrchestrationCompatibilityEvidence
} from './orchestration-compatibility-evidence'

export const NATIVE_STUB_BRIEF_ECHO_CHECK = 'native-stub-brief-echo'

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
  | 'unsupported_fixture_check'

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
  if (requiredCheckIds.some((id) => id !== NATIVE_STUB_BRIEF_ECHO_CHECK)) {
    return { kind: 'refused', reason: 'unsupported_fixture_check' }
  }
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
              evidence: ['The fixture received and echoed the complete dispatch brief.']
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
